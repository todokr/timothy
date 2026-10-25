import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// auth.tsx は web.tsx の Layout を使い、web.tsx は firebase を import するため差し替える
vi.mock("../lib/firebase.js", () => ({
  db: { collection: vi.fn() },
}));

vi.mock("../lib/google.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/google.js")>()),
  exchangeCode: vi.fn(),
}));

import app from "./auth.js";
import { exchangeCode } from "../lib/google.js";
import { signValue, verifyValue } from "../lib/signedCookie.js";
import { readSessionCookie, SESSION_COOKIE } from "../lib/session.js";
import { loadAuthConfig } from "../lib/authConfig.js";
import { Hono } from "hono";

const SECRET = "test-session-secret";

function idToken(claims: Record<string, unknown>): string {
  const payload = {
    iss: "https://accounts.google.com",
    aud: "test-client",
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: "alice@example.com",
    email_verified: true,
    hd: "example.com",
    name: "Alice",
    picture: "https://example.com/alice.png",
    ...claims,
  };
  return `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
}

function oauthCookie(payload: Record<string, unknown> = {}): string {
  const value = signValue({ state: "st", verifier: "ver", next: "/s/01ABC?v=2", ...payload }, SECRET, 600);
  return `tim_oauth=${value}`;
}

function callback(query: string, cookie?: string) {
  return app.request(`/callback?${query}`, { headers: cookie ? { cookie } : {} });
}

function cookieNamed(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

/** Set-Cookie の tim_session を読み戻して中身を確かめる */
async function sessionFrom(res: Response) {
  const raw = cookieNamed(res, SESSION_COOKIE);
  if (!raw) return null;
  const probe = new Hono();
  probe.get("/", (c) => c.json({ user: readSessionCookie(c, loadAuthConfig()) }));
  const r = await probe.request("/", { headers: { cookie: raw.split(";")[0] } });
  return (await r.json()).user;
}

beforeEach(() => {
  vi.mocked(exchangeCode).mockReset();
});

describe("GET /auth/login", () => {
  const savedDomains = process.env.ALLOWED_EMAIL_DOMAINS;
  afterEach(() => {
    process.env.ALLOWED_EMAIL_DOMAINS = savedDomains;
  });

  it("login sets tim_oauth and redirects to Google with PKCE", async () => {
    const res = await app.request("/login?next=%2Fs%2F01ABC", { headers: { host: "tim.local" } });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBeTruthy();
    expect(location.searchParams.get("client_id")).toBe("test-client");
    expect(location.searchParams.get("redirect_uri")).toBe("http://tim.local/auth/callback");
    expect(location.searchParams.get("hd")).toBe("example.com");

    const raw = cookieNamed(res, "tim_oauth") ?? "";
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("SameSite=Lax");
    expect(raw).toContain("Max-Age=600");
    const value = decodeURIComponent(raw.split(";")[0].slice("tim_oauth=".length));
    const flow = verifyValue<{ state: string; verifier: string; next: string }>(value, SECRET);
    expect(flow?.state).toBe(location.searchParams.get("state"));
    expect(flow?.next).toBe("/s/01ABC");
    expect(typeof flow?.verifier).toBe("string");
  });

  it("replaces an unsafe next with /", async () => {
    const res = await app.request("/login?next=%2F%2Fevil.example");
    const raw = cookieNamed(res, "tim_oauth") ?? "";
    const value = decodeURIComponent(raw.split(";")[0].slice("tim_oauth=".length));
    expect(verifyValue<{ next: string }>(value, SECRET)?.next).toBe("/");
  });

  it("does not pin a hosted domain when several domains are allowed", async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = "example.com,example.org";
    const res = await app.request("/login");
    expect(new URL(res.headers.get("location") ?? "").searchParams.has("hd")).toBe(false);
  });
});

describe("GET /auth/callback", () => {
  it("callback signs in an allowed account and returns to next", async () => {
    vi.mocked(exchangeCode).mockResolvedValue(idToken({}));
    const res = await callback("code=c1&state=st", oauthCookie());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/s/01ABC?v=2");
    expect(await sessionFrom(res)).toEqual({
      email: "alice@example.com",
      name: "Alice",
      picture: "https://example.com/alice.png",
    });
    expect(cookieNamed(res, "tim_oauth")).toContain("Max-Age=0");
    expect(vi.mocked(exchangeCode).mock.calls[0][0]).toMatchObject({
      code: "c1",
      codeVerifier: "ver",
      redirectUri: "http://localhost/auth/callback",
    });
  });

  it("falls back to the email for the name and null for the picture", async () => {
    vi.mocked(exchangeCode).mockResolvedValue(idToken({ name: undefined, picture: undefined }));
    const res = await callback("code=c1&state=st", oauthCookie());
    expect(await sessionFrom(res)).toEqual({ email: "alice@example.com", name: "alice@example.com", picture: null });
  });

  it("callback refuses an account outside the allowed domains with 403", async () => {
    vi.mocked(exchangeCode).mockResolvedValue(idToken({ email: "eve@evil.example", hd: "evil.example" }));
    const res = await callback("code=c1&state=st", oauthCookie());
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("このアカウントではログインできません");
    expect(body).toContain('action="/auth/logout"');
    expect(cookieNamed(res, SESSION_COOKIE)).toBeUndefined();
  });

  it("refuses an unverified email with 403", async () => {
    vi.mocked(exchangeCode).mockResolvedValue(idToken({ email_verified: false }));
    const res = await callback("code=c1&state=st", oauthCookie());
    expect(res.status).toBe(403);
    expect(cookieNamed(res, SESSION_COOKIE)).toBeUndefined();
  });

  it("callback rejects a state mismatch with 400", async () => {
    const res = await callback("code=c1&state=other", oauthCookie());
    expect(res.status).toBe(400);
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(cookieNamed(res, SESSION_COOKIE)).toBeUndefined();
  });

  it("rejects a callback without the tim_oauth cookie with 400", async () => {
    const res = await callback("code=c1&state=st");
    expect(res.status).toBe(400);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects a tim_oauth cookie signed with another secret", async () => {
    const forged = signValue({ state: "st", verifier: "v", next: "/" }, "another", 600);
    const res = await callback("code=c1&state=st", `tim_oauth=${forged}`);
    expect(res.status).toBe(400);
  });

  it("rejects a tim_oauth cookie with the wrong shape", async () => {
    const res = await callback("code=c1&state=st", oauthCookie({ verifier: 1 }));
    expect(res.status).toBe(400);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects a callback without a code with 400", async () => {
    const res = await callback("state=st&error=access_denied", oauthCookie());
    expect(res.status).toBe(400);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects with 400 when the code exchange fails", async () => {
    vi.mocked(exchangeCode).mockRejectedValue(new Error("Token endpoint returned 400"));
    const res = await callback("code=c1&state=st", oauthCookie());
    expect(res.status).toBe(400);
    expect(cookieNamed(res, SESSION_COOKIE)).toBeUndefined();
  });

  it("rejects with 400 when the ID token is for another client", async () => {
    vi.mocked(exchangeCode).mockResolvedValue(idToken({ aud: "someone-else" }));
    const res = await callback("code=c1&state=st", oauthCookie());
    expect(res.status).toBe(400);
    expect(cookieNamed(res, SESSION_COOKIE)).toBeUndefined();
  });

  it("re-checks next so a tampered-but-signed value cannot redirect off-site", async () => {
    vi.mocked(exchangeCode).mockResolvedValue(idToken({}));
    const res = await callback("code=c1&state=st", oauthCookie({ next: "//evil.example" }));
    expect(res.headers.get("location")).toBe("/");
  });
});

describe("POST /auth/logout", () => {
  it("logout clears the session", async () => {
    const res = await app.request("/logout", { method: "POST" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(cookieNamed(res, SESSION_COOKIE)).toMatch(/^tim_session=; Max-Age=0/);
  });
});
