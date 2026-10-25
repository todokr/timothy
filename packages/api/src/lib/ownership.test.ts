import { describe, it, expect } from "vitest";
import { canManage } from "./ownership.js";
import { TEST_USER } from "../test/auth.js";

describe("canManage", () => {
  it("lets anyone manage a legacy file without an owner", () => {
    expect(canManage(TEST_USER, {})).toBe(true);
    expect(canManage(TEST_USER, { ownerEmail: null })).toBe(true);
  });

  it("lets the owner manage, ignoring case", () => {
    expect(canManage(TEST_USER, { ownerEmail: TEST_USER.email.toUpperCase() })).toBe(true);
    expect(canManage(TEST_USER, { ownerEmail: TEST_USER.email })).toBe(true);
  });

  it("refuses someone else", () => {
    expect(canManage(TEST_USER, { ownerEmail: "other@example.com" })).toBe(false);
  });
});
