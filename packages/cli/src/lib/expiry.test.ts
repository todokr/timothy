import { describe, it, expect } from "vitest";
import { formatExpiry } from "./expiry.js";

describe("formatExpiry", () => {
  it("shows the expiry date for a time-limited file", () => {
    expect(formatExpiry("2026-09-04T01:23:45.000Z")).toBe("2026-09-04");
  });

  // upload の出力と list の EXPIRES 列で同じ語を使う。
  it("shows never for a file with no expiry", () => {
    expect(formatExpiry(null)).toBe("never");
  });
});
