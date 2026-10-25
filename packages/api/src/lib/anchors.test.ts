import { describe, it, expect } from "vitest";
import { parseAnchor } from "./anchors.js";

describe("parseAnchor", () => {
  it("accepts a text anchor and normalizes whitespace in the quote", () => {
    expect(parseAnchor({ type: "text", quote: "  PVC は\n  共有する ", prefix: "", suffix: "" })).toEqual({
      ok: true,
      anchor: { type: "text", quote: "PVC は 共有する", prefix: "", suffix: "" },
    });
  });
  it("accepts an SVG element anchor", () => {
    expect(parseAnchor({ type: "element", tag: "rect", text: "", path: [0, 3, 1] }).ok).toBe(true);
  });
  it("accepts a camelCase SVG tag", () => {
    expect(parseAnchor({ type: "element", tag: "clipPath", text: "", path: [] }).ok).toBe(true);
  });
  it.each([
    [{ type: "text", quote: "   ", prefix: "", suffix: "" }],
    [{ type: "text", quote: "x".repeat(1001), prefix: "", suffix: "" }],
    [{ type: "text", quote: "x", prefix: "p".repeat(33), suffix: "" }],
    [{ type: "text", quote: "x", prefix: "", suffix: 1 }],
    [{ type: "element", tag: "1div", text: "", path: [] }],
    [{ type: "element", tag: "div", text: "t".repeat(201), path: [] }],
    [{ type: "element", tag: "div", text: "", path: Array(65).fill(0) }],
    [{ type: "element", tag: "div", text: "", path: [-1] }],
    [{ type: "element", tag: "div", text: "", path: [100001] }],
    [{ type: "element", tag: "div", text: "", path: [1.5] }],
    [{ type: "element", tag: "div", text: "", path: [], extra: 1 }],
    [{ type: "text", quote: "x", prefix: "", suffix: "", extra: 1 }],
    [{ type: "range" }],
    [null],
  ])("rejects %j", (raw) => expect(parseAnchor(raw).ok).toBe(false));
});
