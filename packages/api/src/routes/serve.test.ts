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
  // IP allowlist. `allow-scripts` without `allow-same-origin` keeps scripts
  // (charts etc.) working while placing the document in an opaque origin.
  it("sets a sandbox CSP on the served document", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
    const res = await app.request("/01ABC");
    expect(res.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
  });

  it("does not grant allow-same-origin", async () => {
    mockDoc({ exists: true, data: () => ({ storagePath: "p", expiresAt: future() }) });
    const res = await app.request("/01ABC");
    expect(res.headers.get("content-security-policy")).not.toContain("allow-same-origin");
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
