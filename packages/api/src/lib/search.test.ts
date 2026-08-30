import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./files.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./files.js")>()),
  listFiles: vi.fn(),
}));
vi.mock("./textIndex.js", () => ({ loadTexts: vi.fn() }));

import { searchFiles } from "./search.js";
import { listFiles } from "./files.js";
import { loadTexts } from "./textIndex.js";

function future(): string {
  return new Date(Date.now() + 86_400_000).toISOString();
}
function past(): string {
  return new Date(Date.now() - 86_400_000).toISOString();
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ABC",
    title: "Monthly Report",
    description: "",
    url: "http://localhost/s/01ABC",
    expiresAt: future(),
    createdAt: "2026-08-07T03:04:00.000Z",
    ...overrides,
  };
}

function texts(entries: Array<[string, string]>, pending: string[] = []) {
  return { texts: new Map(entries), pending };
}

describe("searchFiles", () => {
  beforeEach(() => {
    vi.mocked(listFiles).mockReset();
    vi.mocked(loadTexts).mockReset();
  });

  it("matches on the body text", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    vi.mocked(loadTexts).mockResolvedValue(
      texts([["01ABC", "売上は前月比で増加した"]]),
    );

    const result = await searchFiles("前月比", "http://localhost");

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].id).toBe("01ABC");
    expect(result.hits[0].snippets[0].match).toBe("前月比");
  });

  it("matches on the title even when the body has no hit", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry({ title: "月次レポート" })]);
    vi.mocked(loadTexts).mockResolvedValue(texts([["01ABC", "無関係な本文"]]));

    const result = await searchFiles("レポート", "http://localhost");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].snippets).toHaveLength(0);
  });

  it("excludes expired files before touching the text store", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry({ id: "live", expiresAt: future() }),
      entry({ id: "dead", expiresAt: past() }),
    ]);
    vi.mocked(loadTexts).mockResolvedValue(
      texts([["live", "hit"], ["dead", "hit"]]),
    );

    const result = await searchFiles("hit", "http://localhost");

    expect(vi.mocked(loadTexts).mock.calls[0][0]).toEqual(["live"]);
    expect(result.hits.map((h) => h.id)).toEqual(["live"]);
  });

  it("ranks a title match above a body-only match", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry({ id: "body", title: "Nothing" }),
      entry({ id: "title", title: "Report" }),
    ]);
    vi.mocked(loadTexts).mockResolvedValue(
      texts([["body", "report"], ["title", "unrelated"]]),
    );

    const result = await searchFiles("report", "http://localhost");
    expect(result.hits.map((h) => h.id)).toEqual(["title", "body"]);
  });

  it("returns files whose text has not been indexed yet as misses, not errors", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry({ id: "unindexed", title: "x" })]);
    vi.mocked(loadTexts).mockResolvedValue(texts([], ["unindexed"]));

    const result = await searchFiles("anything", "http://localhost");

    expect(result.hits).toHaveLength(0);
    // UI がボタンの横に出す件数。
    expect(result.pendingCount).toBe(1);
  });

  it("returns nothing for a blank query without reading the text store", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);

    const result = await searchFiles("   ", "http://localhost");

    expect(result.hits).toHaveLength(0);
    expect(loadTexts).not.toHaveBeenCalled();
  });

  it("applies the limit", async () => {
    const files = Array.from({ length: 5 }, (_, i) => entry({ id: `f${i}` }));
    vi.mocked(listFiles).mockResolvedValue(files);
    vi.mocked(loadTexts).mockResolvedValue(
      texts(files.map((f) => [f.id, "hit"] as [string, string])),
    );

    const result = await searchFiles("hit", "http://localhost", 2);
    expect(result.hits).toHaveLength(2);
  });

  it("finds a full-width query in half-width body text", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    vi.mocked(loadTexts).mockResolvedValue(texts([["01ABC", "error code abc123"]]));

    const result = await searchFiles("ＡＢＣ１２３", "http://localhost");
    expect(result.hits).toHaveLength(1);
  });
});
