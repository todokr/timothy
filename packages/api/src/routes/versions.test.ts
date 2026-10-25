import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/firebase.js", () => ({
  db: { collection: vi.fn() },
}));

// commitRevision だけ差し替え、revisionDenial などは本物を使う。
vi.mock("../lib/versions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/versions.js")>()),
  commitRevision: vi.fn(),
}));

// generateSignedUploadUrl だけ差し替える。
vi.mock("../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/storage.js")>()),
  generateSignedUploadUrl: vi.fn(),
}));

import versionsApp from "./versions.js";
import { TEST_USER, withUser } from "../test/auth.js";
import { db } from "../lib/firebase.js";
import { generateSignedUploadUrl } from "../lib/storage.js";
import { commitRevision, isUploadId, revisionStoragePath } from "../lib/versions.js";

const app = withUser(versionsApp);
const UPLOAD_ID = "01JBXXXXXXXXXXXXXXXXXXXXXX".replace(/X/g, "A");

function mockDoc(exists: boolean, data: Record<string, unknown> = {}) {
  const get = vi.fn().mockResolvedValue({ exists, data: () => data });
  vi.mocked(db.collection).mockReturnValue({
    doc: vi.fn().mockReturnValue({ get }),
  } as unknown as ReturnType<typeof db.collection>);
  return { get };
}

function post(path: string, contentType: string | null = "application/json") {
  return app.request(path, {
    method: "POST",
    headers: contentType ? { "Content-Type": contentType } : {},
    body: "{}",
  });
}

const past = { toDate: () => new Date(Date.now() - 60_000) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateSignedUploadUrl).mockResolvedValue("https://storage.example/signed");
});

describe("POST /files/:id/versions", () => {
  it("issues an upload URL under the file's own prefix for the owner", async () => {
    mockDoc(true, { ownerEmail: TEST_USER.email, expiresAt: null });
    const res = await post("/01FILE/versions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(isUploadId(body.uploadId)).toBe(true);
    expect(body.uploadUrl).toBe("https://storage.example/signed");
    expect(body.uploadHeaders).toEqual({ "Content-Type": "text/html; charset=utf-8" });
    expect(generateSignedUploadUrl).toHaveBeenCalledWith(revisionStoragePath("01FILE", body.uploadId));
  });

  it("refuses a file without an owner and issues nothing", async () => {
    mockDoc(true, { expiresAt: null });
    const res = await post("/01FILE/versions");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Revisions are not allowed for files without an owner" });
    expect(generateSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("refuses someone else's file and issues nothing", async () => {
    mockDoc(true, { ownerEmail: "other@example.com", expiresAt: null });
    const res = await post("/01FILE/versions");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(generateSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("returns 410 for an expired file", async () => {
    mockDoc(true, { ownerEmail: TEST_USER.email, expiresAt: past });
    const res = await post("/01FILE/versions");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "Gone" });
    expect(generateSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing file", async () => {
    mockDoc(false);
    const res = await post("/01FILE/versions");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not Found" });
    expect(generateSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("requires a JSON content type", async () => {
    const { get } = mockDoc(true, { ownerEmail: TEST_USER.email });
    const res = await post("/01FILE/versions", "text/plain");
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "Content-Type must be application/json" });
    expect(get).not.toHaveBeenCalled();
    expect(generateSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe("POST /files/:id/versions/:uploadId/commit", () => {
  it("returns the new version and its URL", async () => {
    vi.mocked(commitRevision).mockResolvedValue({ ok: true, version: 2 });
    const res = await post(`/01FILE/versions/${UPLOAD_ID}/commit`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "01FILE", version: 2, url: "http://localhost/s/01FILE?v=2" });
    expect(commitRevision).toHaveBeenCalledWith({ fileId: "01FILE", uploadId: UPLOAD_ID, user: TEST_USER });
  });

  it.each([
    ["not_found", 404, { error: "Not Found" }],
    ["gone", 410, { error: "Gone" }],
    ["no_owner", 403, { error: "Revisions are not allowed for files without an owner" }],
    ["forbidden", 403, { error: "Forbidden" }],
    ["content_missing", 409, { error: "Uploaded content not found" }],
  ] as const)("maps %s to %i", async (reason, status, body) => {
    vi.mocked(commitRevision).mockResolvedValue({ ok: false, reason });
    const res = await post(`/01FILE/versions/${UPLOAD_ID}/commit`);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });

  it("rejects a malformed upload id without committing", async () => {
    const res = await post("/01FILE/versions/..%2Fetc/commit");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid upload id" });
    expect(commitRevision).not.toHaveBeenCalled();
  });

  it("requires a JSON content type", async () => {
    const res = await post(`/01FILE/versions/${UPLOAD_ID}/commit`, "text/plain");
    expect(res.status).toBe(415);
    expect(commitRevision).not.toHaveBeenCalled();
  });

  it("lets a commitRevision failure surface as a 500", async () => {
    vi.mocked(commitRevision).mockRejectedValue(new Error("aborted"));
    const res = await post(`/01FILE/versions/${UPLOAD_ID}/commit`);
    expect(res.status).toBe(500);
  });
});
