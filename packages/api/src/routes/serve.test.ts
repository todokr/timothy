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

type VersionDocs = Record<number, Record<string, unknown>>;

// 親ドキュメントと versions/{n} を返す。v1 の組み立てに createdAt が要るので、
// 各テストが書かなくても済むよう親に既定値を足す。
function mockDoc(parent: { exists: boolean; data?: () => Record<string, unknown> }, versions: VersionDocs = {}) {
  const doc = parent.exists
    ? { exists: true, data: () => ({ createdAt: ts(), ...parent.data!() }) }
    : parent;
  vi.mocked(db.collection).mockReturnValue({
    doc: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue(doc),
      collection: vi.fn().mockReturnValue({
        doc: vi.fn((n: string) => ({
          get: vi.fn().mockResolvedValue(
            versions[Number(n)]
              ? { exists: true, data: () => versions[Number(n)] }
              : { exists: false },
          ),
        })),
      }),
    }),
  } as unknown as ReturnType<typeof db.collection>);
}

function mockParent(fields: Record<string, unknown>, versions: VersionDocs = {}) {
  mockDoc(
    { exists: true, data: () => ({ ownerEmail: "a@example.com", ownerName: "A", ...fields }) },
    versions,
  );
}

function ts() {
  return { toDate: () => new Date("2026-01-01T00:00:00Z") };
}

function future() {
  return { toDate: () => new Date(Date.now() + 60_000) };
}

function past() {
  return { toDate: () => new Date(Date.now() - 60_000) };
}

describe("GET /s/:id/v/:n", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFileContent).mockResolvedValue("<h1>report</h1>");
  });

  it("serves v1 from the parent's storagePath for a legacy file", async () => {
    mockParent({ storagePath: "timothy-files/01ABC.html", expiresAt: future() });
    const res = await app.request("/01ABC/v/1");
    expect(res.status).toBe(200);
    expect(getFileContent).toHaveBeenCalledWith("timothy-files/01ABC.html");
  });

  it("serves a revision from its own object", async () => {
    mockParent(
      { storagePath: "timothy-files/01ABC.html", latestVersion: 2, expiresAt: null },
      { 2: { number: 2, storagePath: "timothy-files/01ABC/rev-X.html", createdAt: ts(), uploaderEmail: "a@example.com", uploaderName: "A" } },
    );
    const res = await app.request("/01ABC/v/2");
    expect(res.status).toBe(200);
    expect(getFileContent).toHaveBeenCalledWith("timothy-files/01ABC/rev-X.html");
  });

  it.each(["0", "3", "abc", "1.5", "01"])("returns 404 for version %j", async (n) => {
    mockParent({ storagePath: "p", latestVersion: 2, expiresAt: null });
    expect((await app.request(`/01ABC/v/${n}`)).status).toBe(404);
    expect(getFileContent).not.toHaveBeenCalled();
  });

  it("returns 404 when the version document is missing", async () => {
    mockParent({ storagePath: "p", latestVersion: 2, expiresAt: null });
    expect((await app.request("/01ABC/v/2")).status).toBe(404);
    expect(getFileContent).not.toHaveBeenCalled();
  });

  it.each(["1", "2", "9"])("returns 410 for an expired file whichever version is asked (v%s)", async (n) => {
    mockParent({ storagePath: "p", latestVersion: 2, expiresAt: past() });
    expect((await app.request(`/01ABC/v/${n}`)).status).toBe(410);
    expect(getFileContent).not.toHaveBeenCalled();
  });

  it("does not route GET /:id any more", async () => {
    mockParent({ storagePath: "p", expiresAt: null });
    expect((await app.request("/01ABC")).status).toBe(404);
  });

  it("serves the stored HTML", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
    const res = await app.request("/01ABC/v/1");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>report</h1>");
  });

  it("serves the stored HTML with the bridge injected and the CSP unchanged", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
    const res = await app.request("/01ABC/v/1");
    const text = await res.text();
    expect(text).toContain("<script data-tim-bridge>");
    expect(text).toContain("<h1>report</h1>");
    expect(res.headers.get("content-security-policy")).toContain("connect-src 'none'");
  });

  // Uploaded HTML is served from the same origin as the admin UI, so without a
  // sandbox a script inside it could call /files and /files/:id from behind the
  // IP allowlist. The grants below keep ordinary report behaviour working —
  // scripts (charts), popups (source links), downloads (CSV exports) and
  // modals (alert/confirm) — while omitting `allow-same-origin`, which keeps the
  // document in an opaque origin. `allow-forms` is deliberately not granted.
  it("sets a sandbox CSP on the served document", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
    const res = await app.request("/01ABC/v/1");
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
    const res = await app.request("/01ABC/v/1");
    expect(res.headers.get("content-security-policy")).not.toContain("allow-same-origin");
  });

  // The sandbox stops the document reaching the admin API but leaves outbound
  // traffic untouched. This is the directive that keeps a report from shipping
  // its contents to an external host, so it gets its own tripwire.
  it("denies outbound connections", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
    const res = await app.request("/01ABC/v/1");
    expect(res.headers.get("content-security-policy")).toContain("connect-src 'none'");
  });

  // 'self' matches nothing in an opaque origin, so reaching for it in any
  // directive means someone has misread how the sandbox works.
  it("never uses 'self' in any directive", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
    const res = await app.request("/01ABC/v/1");
    expect(res.headers.get("content-security-policy")).not.toContain("'self'");
  });

  // The CSP must not carry frame-ancestors: adding it would only suppress the
  // header below. Rationale at buildHeaders.
  it("allows framing only from the same origin", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
    const res = await app.request("/01ABC/v/1");

    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("content-security-policy")).not.toContain("frame-ancestors");
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
            referrerPolicy: "no-referrer",
          },
        }),
      });
      const res = await app.request("/01ABC/v/1");

      expect(res.headers.get("content-security-policy")).toContain(
        "script-src 'unsafe-inline' https://cdn.example.com",
      );
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
          responseHeaders: { cacheControl: "private" },
        }),
      });
      const res = await app.request("/01ABC/v/1");

      expect(res.headers.get("cache-control")).toMatch(/^private, max-age=\d+$/);
    });

    it("omits the optional headers when they are not configured", async () => {
      mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
      const res = await app.request("/01ABC/v/1");

      expect(res.headers.get("cache-control")).toBeNull();
      expect(res.headers.get("referrer-policy")).toBeNull();
    });
  });

  it("returns 404 for an unknown id", async () => {
    mockDoc({ exists: false });
    expect((await app.request("/nope/v/1")).status).toBe(404);
  });

  it("returns 410 for an expired file", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: past() }) });
    expect((await app.request("/01ABC/v/1")).status).toBe(410);
  });

  // expiresAt: null は無期限。期限判定そのものを行わない。
  it("serves a file stored with no expiry", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: null }) });
    const res = await app.request("/01ABC/v/1");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>report</h1>");
  });
});
