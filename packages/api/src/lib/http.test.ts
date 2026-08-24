import { describe, it, expect } from "vitest";
import { isJsonContentType } from "./http.js";

describe("isJsonContentType", () => {
  it("accepts application/json", () => {
    expect(isJsonContentType("application/json")).toBe(true);
  });

  it("accepts application/json with a charset parameter and odd casing", () => {
    expect(isJsonContentType("Application/JSON; charset=utf-8")).toBe(true);
    expect(isJsonContentType("  application/json ; charset=UTF-8")).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(isJsonContentType(undefined)).toBe(false);
  });

  it("rejects the simple-request content types usable for cross-origin form posts", () => {
    expect(isJsonContentType("text/plain")).toBe(false);
    expect(isJsonContentType("application/x-www-form-urlencoded")).toBe(false);
    expect(isJsonContentType("multipart/form-data; boundary=x")).toBe(false);
  });
});
