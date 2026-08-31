import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/search.js", () => ({ searchFiles: vi.fn() }));

import app from "./search.js";
import { searchFiles } from "../lib/search.js";

function emptyResult(overrides: Record<string, unknown> = {}) {
  return { query: "q", hits: [], pendingCount: 0, ...overrides };
}

describe("GET /search", () => {
  beforeEach(() => {
    vi.mocked(searchFiles).mockReset();
    vi.mocked(searchFiles).mockResolvedValue(emptyResult() as never);
  });

  it("returns 400 when q is missing", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(400);
    expect(searchFiles).not.toHaveBeenCalled();
  });

  it("returns 400 when q is only whitespace", async () => {
    const res = await app.request("/?q=%20%20");
    expect(res.status).toBe(400);
  });

  it("returns the hits with their snippets", async () => {
    vi.mocked(searchFiles).mockResolvedValue({
      query: "前月比",
      pendingCount: 2,
      hits: [
        {
          id: "01ABC",
          title: "月次レポート",
          description: "説明",
          url: "http://localhost/s/01ABC",
          expiresAt: "2099-01-01T00:00:00.000Z",
          createdAt: "2026-08-07T03:04:00.000Z",
          score: 7,
          snippets: [{ before: "売上は", match: "前月比", after: "で増加" }],
        },
      ],
    } as never);

    const res = await app.request("/?q=%E5%89%8D%E6%9C%88%E6%AF%94");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      query: "前月比",
      total: 1,
      pendingCount: 2,
      results: [
        {
          id: "01ABC",
          title: "月次レポート",
          description: "説明",
          url: "http://localhost/s/01ABC",
          expiresAt: "2099-01-01T00:00:00.000Z",
          createdAt: "2026-08-07T03:04:00.000Z",
          score: 7,
          snippets: [{ before: "売上は", match: "前月比", after: "で増加" }],
        },
      ],
    });
  });

  it("defaults the limit to 20", async () => {
    await app.request("/?q=x");
    expect(vi.mocked(searchFiles).mock.calls[0][2]).toBe(20);
  });

  it("honours an explicit limit", async () => {
    await app.request("/?q=x&limit=5");
    expect(vi.mocked(searchFiles).mock.calls[0][2]).toBe(5);
  });

  it("caps the limit at 100", async () => {
    await app.request("/?q=x&limit=99999");
    expect(vi.mocked(searchFiles).mock.calls[0][2]).toBe(100);
  });

  it("falls back to the default for a non-numeric limit", async () => {
    await app.request("/?q=x&limit=abc");
    expect(vi.mocked(searchFiles).mock.calls[0][2]).toBe(20);
  });

  it("falls back to the default for a non-positive limit", async () => {
    await app.request("/?q=x&limit=0");
    expect(vi.mocked(searchFiles).mock.calls[0][2]).toBe(20);
  });

  it("trims the query before searching", async () => {
    await app.request("/?q=%20hello%20");
    expect(vi.mocked(searchFiles).mock.calls[0][0]).toBe("hello");
  });
});
