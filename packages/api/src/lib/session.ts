import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthConfig } from "./authConfig.js";
import { signValue, verifyValue } from "./signedCookie.js";

export type SessionUser = { email: string; name: string; picture: string | null };

export const SESSION_COOKIE = "tim_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

// ローカル開発 (http://localhost) でも Cookie が保存されるよう、Secure は https のときだけ付ける。
// Cloud Run / ロードバランサの背後では TLS が前段で終端されるため x-forwarded-proto も見る。
export function isHttpsRequest(c: Context): boolean {
  if (c.req.header("x-forwarded-proto") === "https") return true;
  return new URL(c.req.url).protocol === "https:";
}

export function setSessionCookie(c: Context, user: SessionUser, config: AuthConfig): void {
  const payload = { email: user.email, name: user.name, picture: user.picture };
  setCookie(c, SESSION_COOKIE, signValue(payload, config.sessionSecret, SESSION_TTL_SECONDS), {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: isHttpsRequest(c),
    maxAge: SESSION_TTL_SECONDS,
  });
}

// verifyValue は型を確かめずにキャストするだけなので、ここで形を検証する。
// 署名が正しくても形が違うもの（別用途の署名値の流用など）はセッションとして扱わない。
export function readSessionCookie(c: Context, config: AuthConfig): SessionUser | null {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const decoded = verifyValue<Record<string, unknown>>(token, config.sessionSecret);
  if (!decoded) return null;
  const { email, name, picture } = decoded;
  if (typeof email !== "string" || email === "") return null;
  if (typeof name !== "string") return null;
  if (picture !== null && typeof picture !== "string") return null;
  // exp など署名用の項目を持ち出さないよう、必要な項目だけで組み直す
  return { email, name, picture };
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", httpOnly: true, sameSite: "Lax" });
}
