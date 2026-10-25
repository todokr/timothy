import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { MiddlewareHandler } from "hono";
import { loadAuthConfig, type AuthConfig } from "./authConfig.js";
import { resolveBaseUrl } from "./files.js";
import { logger } from "./logger.js";
import { readSessionCookie, type SessionUser } from "./session.js";

export type AppEnv = { Variables: { user: SessionUser } };

/**
 * 認証を要求するミドルウェア。
 *
 * - `redirect`: ブラウザで開くページ向け。ログイン後に元のページへ戻れるよう next を付けて送る。
 * - `json`: API 向け。リダイレクトすると fetch 側が Google のログイン画面の HTML を受け取ってしまうため 401 を返す。
 */
export function requireUser(onMissing: "redirect" | "json"): MiddlewareHandler<AppEnv> {
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

    // 探す順序: Cookie → Authorization: Bearer（CLI 用。Task 5 で追加する）
    const user = readSessionCookie(c, config);
    if (user) {
      c.set("user", user);
      await next();
      return;
    }

    if (onMissing === "json") {
      return c.json({ error: "Unauthorized" }, 401);
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

/**
 * ログイン後の戻り先として許すパスだけを通す（オープンリダイレクト対策）。
 * `//host` と `/\host` はブラウザが別オリジンへの URL と解釈するため弾く。
 */
export function safeNextPath(next: string | undefined): string {
  if (!next || !next.startsWith("/")) return "/";
  if (next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

// Google に登録するリダイレクト URI と完全一致させる必要があるため、
// プロキシ越しで Host が揺れる環境では PUBLIC_BASE_URL で固定できるようにしている
export function redirectUri(c: Context, config: AuthConfig): string {
  return `${config.publicBaseUrl ?? resolveBaseUrl(c)}/auth/callback`;
}
