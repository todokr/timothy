import { describe, it, expect } from "vitest";
import {
  chunkText,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
  MAX_CHUNKS_PER_FILE,
} from "./chunk.js";

describe("chunkText", () => {
  it("returns nothing for empty or blank text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("keeps a short document as a single chunk", () => {
    expect(chunkText("短い本文")).toEqual(["短い本文"]);
  });

  it("splits a long document into several chunks", () => {
    const chunks = chunkText("あ".repeat(CHUNK_SIZE * 3));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it("prefers a paragraph boundary over a hard cut", () => {
    const head = "あ".repeat(CHUNK_SIZE - 50);
    const chunks = chunkText(`${head}\n\n${"い".repeat(CHUNK_SIZE)}`);
    expect(chunks[0]).toBe(head);
  });

  it("falls back to a sentence boundary when there is no newline", () => {
    const head = `${"あ".repeat(CHUNK_SIZE - 60)}。`;
    const chunks = chunkText(`${head}${"い".repeat(CHUNK_SIZE)}`);
    expect(chunks[0].endsWith("。")).toBe(true);
  });

  it("hard-cuts when no boundary is within reach", () => {
    // 区切り文字が一切ない長文でも進む。
    const chunks = chunkText("あ".repeat(CHUNK_SIZE * 2));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBe(CHUNK_SIZE);
  });

  it("overlaps consecutive chunks so a straddling sentence survives", () => {
    const chunks = chunkText("あ".repeat(CHUNK_SIZE * 2));
    const tail = chunks[0].slice(-CHUNK_OVERLAP);
    expect(chunks[1].startsWith(tail)).toBe(true);
  });

  it("caps the number of chunks", () => {
    const chunks = chunkText("あ".repeat(CHUNK_SIZE * (MAX_CHUNKS_PER_FILE + 20)));
    expect(chunks).toHaveLength(MAX_CHUNKS_PER_FILE);
  });

  it("never splits a surrogate pair", () => {
    const chunks = chunkText("😀".repeat(CHUNK_SIZE));
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(chunk).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
  });

  it("handles mixed Japanese and English prose", () => {
    const text = `${"日本語の段落。".repeat(80)}\n\n${"English paragraph. ".repeat(80)}`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toContain("English");
    expect(chunks.join("")).toContain("日本語");
  });

  it("terminates on text made entirely of separators", () => {
    const chunks = chunkText("\n".repeat(CHUNK_SIZE * 2));
    expect(chunks).toEqual([]);
  });
});
