import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import { loadAuthConfig, type AuthConfig } from "./authConfig.js";
import { findCliTokenUser, readBearerToken } from "./cliTokens.js";
import { resolveBaseUrl } from "./files.js";
import { logger } from "./logger.js";
import { readSessionCookie, type SessionUser } from "./session.js";

/** どの資格情報でログインしたか。Cookie なら session、Bearer トークンなら token */
export type AuthMethod = "session" | "token";

export type AppEnv = { Variables: { user: SessionUser; authMethod: AuthMethod } };

const FRAME_EXPIRED_HTML = `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ログインが必要です</title></head>
<body style="font-family: system-ui, sans-serif; padding: 24px; color: #333;">
<p>ログインの有効期限が切れました。ページを再読み込みしてください。</p>
</body>
</html>`;

/**
 * メールアドレスのドメイン（最後の "@" より後ろ）が許可ドメインに含まれるか。
 *
 * セッション Cookie は最大 7 日、CLI トークンは 90 日有効なため、発行後に
 * ALLOWED_EMAIL_DOMAINS から外したドメインのユーザーが使い続けられてしまう。
 * 毎リクエストこれで再確認する。文字列比較だけで I/O は無い。
 */
export function isAllowedEmailDomain(email: string, allowedDomains: string[]): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return domain !== "" && allowedDomains.includes(domain);
}

/**
 * 認証を要求するミドルウェア。
 *
 * - `redirect`: ブラウザで開くページ向け。ログイン後に元のページへ戻れるよう next を付けて送る。
 * - `json`: API 向け。リダイレクトすると fetch 側が Google のログイン画面の HTML を受け取ってしまうため 401 を返す。
 * - `frame`: iframe の中で開かれる本体向け。リダイレクトすると Google が iframe 内での表示を拒否するため、
 *   401 の小さな HTML を返して再読み込みを促す。
 */
export function requireUser(onMissing: "redirect" | "json" | "frame"): MiddlewareHandler<AppEnv> {
  return createMiddleware<AppEnv>(async (c, next) => {
    // 同じパスに requireUser が 2 つ重なる配線（/files/:id/headers/edit と /files/*）でも
    // 2 つ目が結果を上書きしないよう、既に決まっていれば何もしない
    if (c.get("user")) {
      await next();
      return;
    }

    let config: AuthConfig;
    try {
      config = loadAuthConfig();
    } catch (err) {
      // 設定が読めないときに素通しすると認証なしで公開されてしまうので、必ず止める
      logger.error({ event: "auth.config_error", err: (err as Error).message });
      return c.json({ error: "Internal Server Error" }, 500);
    }

    // 探す順序: Cookie → Authorization: Bearer（CLI 用）。
    // Cookie で決まれば Firestore を引かずに済む
    let authMethod: AuthMethod = "session";
    let user = readSessionCookie(c, config);
    if (!user) {
      const token = readBearerToken(c.req.header("authorization"));
      if (token) {
        user = await findCliTokenUser(token);
        authMethod = "token";
      }
    }
    // 発行後に許可ドメインから外された場合は、資格情報が無いものとして扱う
    if (user && isAllowedEmailDomain(user.email, config.allowedDomains)) {
      c.set("user", user);
      c.set("authMethod", authMethod);
      await next();
      return;
    }

    if (onMissing === "json") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (onMissing === "frame") {
      return c.html(FRAME_EXPIRED_HTML, 401, { "Cache-Control": "no-store" });
    }
    const url = new URL(c.req.url);
    return c.redirect(`/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
  });
}

export function getUser(c: Context<AppEnv>): SessionUser {
  const user = c.get("user");
  // requireUser を通さずに呼ばれたのは配線の誤り。匿名として続行させない
  if (!user) throw new Error("getUser called on a route without requireUser");
  return user;
}

export function getAuthMethod(c: Context<AppEnv>): AuthMethod {
  const method = c.get("authMethod");
  if (!method) throw new Error("getAuthMethod called on a route without requireUser");
  return method;
}

// 制御文字・バックスラッシュを % エンコードしたもの（%00-%1f, %7f, %5c）
const ENCODED_UNSAFE = /%(?:[01][0-9a-f]|7f|5c)/i;

// 生の制御文字（0x00-0x1f, 0x7f）とバックスラッシュ。
// 正規表現に制御文字を書くと lint (no-control-regex) に掛かるため、文字コードで判定する
function hasRawUnsafeChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

// パス中の "." / ".." 区間（%2e エンコード形を含む）。URL 解決で畳まれると
// "/.//host" → "//host" のように別オリジンを指す形になるため、解決前に弾く
const DOT_SEGMENT = /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i;

const PLACEHOLDER_ORIGIN = "http://placeholder.invalid";

// 戻り値そのものが同一オリジンのパスであることの最終確認。
// 入力側の検査に漏れがあっても、ここで "//host" や "\" を含む値は外に出さない
function isSameOriginPath(p: string): boolean {
  return p.startsWith("/") && !p.startsWith("//") && !p.includes("\\");
}

/**
 * ログイン後の戻り先として許すパスだけを通す（オープンリダイレクト対策）。
 *
 * 先頭の文字を見るだけでは足りない。ブラウザは Location を解決するときに
 * タブ・改行を取り除き、`\` を `/` として扱うため、`/<TAB>/host` や `/\host` が
 * `//host`（別オリジン）になる。そこで、
 * 1. 制御文字・バックスラッシュ（% エンコード形も含む）を含むものを位置に関係なく弾き、
 * 2. パスに "." / ".." 区間（%2e 形も含む）があるものを弾き（解決で畳まれて "//host" になるため）、
 * 3. ダミーのオリジンを基準に URL として解決し、オリジンが変わらないことを確かめ、
 * 4. 解決後の pathname + search + hash が "/" 始まりかつ "//" 始まりでないことを確かめて返す。
 */
export function safeNextPath(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (hasRawUnsafeChar(next) || ENCODED_UNSAFE.test(next)) return "/";
  const path = next.split(/[?#]/, 1)[0];
  if (DOT_SEGMENT.test(path)) return "/";
  let url: URL;
  try {
    url = new URL(next, PLACEHOLDER_ORIGIN);
  } catch {
    return "/";
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return "/";
  const result = url.pathname + url.search + url.hash;
  return isSameOriginPath(result) ? result : "/";
}

// Google に登録するリダイレクト URI と完全一致させる必要があるため、
// プロキシ越しで Host が揺れる環境では PUBLIC_BASE_URL で固定できるようにしている
export function redirectUri(c: Context, config: AuthConfig): string {
  return `${config.publicBaseUrl ?? resolveBaseUrl(c)}/auth/callback`;
}
