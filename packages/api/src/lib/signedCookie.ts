import { createHmac, timingSafeEqual } from "node:crypto";

// API は Cloud Run / Lambda 上でステートレスに動かすため、セッションはサーバーに保存せず
// HMAC 署名付きの値を Cookie に載せて検証する。

function hmac(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

export function signValue(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
  nowMs: number = Date.now(),
): string {
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  return `${body}.${hmac(body, secret).toString("base64url")}`;
}

export function verifyValue<T>(token: string, secret: string, nowMs: number = Date.now()): T | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];

  const expected = hmac(body, secret);
  const actual = Buffer.from(sig, "base64url");
  // timingSafeEqual は長さが違うと例外を投げるので、先に長さを確認する
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const exp = (parsed as { exp?: unknown }).exp;
  if (typeof exp !== "number" || exp <= Math.floor(nowMs / 1000)) return null;
  return parsed as T;
}
