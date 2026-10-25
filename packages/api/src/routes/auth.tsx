import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { isAllowedEmailDomain, redirectUri, safeNextPath } from "../lib/auth.js";
import { loadAuthConfig } from "../lib/authConfig.js";
import { findCliTokenUser, issueCliToken, readBearerToken, revokeCliToken } from "../lib/cliTokens.js";
import {
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCode,
  isAllowedAccount,
  parseIdTokenClaims,
  type IdClaims,
} from "../lib/google.js";
import { isSameOriginBrowserRequest } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import {
  clearSessionCookie,
  isHttpsRequest,
  readSessionCookie,
  setSessionCookie,
} from "../lib/session.js";
import { signValue, verifyValue } from "../lib/signedCookie.js";
import { Layout } from "./web.js";
import { errorPageClass, ghostButtonClass, headerClass, submitButtonClass } from "./webStyles.js";

const OAUTH_COOKIE = "tim_oauth";
const OAUTH_TTL_SECONDS = 10 * 60;
// ログインの往復中だけ使う Cookie なので、送信先を /auth に絞る
const OAUTH_COOKIE_PATH = "/auth";

type OAuthFlow = { state: string; verifier: string; next: string };

// verifyValue は形を確かめないため、ここで実行時に検証する
function readOAuthFlow(c: Context, secret: string): OAuthFlow | null {
  const token = getCookie(c, OAUTH_COOKIE);
  if (!token) return null;
  const decoded = verifyValue<Record<string, unknown>>(token, secret);
  if (!decoded) return null;
  const { state, verifier, next } = decoded;
  if (typeof state !== "string" || state === "") return null;
  if (typeof verifier !== "string" || verifier === "") return null;
  if (typeof next !== "string") return null;
  return { state, verifier, next };
}

function clearOAuthCookie(c: Context): void {
  deleteCookie(c, OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH, httpOnly: true, sameSite: "Lax" });
}

function LogoutForm() {
  return (
    <form method="post" action="/auth/logout">
      <button type="submit" class={ghostButtonClass}>
        ログアウト
      </button>
    </form>
  );
}

function badRequest(c: Context) {
  clearOAuthCookie(c);
  return c.html(
    <Layout>
      <h1 class={headerClass}>Tim</h1>
      <p class={errorPageClass}>ログインを完了できませんでした。</p>
      <p>
        <a href="/auth/login">もう一度ログインする</a>
      </p>
    </Layout>,
    400,
  );
}

// CLI が待ち受けるループバックのポート。特権ポートは CLI が使わないので受け付けない。
// parseInt / Number は "53682abc" や "0x1F90" を通してしまうため、数字だけの形を先に確かめる
const PORT_PATTERN = /^[1-9][0-9]{3,4}$/;
const MIN_PORT = 1024;
const MAX_PORT = 65535;
// CLI が生成する state。ループバックの URL にそのまま載るので、URL・HTML で意味を持つ文字を含ませない
const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

type CliRequest = { port: number; state: string };

function parseCliRequest(port: unknown, state: unknown): CliRequest | null {
  if (typeof port !== "string" || !PORT_PATTERN.test(port)) return null;
  const portNumber = Number(port);
  if (portNumber < MIN_PORT || portNumber > MAX_PORT) return null;
  if (typeof state !== "string" || !STATE_PATTERN.test(state)) return null;
  return { port: portNumber, state };
}

function cliErrorPage(c: Context, message: string, status: 400 | 401 | 403) {
  return c.html(
    <Layout>
      <h1 class={headerClass}>Tim</h1>
      <p class={errorPageClass}>{message}</p>
    </Layout>,
    status,
  );
}

const app = new Hono();

app.get("/login", (c) => {
  const config = loadAuthConfig();
  const { verifier, challenge } = createPkcePair();
  const state = randomBytes(16).toString("base64url");
  const next = safeNextPath(c.req.query("next"));

  setCookie(c, OAUTH_COOKIE, signValue({ state, verifier, next }, config.sessionSecret, OAUTH_TTL_SECONDS), {
    httpOnly: true,
    // Google からのリダイレクトはトップレベルの GET 遷移なので Lax でも送られる
    sameSite: "Lax",
    path: OAUTH_COOKIE_PATH,
    secure: isHttpsRequest(c),
    maxAge: OAUTH_TTL_SECONDS,
  });

  // 許可ドメインが 1 つならアカウント選択をそのドメインに絞る（表示上の便宜で、判定は callback で行う）
  const hostedDomain = config.allowedDomains.length === 1 ? config.allowedDomains[0] : null;
  return c.redirect(
    buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: redirectUri(c, config),
      state,
      codeChallenge: challenge,
      hostedDomain,
    }),
    302,
  );
});

app.get("/callback", async (c) => {
  const config = loadAuthConfig();
  const flow = readOAuthFlow(c, config.sessionSecret);
  // state を照合してから初めてコードを使う（ログイン CSRF 対策）
  if (!flow || c.req.query("state") !== flow.state) return badRequest(c);
  const code = c.req.query("code");
  if (!code) return badRequest(c);

  let claims: IdClaims;
  try {
    const idToken = await exchangeCode({
      code,
      codeVerifier: flow.verifier,
      redirectUri: redirectUri(c, config),
      config,
    });
    claims = parseIdTokenClaims(idToken, config.clientId);
  } catch (err) {
    // コードやトークンは秘密情報なのでログに残さない
    logger.warn({ event: "auth.callback_failed", reason: (err as Error).message });
    return badRequest(c);
  }

  clearOAuthCookie(c);
  if (!isAllowedAccount(claims, config.allowedDomains)) {
    logger.warn({ event: "auth.account_refused", hd: claims.hd ?? null });
    return c.html(
      <Layout>
        <h1 class={headerClass}>Tim</h1>
        <p class={errorPageClass}>このアカウントではログインできません</p>
        <LogoutForm />
      </Layout>,
      403,
    );
  }

  setSessionCookie(
    c,
    { email: claims.email, name: claims.name ?? claims.email, picture: claims.picture ?? null },
    config,
  );
  // Cookie の next は署名済みだが、生成時の判定に依存しないよう戻す直前にも確かめる
  return c.redirect(safeNextPath(flow.next), 302);
});

app.post("/logout", (c) => {
  clearSessionCookie(c);
  return c.redirect("/", 302);
});

/**
 * CLI ログインの確認ページ。
 *
 * GET ではトークンを発行しない。発行してしまうと、ログイン済みのユーザーに細工したリンクを
 * 踏ませるだけでトークンが出てしまうため、本人がボタンを押す POST を必須にしている。
 */
app.get("/cli", (c) => {
  const request = parseCliRequest(c.req.query("port"), c.req.query("state"));
  if (!request) return cliErrorPage(c, "CLI のログイン要求が正しくありません。", 400);

  const user = readSessionCookie(c, loadAuthConfig());
  if (!user) {
    // ログイン後にこの確認ページへ戻す。検証済みの値だけで組み直し、余計なクエリを持ち回らない
    const back = `/auth/cli?port=${request.port}&state=${request.state}`;
    return c.redirect(`/auth/login?next=${encodeURIComponent(back)}`, 302);
  }

  // 確認ボタンを別サイトの透明な iframe 越しに押させる（クリックジャッキング）のを防ぐ。
  // iframe 内からの POST は Sec-Fetch-Site が same-origin になり、POST 側の検査では止められない
  c.header("X-Frame-Options", "DENY");
  c.header("Content-Security-Policy", "frame-ancestors 'none'");
  return c.html(
    <Layout>
      <h1 class={headerClass}>Tim</h1>
      <p>{user.email} として CLI にログインします</p>
      <p>このページを CLI から開いた覚えがなければ、閉じてください。</p>
      <form method="post" action="/auth/cli">
        <input type="hidden" name="port" value={String(request.port)} />
        <input type="hidden" name="state" value={request.state} />
        <button type="submit" class={submitButtonClass}>
          ログインする
        </button>
      </form>
    </Layout>,
  );
});

app.post("/cli", async (c) => {
  // 別サイトのフォームから POST させてトークンを発行させる攻撃（CSRF）を防ぐ
  if (!isSameOriginBrowserRequest(c)) return cliErrorPage(c, "このリクエストは受け付けられません。", 403);

  const user = readSessionCookie(c, loadAuthConfig());
  if (!user) return cliErrorPage(c, "ログインしてから、もう一度 CLI からやり直してください。", 401);

  // フォームの値は書き換えられるので、GET で確かめた値でも改めて検証する
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return cliErrorPage(c, "CLI のログイン要求が正しくありません。", 400);
  }
  const body = await c.req.parseBody();
  const request = parseCliRequest(body.port, body.state);
  if (!request) return cliErrorPage(c, "CLI のログイン要求が正しくありません。", 400);

  const token = await issueCliToken(user);
  // 送り先はループバック固定。ホストを入力から組み立てないので、トークンが外部に送られることはない
  const callback = new URL(`http://127.0.0.1:${request.port}/callback`);
  callback.searchParams.set("token", token);
  callback.searchParams.set("state", request.state);
  logger.info({ event: "auth.cli_token_issued", email: user.email });
  // Location にトークンが載るため、どこにもキャッシュさせない
  c.header("Cache-Control", "no-store");
  return c.redirect(callback.toString(), 302);
});

// /auth/* には requireUser が掛からないので、ここで Bearer を照合する
app.delete("/cli-token", async (c) => {
  const token = readBearerToken(c.req.header("authorization"));
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  const user = await findCliTokenUser(token);
  // 許可ドメインから外れたユーザーは requireUser と同じく資格情報なしとして扱う
  if (!user || !isAllowedEmailDomain(user.email, loadAuthConfig().allowedDomains)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await revokeCliToken(token);
  logger.info({ event: "auth.cli_token_revoked", email: user.email });
  return c.body(null, 204);
});

export default app;
