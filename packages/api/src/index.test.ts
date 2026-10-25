import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from "vitest";

vi.mock("./lib/firebase.js", () => ({
  db: { collection: vi.fn() },
  storage: { bucket: vi.fn() },
}));

vi.mock("./lib/cliTokens.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/cliTokens.js")>()),
  findCliTokenUser: vi.fn(),
}));

import app from "./index.js";
import { db } from "./lib/firebase.js";
import { signValue } from "./lib/signedCookie.js";
import { TEST_USER, sessionCookieHeader } from "./test/auth.js";
import { findCliTokenUser } from "./lib/cliTokens.js";

const DENIED_IP = "203.0.113.9";

function request(path: string, method = "GET", headers: Record<string, string> = {}) {
  return app.request(path, {
    method,
    headers: { "x-forwarded-for": DENIED_IP, ...headers },
  });
}

describe("IP allowlist coverage", () => {
  beforeEach(() => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
  });

  afterEach(() => {
    delete process.env.ALLOWED_IPS;
  });

  it("blocks the web UI", async () => {
    expect((await request("/")).status).toBe(403);
  });

  it("blocks the upload endpoint", async () => {
    expect((await request("/upload", "POST")).status).toBe(403);
  });

  it("blocks the file list endpoint", async () => {
    expect((await request("/files")).status).toBe(403);
  });

  it("blocks the delete endpoint", async () => {
    expect((await request("/files/01ABC", "DELETE")).status).toBe(403);
  });

  it("blocks the share endpoint", async () => {
    expect((await request("/s/01ABC")).status).toBe(403);
  });

  // The header settings endpoints sit under /files/*, so they inherit the
  // allowlist. Asserted explicitly because the mount is easy to move.
  it("blocks the header settings endpoints", async () => {
    expect((await request("/files/01ABC/headers")).status).toBe(403);
    expect((await request("/files/01ABC/headers", "PUT")).status).toBe(403);
  });

  it("blocks the auth endpoints", async () => {
    expect((await request("/auth/login")).status).toBe(403);
    expect((await request("/auth/callback")).status).toBe(403);
    expect((await request("/auth/logout", "POST")).status).toBe(403);
    expect((await request("/auth/cli")).status).toBe(403);
    expect((await request("/auth/cli", "POST")).status).toBe(403);
    expect((await request("/auth/cli-token", "DELETE")).status).toBe(403);
  });

  it("does not block the health endpoint", async () => {
    expect((await request("/health")).status).toBe(200);
  });
});

describe("without ALLOWED_IPS", () => {
  beforeEach(() => {
    delete process.env.ALLOWED_IPS;
    // Give /files a working Firestore mock so the route actually succeeds.
    // Asserting 200 (rather than "not 403") is what makes this test fail if the
    // middleware stops letting the request through.
    vi.mocked(db.collection).mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      }),
    } as unknown as ReturnType<typeof db.collection>);
  });

  afterEach(() => {
    vi.mocked(db.collection).mockReset();
    vi.mocked(findCliTokenUser).mockReset();
  });

  it("accepts a valid bearer token on /files", async () => {
    vi.mocked(findCliTokenUser).mockResolvedValue(TEST_USER);
    const res = await request("/files", "GET", { authorization: "Bearer tok_1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ files: [] });
    expect(findCliTokenUser).toHaveBeenCalledWith("tok_1");
  });

  it("returns 401 for a revoked token", async () => {
    vi.mocked(findCliTokenUser).mockResolvedValue(null);
    const res = await request("/files", "GET", { authorization: "Bearer tok_1" });
    expect(res.status).toBe(401);
  });

  it("does not block the file list endpoint", async () => {
    const res = await request("/files", "GET", { cookie: sessionCookieHeader() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ files: [] });
  });

  // Proves the header route is actually mounted at /files/:id/headers. The
  // allowlist returns 403 for any /files/* path whether a route exists or not,
  // so the blocked-endpoint test above cannot tell a wrong mount from a right
  // one. 415 comes only from the handler, so a bad mount shows up as 404 here.
  it("mounts the header settings endpoint", async () => {
    const res = await app.request("/files/01ABC/headers", {
      method: "PUT",
      headers: {
        "Content-Type": "text/plain",
        "Sec-Fetch-Site": "same-origin",
        cookie: sessionCookieHeader(),
      },
    });
    expect(res.status).toBe(415);
  });
});

describe("authentication", () => {
  beforeEach(() => {
    delete process.env.ALLOWED_IPS;
  });

  it("redirects an anonymous browser on /s/:id to login, keeping the query", async () => {
    const res = await app.request("/s/01ABC?v=2");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login?next=%2Fs%2F01ABC%3Fv%3D2");
  });

  it("redirects an anonymous browser on the top page to login", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login?next=%2F");
  });

  it("redirects the header edit page rather than returning JSON", async () => {
    const res = await app.request("/files/01ABC/headers/edit");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/auth/login?next=%2Ffiles%2F01ABC%2Fheaders%2Fedit");
  });

  // redirect と json の requireUser が両方当たるパス。ログイン済みならハンドラまで届くこと
  it("lets a signed-in user reach the header edit page", async () => {
    onTestFinished(() => {
      vi.mocked(db.collection).mockReset();
    });
    vi.mocked(db.collection).mockReturnValue({
      doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
    } as unknown as ReturnType<typeof db.collection>);
    const res = await app.request("/files/01ABC/headers/edit", {
      headers: { cookie: sessionCookieHeader() },
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("指定されたファイルが見つかりません");
  });

  it.each([
    ["/files", "GET"],
    ["/upload", "POST"],
    ["/files/01ABC", "DELETE"],
    ["/files/01ABC/headers", "PUT"],
  ])("returns 401 JSON for anonymous %s %s", async (path, method) => {
    const res = await app.request(path, { method });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  // auth.tsx は next を "/auth/cli?..." と決め打ちで組むので、実際のマウント先と一致することを確かめる
  it("sends an anonymous CLI login to login and back to /auth/cli", async () => {
    const res = await app.request("/auth/cli?port=53682&state=abcdefghijklmnop_-XY");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/auth/login?next=%2Fauth%2Fcli%3Fport%3D53682%26state%3Dabcdefghijklmnop_-XY",
    );
  });

  it("shows the CLI login confirmation to a signed-in user", async () => {
    const res = await app.request("/auth/cli?port=53682&state=abcdefghijklmnop_-XY", {
      headers: { cookie: sessionCookieHeader() },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`${TEST_USER.email} として CLI にログインします`);
  });

  it("keeps /health open", async () => {
    expect((await app.request("/health")).status).toBe(200);
  });

  it("leaves /auth/login reachable without a session", async () => {
    const res = await app.request("/auth/login");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^https:\/\/accounts\.google\.com\//);
  });

  it("rejects a session cookie signed with another secret", async () => {
    const forged = signValue(TEST_USER, "another-secret", 60);
    const res = await app.request("/files", { headers: { cookie: `tim_session=${forged}` } });
    expect(res.status).toBe(401);
  });

  it("rejects an expired session cookie", async () => {
    const expired = signValue(TEST_USER, "test-session-secret", 60, Date.now() - 120_000);
    const res = await app.request("/files", { headers: { cookie: `tim_session=${expired}` } });
    expect(res.status).toBe(401);
  });
});

describe("GET /files owners", () => {
  const createdAt = { toDate: () => new Date("2026-08-07T00:00:00.000Z") };
  const base = { description: "", expiresAt: null, createdAt };

  beforeEach(() => {
    delete process.env.ALLOWED_IPS;
    vi.mocked(db.collection).mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          docs: [
            { id: "01MINE", data: () => ({ ...base, title: "Mine", ownerEmail: TEST_USER.email, ownerName: TEST_USER.name }) },
            { id: "01OTHER", data: () => ({ ...base, title: "Other", ownerEmail: "other@example.com", ownerName: "Other" }) },
            { id: "01LEGACY", data: () => ({ ...base, title: "Legacy" }) },
          ],
        }),
      }),
    } as unknown as ReturnType<typeof db.collection>);
  });

  afterEach(() => {
    vi.mocked(db.collection).mockReset();
  });

  const get = (path: string) => app.request(path, { headers: { cookie: sessionCookieHeader() } });

  it("returns everyone's files with owners", async () => {
    const res = await get("/files");
    const { files } = (await res.json()) as { files: Array<{ id: string; owner: unknown }> };

    expect(res.status).toBe(200);
    expect(files.map((f) => f.id)).toEqual(["01MINE", "01OTHER", "01LEGACY"]);
    expect(files[0].owner).toEqual({ email: TEST_USER.email, name: TEST_USER.name });
    expect(files[2].owner).toBeNull();
  });

  it("filters to the caller's files with ?owner=me", async () => {
    const res = await get("/files?owner=me");
    const { files } = (await res.json()) as { files: Array<{ id: string }> };

    expect(res.status).toBe(200);
    expect(files.map((f) => f.id)).toEqual(["01MINE"]);
  });

  it("rejects any other owner value", async () => {
    const res = await get("/files?owner=other@example.com");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'owner must be "me"' });
  });
});
