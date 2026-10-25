import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { redirectUri, safeNextPath } from "../lib/auth.js";
import { loadAuthConfig } from "../lib/authConfig.js";
import {
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCode,
  isAllowedAccount,
  parseIdTokenClaims,
  type IdClaims,
} from "../lib/google.js";
import { logger } from "../lib/logger.js";
import { clearSessionCookie, isHttpsRequest, setSessionCookie } from "../lib/session.js";
import { signValue, verifyValue } from "../lib/signedCookie.js";
import { Layout } from "./web.js";
import { errorPageClass, ghostButtonClass, headerClass } from "./webStyles.js";

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

export default app;
