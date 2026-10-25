import { describe, expect, it } from "vitest";
import { signValue, verifyValue } from "./signedCookie.js";

describe("signedCookie", () => {
  it("round-trips a payload", () => {
    const t = signValue({ email: "a@x.com" }, "s", 60, 0);
    expect(verifyValue<{ email: string }>(t, "s", 1000)?.email).toBe("a@x.com");
  });

  it("rejects a tampered payload", () => {
    const t = signValue({ email: "a@x.com" }, "s", 60, 0);
    const [, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ email: "evil@x.com", exp: 60 })).toString(
      "base64url",
    );
    expect(verifyValue(`${forged}.${sig}`, "s", 1000)).toBeNull();
  });

  it("rejects a different secret", () => {
    expect(verifyValue(signValue({}, "s", 60), "t")).toBeNull();
  });

  it("rejects an expired value", () => {
    expect(verifyValue(signValue({}, "s", 60, 0), "s", 61_000)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyValue("garbage", "s")).toBeNull();
    expect(verifyValue("a.b.c", "s")).toBeNull();
    expect(verifyValue("", "s")).toBeNull();
  });

  it("rejects a validly signed non-JSON payload", () => {
    const t = signValue({}, "s", 60, 0);
    const [, sig] = t.split(".");
    expect(verifyValue(`bm90LWpzb24.${sig}`, "s", 1000)).toBeNull();
  });
});
