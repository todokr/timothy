import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/firebase.js", () => ({
  db: { collection: vi.fn() },
}));

vi.mock("../lib/storage.js", () => ({
  getFileContent: vi.fn(),
}));

import { db } from "../lib/firebase.js";
import { getFileContent } from "../lib/storage.js";
import app from "./serve.js";

function mockDoc(doc: unknown) {
  vi.mocked(db.collection).mockReturnValue({
    doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue(doc) }),
  } as unknown as ReturnType<typeof db.collection>);
}

function future() {
  return { toDate: () => new Date(Date.now() + 60_000) };
}

function past() {
  return { toDate: () => new Date(Date.now() - 60_000) };
}

describe("GET /s/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFileContent).mockResolvedValue("<h1>report</h1>");
  });

  it("serves the stored HTML", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
    const res = await app.request("/01ABC");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>report</h1>");
  });

  // Uploaded HTML is served from the same origin as the admin UI, so without a
  // sandbox a script inside it could call /files and /files/:id from behind the
  // IP allowlist. The grants below keep ordinary report behaviour working —
  // scripts (charts), popups (source links), downloads (CSV exports) and
  // modals (alert/confirm) — while omitting `allow-same-origin`, which keeps the
  // document in an opaque origin. `allow-forms` is deliberately not granted.
  it("sets a sandbox CSP on the served document", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
    const res = await app.request("/01ABC");
    expect(res.headers.get("content-security-policy")).toBe(
      "sandbox allow-scripts allow-popups allow-downloads allow-modals; " +
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
        "img-src data: blob:; font-src data:; connect-src 'none'; " +
        "form-action 'none'; base-uri 'none'",
    );
  });

  // Guards the one token that would undo the sandbox: with allow-same-origin the
  // document leaves its opaque origin and its scripts can reach /files and
  // /upload as same-origin requests. This must fail if anyone ever adds it.
  it("does not grant allow-same-origin", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
    const res = await app.request("/01ABC");
    expect(res.headers.get("content-security-policy")).not.toContain("allow-same-origin");
  });

  // The sandbox stops the document reaching the admin API but leaves outbound
  // traffic untouched. This is the directive that keeps a report from shipping
  // its contents to an external host, so it gets its own tripwire.
  it("denies outbound connections", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
    const res = await app.request("/01ABC");
    expect(res.headers.get("content-security-policy")).toContain("connect-src 'none'");
  });

  // 'self' matches nothing in an opaque origin, so reaching for it in any
  // directive means someone has misread how the sandbox works.
  it("never uses 'self' in any directive", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
    const res = await app.request("/01ABC");
    expect(res.headers.get("content-security-policy")).not.toContain("'self'");
  });

  // Per-content settings only widen the baseline. The header names are fixed in
  // the route, so nothing stored on the document can name a header of its own.
  describe("with stored settings", () => {
    it("applies the widened policy and the extra headers", async () => {
      mockDoc({
        exists: true,
        data: () => ({
          storagePath: "p",
          expiresAt: future(),
          responseHeaders: {
            allowedSources: { script: ["https://cdn.example.com"] },
            xFrameOptions: "DENY",
            referrerPolicy: "no-referrer",
          },
        }),
      });
      const res = await app.request("/01ABC");

      expect(res.headers.get("content-security-policy")).toContain(
        "script-src 'unsafe-inline' https://cdn.example.com",
      );
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    });

    // max-age comes from the document's own expiry, so a cached copy cannot
    // outlive the share link.
    it("caps Cache-Control at the remaining TTL", async () => {
      mockDoc({
        exists: true,
        data: () => ({
          storagePath: "p",
          expiresAt: future(),
          responseHeaders: { cacheControl: "public" },
        }),
      });
      const res = await app.request("/01ABC");

      expect(res.headers.get("cache-control")).toMatch(/^public, max-age=\d+$/);
    });

    it("omits the optional headers when they are not configured", async () => {
      mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
      const res = await app.request("/01ABC");

      expect(res.headers.get("cache-control")).toBeNull();
      expect(res.headers.get("x-frame-options")).toBeNull();
      expect(res.headers.get("referrer-policy")).toBeNull();
    });
  });

  it("returns 404 for an unknown id", async () => {
    mockDoc({ exists: false });
    expect((await app.request("/nope")).status).toBe(404);
  });

  it("returns 410 for an expired file", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: past() }) });
    expect((await app.request("/01ABC")).status).toBe(410);
  });
});
