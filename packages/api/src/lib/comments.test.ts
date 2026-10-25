import { describe, it, expect } from "vitest";
import { parseBody, parseNewComment } from "./comments.js";

const TEXT = { type: "text", quote: "PVC", prefix: "", suffix: "" };

describe("parseNewComment", () => {
  it("accepts a comment on a past version", () => {
    expect(parseNewComment({ version: 1, anchor: TEXT, body: "RWX だと EBS 使えないのでは" }, 3).ok).toBe(true);
  });
  it("returns the parsed data with a trimmed body", () => {
    expect(parseNewComment({ version: 3, anchor: TEXT, body: "  hi  " }, 3)).toEqual({
      ok: true,
      data: { version: 3, anchor: TEXT, body: "hi" },
    });
  });
  it.each([0, 4, 1.5, "1"])("rejects version %j when the latest is 3", (version) => {
    expect(parseNewComment({ version, anchor: TEXT, body: "x" }, 3)).toEqual({ ok: false, error: expect.any(String) });
  });
  it("reports the allowed version range", () => {
    expect(parseNewComment({ version: 4, anchor: TEXT, body: "x" }, 3)).toEqual({
      ok: false,
      error: "version must be between 1 and 3",
    });
  });
  it("rejects an invalid anchor, extra keys and non-objects", () => {
    expect(parseNewComment({ version: 1, anchor: { type: "range" }, body: "x" }, 3).ok).toBe(false);
    expect(parseNewComment({ version: 1, anchor: TEXT, body: "x", extra: 1 }, 3).ok).toBe(false);
    expect(parseNewComment(null, 3).ok).toBe(false);
  });
});

describe("parseBody", () => {
  it("trims the body", () => {
    expect(parseBody("  x ")).toEqual({ ok: true, body: "x" });
  });
  it.each(["", "   ", "x".repeat(10001), 1])("rejects body %j", (body) => expect(parseBody(body).ok).toBe(false));
});
