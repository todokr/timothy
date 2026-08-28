import { describe, it, expect } from "vitest";
import { parseTtlOption } from "./upload.js";

describe("parseTtlOption", () => {
  it("parses a positive integer as a day count", () => {
    expect(parseTtlOption("7")).toEqual({ ok: true, ttlDays: 7 });
  });

  // null がそのまま API の無期限を意味する。
  it("parses never as the indefinite expiry", () => {
    expect(parseTtlOption("never")).toEqual({ ok: true, ttlDays: null });
  });

  // parseInt は "abc" を NaN、"7days" を 7 として返す。どちらも API に
  // そのまま送ると分かりにくい 400 になるので、CLI 側で落とす。
  it("rejects a non-numeric value", () => {
    expect(parseTtlOption("abc").ok).toBe(false);
  });

  it("rejects a value with a trailing suffix", () => {
    expect(parseTtlOption("7days").ok).toBe(false);
  });

  it("rejects zero and negative day counts", () => {
    expect(parseTtlOption("0").ok).toBe(false);
    expect(parseTtlOption("-1").ok).toBe(false);
  });

  it("rejects a fractional day count", () => {
    expect(parseTtlOption("1.5").ok).toBe(false);
  });
});

