import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/firebase.js", () => ({
  db: { collection: vi.fn() },
}));

vi.mock("../lib/storage.js", () => ({
  getFileContent: vi.fn(),
}));

import { db } from "../lib/firebase.js";
import { getFileContent } from "../lib/storage.js";
import app from "./fileInfo.js";

type VersionDocs = Record<number, Record<string, unknown>>;

function ts(iso = "2026-01-01T00:00:00Z") {
  return { toDate: () => new Date(iso) };
}

// 親ドキュメントと versions サブコレクション（doc(n) と一覧）を返す。
function mockParent(fields: Record<string, unknown>, versions: VersionDocs = {}) {
  const parent = {
    exists: true,
    data: () => ({ createdAt: ts(), ownerEmail: "a@example.com", ownerName: "A", ...fields }),
  };
  vi.mocked(db.collection).mockReturnValue({
    doc: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue(parent),
      collection: vi.fn().mockReturnValue({
        doc: vi.fn((n: string) => ({
          get: vi.fn().mockResolvedValue(
            versions[Number(n)]
              ? { exists: true, data: () => versions[Number(n)] }
              : { exists: false },
          ),
        })),
        get: vi.fn().mockResolvedValue({
          docs: Object.entries(versions).map(([n, d]) => ({ id: n, data: () => d })),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof db.collection>);
}

function mockMissing() {
  vi.mocked(db.collection).mockReturnValue({
    doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
  } as unknown as ReturnType<typeof db.collection>);
}

const REV2 = {
  number: 2,
  storagePath: "timothy-files/01F/rev-X.html",
  createdAt: ts("2026-10-26T00:00:00Z"),
  uploaderEmail: "b@example.com",
  uploaderName: "B",
};
const PARENT = {
  title: "設計書",
  description: "",
  storagePath: "p",
  latestVersion: 2,
  ownerEmail: "a@example.com",
  ownerName: "A",
  expiresAt: null,
  createdAt: ts("2026-10-25T00:00:00Z"),
};

describe("GET /files/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns file info with every version", async () => {
    mockParent(PARENT, { 2: REV2 });
    const res = await app.request("/01F");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: "01F",
      title: "設計書",
      description: "",
      latestVersion: 2,
      url: "http://localhost/s/01F",
      owner: { email: "a@example.com", name: "A" },
      expiresAt: null,
    });
    expect(body.versions).toEqual([
      { version: 1, createdAt: "2026-10-25T00:00:00.000Z", uploadedBy: { email: "a@example.com", name: "A" } },
      { version: 2, createdAt: "2026-10-26T00:00:00.000Z", uploadedBy: { email: "b@example.com", name: "B" } },
    ]);
  });

  it("returns expiresAt as ISO and owner null for a legacy file", async () => {
    mockParent({ ...PARENT, latestVersion: undefined, ownerEmail: undefined, ownerName: undefined, expiresAt: ts("2099-01-01T00:00:00Z") });
    const body = await (await app.request("/01F")).json();
    expect(body.owner).toBeNull();
    expect(body.expiresAt).toBe("2099-01-01T00:00:00.000Z");
    expect(body.latestVersion).toBe(1);
    expect(body.versions).toHaveLength(1);
    expect(body.versions[0].uploadedBy).toBeNull();
  });

  it("returns 404 for a missing file", async () => {
    mockMissing();
    expect((await app.request("/01F")).status).toBe(404);
  });

  it("returns 410 for an expired file", async () => {
    mockParent({ ...PARENT, expiresAt: ts("2020-01-01T00:00:00Z") });
    const res = await app.request("/01F");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "Gone" });
  });

  // 既存ルート（GET /files、GET /files/:id/comments など）を食わないこと。
  it("does not match the list path or deeper paths", async () => {
    mockParent(PARENT, { 2: REV2 });
    expect((await app.request("/")).status).toBe(404);
    expect((await app.request("/01F/comments")).status).toBe(404);
    expect((await app.request("/01F/headers/edit")).status).toBe(404);
  });
});

describe("GET /files/:id/content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFileContent).mockResolvedValue("<h1>v2</h1>");
  });

  it("returns the stored HTML of the latest version as JSON, without the bridge", async () => {
    mockParent(PARENT, { 2: REV2 });
    const res = await app.request("/01F/content");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ id: "01F", version: 2, html: "<h1>v2</h1>" });
    expect(body.html).not.toContain("data-tim-bridge");
    expect(getFileContent).toHaveBeenCalledWith("timothy-files/01F/rev-X.html");
  });

  it("returns a past version when v is given", async () => {
    mockParent(PARENT, { 2: REV2 });
    vi.mocked(getFileContent).mockResolvedValue("<h1>v1</h1>");
    const res = await app.request("/01F/content?v=1");
    expect(await res.json()).toEqual({ id: "01F", version: 1, html: "<h1>v1</h1>" });
    expect(getFileContent).toHaveBeenCalledWith("p");
  });

  it.each(["0", "3", "abc"])("returns 404 for v=%s", async (v) => {
    mockParent(PARENT, { 2: REV2 });
    const res = await app.request(`/01F/content?v=${v}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not Found" });
    expect(getFileContent).not.toHaveBeenCalled();
  });

  it("returns 410 for an expired file even when v is invalid", async () => {
    mockParent({ ...PARENT, expiresAt: ts("2020-01-01T00:00:00Z") }, { 2: REV2 });
    expect((await app.request("/01F/content")).status).toBe(410);
    expect((await app.request("/01F/content?v=99")).status).toBe(410);
    expect(getFileContent).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing file", async () => {
    mockMissing();
    expect((await app.request("/01F/content")).status).toBe(404);
  });
});
