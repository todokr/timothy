import { Hono } from "hono";
import type { AppEnv } from "../lib/auth.js";
import { loadAuthConfig } from "../lib/authConfig.js";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, type SessionUser } from "../lib/session.js";
import { signValue } from "../lib/signedCookie.js";

// テスト専用のヘルパー。vitest.config の test.env（ALLOWED_EMAIL_DOMAINS=example.com）に合わせて
// 許可ドメイン内のユーザーにしている。

export const TEST_USER: SessionUser = {
  email: "tester@example.com",
  name: "Tester",
  picture: null,
};

/** `cookie` ヘッダにそのまま渡せる `tim_session=<署名値>` を返す */
export function sessionCookieHeader(user: SessionUser = TEST_USER): string {
  const token = signValue(user, loadAuthConfig().sessionSecret, SESSION_TTL_SECONDS);
  return `${SESSION_COOKIE}=${token}`;
}

/** サブアプリを単体で叩くとき、requireUser を通した後と同じ状態（user がセット済み）にする */
export function withUser<E extends AppEnv = AppEnv>(sub: Hono<E>, user: SessionUser = TEST_USER): Hono<E> {
  const wrapper = new Hono<E>();
  wrapper.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  wrapper.route("/", sub);
  return wrapper;
}
