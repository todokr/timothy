import { describe, it, expect } from "vitest";
import {
  makeSnippet,
  normalizeQuery,
  scanText,
  scoreHits,
} from "./textSearch.js";

describe("normalizeQuery", () => {
  it("lowercases and trims", () => {
    expect(normalizeQuery("  Hello  ")).toBe("hello");
  });

  it("applies the same NFKC folding as the stored text", () => {
    // 全角で打っても半角で保存された本文にヒットさせるため。
    expect(normalizeQuery("ＡＢＣ")).toBe("abc");
    expect(normalizeQuery("ﾚﾎﾟｰﾄ")).toBe("レポート");
  });
});

describe("scanText", () => {
  it("finds a Japanese substring without any tokenization", () => {
    const result = scanText("売上は前月比で増加した", normalizeQuery("前月比"));
    expect(result.count).toBe(1);
    expect(result.snippets[0].match).toBe("前月比");
  });

  it("matches case-insensitively", () => {
    expect(scanText("A NullPointerException occurred", normalizeQuery("nullpointer")).count).toBe(1);
  });

  it("counts every occurrence", () => {
    expect(scanText("ab ab ab", normalizeQuery("ab")).count).toBe(3);
  });

  it("caps the number of snippets but keeps counting", () => {
    const result = scanText("x ".repeat(50) + "hit hit hit hit hit", normalizeQuery("hit"));
    expect(result.count).toBe(5);
    expect(result.snippets).toHaveLength(3);
  });

  it("returns no snippets when max is zero", () => {
    const result = scanText("hit", normalizeQuery("hit"), 0);
    expect(result.count).toBe(1);
    expect(result.snippets).toHaveLength(0);
  });

  it("returns nothing for an empty query", () => {
    expect(scanText("body", "")).toEqual({ count: 0, snippets: [] });
  });

  it("returns nothing for empty text", () => {
    expect(scanText("", normalizeQuery("q"))).toEqual({ count: 0, snippets: [] });
  });

  it("does not loop forever on overlapping matches", () => {
    // 検索を進める起点をマッチ末尾に置いているので aaa 内の aa は1件。
    expect(scanText("aaa", normalizeQuery("aa")).count).toBe(1);
  });

  it("finds an identifier that a tokenizer would break apart", () => {
    const result = scanText("障害 TIM-4821 の詳細", normalizeQuery("TIM-4821"));
    expect(result.count).toBe(1);
    expect(result.snippets[0].match).toBe("TIM-4821");
  });

  it("slices the snippet out of the original text, preserving case", () => {
    const result = scanText("The Quick Brown Fox", normalizeQuery("quick"));
    expect(result.snippets[0]).toEqual({
      before: "The ",
      match: "Quick",
      after: " Brown Fox",
    });
  });
});

describe("makeSnippet", () => {
  it("clamps at the start of the text", () => {
    expect(makeSnippet("abcdef", 0, 3, 10)).toEqual({
      before: "",
      match: "abc",
      after: "def",
    });
  });

  it("clamps at the end of the text", () => {
    expect(makeSnippet("abcdef", 3, 3, 10)).toEqual({
      before: "abc",
      match: "def",
      after: "",
    });
  });

  it("limits context to the radius", () => {
    const text = "x".repeat(100) + "hit" + "y".repeat(100);
    const snippet = makeSnippet(text, 100, 3, 5);
    expect(snippet.before).toBe("xxxxx");
    expect(snippet.match).toBe("hit");
    expect(snippet.after).toBe("yyyyy");
  });
});

describe("scoreHits", () => {
  it("weights a title match above a body match", () => {
    const title = scoreHits({ titleMatches: 1, descriptionMatches: 0, bodyMatches: 0 });
    const body = scoreHits({ titleMatches: 0, descriptionMatches: 0, bodyMatches: 1 });
    expect(title).toBeGreaterThan(body);
  });

  it("weights a description match between title and body", () => {
    const description = scoreHits({ titleMatches: 0, descriptionMatches: 1, bodyMatches: 0 });
    expect(description).toBe(2);
  });

  it("accumulates body matches", () => {
    expect(scoreHits({ titleMatches: 0, descriptionMatches: 0, bodyMatches: 4 })).toBe(4);
  });
});
