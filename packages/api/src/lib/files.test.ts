import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "hono";

vi.mock("./firebase.js", () => ({
  db: { collection: vi.fn() },
}));

import { db } from "./firebase.js";
import { resolveBaseUrl, listFiles } from "./files.js";

function makeContext(headers: Record<string, string>): Context {
  return {
    req: { header: (name: string) => headers[name.toLowerCase()] },
  } as unknown as Context;
}

function mockSnapshot(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  const getMock = vi.fn().mockResolvedValue({
    docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
  });
  const orderByMock = vi.fn().mockReturnValue({ get: getMock });
  vi.mocked(db.collection).mockReturnValue({
    orderBy: orderByMock,
  } as unknown as ReturnType<typeof db.collection>);
  return { getMock, orderByMock };
}

describe("resolveBaseUrl", () => {
  it("uses x-forwarded-proto and host when both are present", () => {
    const c = makeContext({ "x-forwarded-proto": "https", host: "api.example.com" });
    expect(resolveBaseUrl(c)).toBe("https://api.example.com");
  });

  it("falls back to http when x-forwarded-proto is absent", () => {
    const c = makeContext({ host: "api.example.com" });
    expect(resolveBaseUrl(c)).toBe("http://api.example.com");
  });

  it("falls back to localhost when host is absent", () => {
    const c = makeContext({});
    expect(resolveBaseUrl(c)).toBe("http://localhost");
  });
});

describe("listFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty array when there are no documents", async () => {
    mockSnapshot([]);
    await expect(listFiles("http://localhost")).resolves.toEqual([]);
  });

  it("maps Firestore documents to FileEntry with a share URL", async () => {
    mockSnapshot([
      {
        id: "01ABC",
        data: {
          title: "Monthly Report",
          description: "Details",
          expiresAt: { toDate: () => new Date("2026-08-14T00:00:00.000Z") },
          createdAt: { toDate: () => new Date("2026-08-07T00:00:00.000Z") },
        },
      },
    ]);

    const files = await listFiles("https://api.example.com");

    expect(files).toEqual([
      {
        id: "01ABC",
        title: "Monthly Report",
        description: "Details",
        url: "https://api.example.com/s/01ABC",
        expiresAt: "2026-08-14T00:00:00.000Z",
        createdAt: "2026-08-07T00:00:00.000Z",
      },
    ]);
  });

  it("maps a document stored with no expiry to expiresAt: null", async () => {
    mockSnapshot([
      {
        id: "01ABC",
        data: {
          title: "Handbook",
          description: "",
          expiresAt: null,
          createdAt: { toDate: () => new Date("2026-08-07T00:00:00.000Z") },
        },
      },
    ]);

    const files = await listFiles("https://api.example.com");

    expect(files[0].expiresAt).toBeNull();
  });

  it("queries the htmlFiles collection ordered by createdAt descending", async () => {
    const { orderByMock } = mockSnapshot([]);
    await listFiles("http://localhost");
    expect(db.collection).toHaveBeenCalledWith("htmlFiles");
    expect(orderByMock).toHaveBeenCalledWith("createdAt", "desc");
  });
});
