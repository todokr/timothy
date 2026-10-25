import { describe, it, expect, afterEach, vi } from "vitest";

// redirectUri が使う resolveBaseUrl は files.ts にあり、files.ts は firebase を初期化するため差し替える
vi.mock("./firebase.js", () => ({
  db: { collection: vi.fn() },
}));

vi.mock("./cliTokens.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cliTokens.js")>()),
  findCliTokenUser: vi.fn(),
}));

import { Hono } from "hono";
import { getUser, requireUser, redirectUri, safeNextPath, type AppEnv } from "./auth.js";
import { loadAuthConfig } from "./authConfig.js";
import { SESSION_COOKIE, readSessionCookie, setSessionCookie } from "./session.js";
import { signValue } from "./signedCookie.js";
import { TEST_USER, sessionCookieHeader, withUser } from "../test/auth.js";
import { findCliTokenUser } from "./cliTokens.js";

describe("safeNextPath", () => {
  it.each(["/s/01ABC?v=2", "/", "/auth/cli?port=53682&state=abcdefghijklmnop_-XY", "/files/01ABC/headers/edit", "/s/01ABC?v=2#top"])("keeps a safe path %s", (p) => {
    expect(safeNextPath(p)).toBe(p);
  });

  // URL 解決でドット区間が畳まれると //host になる（/.//host → //host）
  const UNSAFE_NEXT = [
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "evil",
    "",
    undefined,
    // ブラウザは Location 解決時にタブ・改行を取り除くため、/<TAB>/host は //host になる
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "/\x00/evil.example",
    "/\x7f/evil.example",
    // 二重エンコードされた制御文字・バックスラッシュ（後段で一度デコードされても危険にならないよう弾く）
    "/%09/evil.example",
    "/%0a/evil.example",
    "/%5c/evil.example",
    "/%5C%5Cevil.example",
    // 先頭以外の位置のバックスラッシュも弾く
    "/\\/evil.example",
    "/a\\..\\..\\/evil",
    "/s/x\\evil",
    "/.//evil.example",
    "/a/..//evil.example",
    "/%2e//evil.example",
    "/%2E%2E//evil.example",
    "/a/%2e%2e//evil.example",
    "/.%2e//evil.example",
    "/./",
    "/s/../",
  ];

  it.each(UNSAFE_NEXT)("falls back to / for %s", (p) => {
    expect(safeNextPath(p as string | undefined)).toBe("/");
  });

  // 一覧に漏れがあっても、戻り値が別オリジンを指す形にならないことを確かめる
  it("never returns a protocol-relative or backslash path", () => {
    const pieces = ["/", "//", ".", "..", "%2e", "%2E%2E", "\\", "\t", "a", "evil.example", "?", "#"];
    const inputs: string[] = [...(UNSAFE_NEXT.filter((p) => p !== undefined) as string[])];
    for (const a of pieces) for (const b of pieces) for (const c of pieces) inputs.push(`/${a}${b}${c}`);
    for (const input of inputs) {
      const out = safeNextPath(input);
      expect(out.startsWith("/"), input).toBe(true);
      expect(out.startsWith("//"), input).toBe(false);
      expect(out.includes("\\"), input).toBe(false);
    }
  });
});

function appWith(onMissing: "redirect" | "json") {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser(onMissing));
  app.get("*", (c) => c.json(getUser(c)));
  return app;
}

describe("requireUser", () => {
  const saved = process.env.SESSION_SECRET;
  afterEach(() => {
    process.env.SESSION_SECRET = saved;
  });

  it("sets the user from a valid session cookie", async () => {
    const res = await appWith("json").request("/x", { headers: { cookie: sessionCookieHeader() } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(TEST_USER);
  });

  it("returns 401 JSON without a cookie in json mode", async () => {
    const res = await appWith("json").request("/x");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("redirects to login with the path and query in redirect mode", async () => {
    const res = await appWith("redirect").request("/s/01ABC?v=2");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login?next=%2Fs%2F01ABC%3Fv%3D2");
  });

  // 設定が読めないときに素通しすると認証なしで公開されてしまう
  it("fails closed with 500 when the auth config is missing", async () => {
    delete process.env.SESSION_SECRET;
    const json = await appWith("json").request("/x");
    expect(json.status).toBe(500);
    const redirect = await appWith("redirect").request("/x");
    expect(redirect.status).toBe(500);
  });

  it("does nothing when a user is already set", async () => {
    const sub = new Hono<AppEnv>();
    sub.use("*", requireUser("json"));
    sub.get("/", (c) => c.json(getUser(c)));
    const other = { email: "other@example.com", name: "Other", picture: null };
    const res = await withUser(sub, other).request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(other);
  });
});

describe("requireUser with a bearer token", () => {
  const CLI_USER = { email: "cli@example.com", name: "Cli", picture: null };

  afterEach(() => {
    vi.mocked(findCliTokenUser).mockReset();
  });

  it("sets the user from a valid bearer token", async () => {
    vi.mocked(findCliTokenUser).mockResolvedValue(CLI_USER);
    const res = await appWith("json").request("/x", { headers: { authorization: "Bearer tok_1" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(CLI_USER);
    expect(findCliTokenUser).toHaveBeenCalledWith("tok_1");
  });

  it("prefers the session cookie and skips the token lookup", async () => {
    const res = await appWith("json").request("/x", {
      headers: { cookie: sessionCookieHeader(), authorization: "Bearer tok_1" },
    });
    expect(await res.json()).toEqual(TEST_USER);
    expect(findCliTokenUser).not.toHaveBeenCalled();
  });

  it("returns 401 for a revoked token", async () => {
    vi.mocked(findCliTokenUser).mockResolvedValue(null);
    const res = await appWith("json").request("/x", { headers: { authorization: "Bearer tok_1" } });
    expect(res.status).toBe(401);
  });

  it("redirects to login for an unknown token in redirect mode", async () => {
    vi.mocked(findCliTokenUser).mockResolvedValue(null);
    const res = await appWith("redirect").request("/s/01ABC", { headers: { authorization: "Bearer tok_1" } });
    expect(res.status).toBe(302);
  });

  it.each(["tok_1", "Basic tok_1", "Bearer ", `Bearer ${"a".repeat(513)}`])(
    "treats a malformed header %j as no credentials without a lookup",
    async (header) => {
      const res = await appWith("json").request("/x", { headers: { authorization: header } });
      expect(res.status).toBe(401);
      expect(findCliTokenUser).not.toHaveBeenCalled();
    },
  );
});

describe("readSessionCookie", () => {
  const config = loadAuthConfig();

  function readWith(cookie: string) {
    const app = new Hono();
    app.get("/", (c) => c.json({ user: readSessionCookie(c, config) }));
    return app.request("/", { headers: { cookie } });
  }

  it("returns only the user fields", async () => {
    const res = await readWith(sessionCookieHeader());
    expect((await res.json()).user).toEqual(TEST_USER);
  });

  it.each([
    { email: 1, name: "n", picture: null },
    { email: "a@example.com", name: 2, picture: null },
    { email: "a@example.com", name: "n", picture: 3 },
    { email: "a@example.com", name: "n" },
  ])("rejects a signed payload with the wrong shape %j", async (payload) => {
    const token = signValue(payload, config.sessionSecret, 60);
    const res = await readWith(`${SESSION_COOKIE}=${token}`);
    expect((await res.json()).user).toBeNull();
  });

  it("rejects a cookie signed with another secret", async () => {
    const token = signValue(TEST_USER, "another-secret", 60);
    const res = await readWith(`${SESSION_COOKIE}=${token}`);
    expect((await res.json()).user).toBeNull();
  });
});

describe("setSessionCookie", () => {
  const config = loadAuthConfig();

  function setVia(headers: Record<string, string>, url = "http://localhost/") {
    const app = new Hono();
    app.get("/", (c) => {
      setSessionCookie(c, TEST_USER, config);
      return c.body(null, 204);
    });
    return app.request(url, { headers });
  }

  it("sets HttpOnly, SameSite=Lax, Path=/ without Secure over http", async () => {
    const cookie = (await setVia({})).headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^tim_session=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=604800");
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure when the forwarded proto is https", async () => {
    const cookie = (await setVia({ "x-forwarded-proto": "https" })).headers.get("set-cookie");
    expect(cookie).toContain("Secure");
  });

  it("adds Secure when the request URL is https", async () => {
    const cookie = (await setVia({}, "https://tim.example/")).headers.get("set-cookie");
    expect(cookie).toContain("Secure");
  });
});

describe("redirectUri", () => {
  function uriFor(config: ReturnType<typeof loadAuthConfig>) {
    const app = new Hono();
    app.get("/", (c) => c.text(redirectUri(c, config)));
    return app.request("/", { headers: { host: "tim.local:3000" } });
  }

  it("uses PUBLIC_BASE_URL when set", async () => {
    const res = await uriFor({ ...loadAuthConfig(), publicBaseUrl: "https://tim.example" });
    expect(await res.text()).toBe("https://tim.example/auth/callback");
  });

  it("falls back to the request host", async () => {
    const res = await uriFor({ ...loadAuthConfig(), publicBaseUrl: null });
    expect(await res.text()).toBe("http://tim.local:3000/auth/callback");
  });
});
