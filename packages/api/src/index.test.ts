import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./lib/firebase.js", () => ({
  db: { collection: vi.fn() },
  storage: { bucket: vi.fn() },
}));

import app from "./index.js";
import { db } from "./lib/firebase.js";

const DENIED_IP = "203.0.113.9";

function request(path: string, method = "GET") {
  return app.request(path, {
    method,
    headers: { "x-forwarded-for": DENIED_IP },
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

  it("blocks the index endpoint", async () => {
    expect((await request("/files/01ABC/index", "POST")).status).toBe(403);
  });

  it("blocks the reindex endpoint", async () => {
    expect((await request("/files/reindex", "POST")).status).toBe(403);
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
  });

  it("does not block the file list endpoint", async () => {
    const res = await request("/files");
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
      headers: { "Content-Type": "text/plain", "Sec-Fetch-Site": "same-origin" },
    });
    expect(res.status).toBe(415);
  });
});
