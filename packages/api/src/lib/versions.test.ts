import { describe, it, expect } from "vitest";
import {
  isUploadId,
  latestVersionOf,
  parseVersionParam,
  revisionDenial,
  revisionPrefix,
  revisionStoragePath,
} from "./versions.js";
import { TEST_USER } from "../test/auth.js";

describe("latestVersionOf", () => {
  it("treats a file without latestVersion as v1", () => {
    expect(latestVersionOf({ storagePath: "p" })).toBe(1);
  });
  it("returns the stored latestVersion", () => {
    expect(latestVersionOf({ latestVersion: 3 })).toBe(3);
  });
});

describe("parseVersionParam", () => {
  it("defaults to the latest version", () => {
    expect(parseVersionParam(undefined, 3)).toBe(3);
  });
  it.each(["1", "3"])("accepts %s", (raw) => {
    expect(parseVersionParam(raw, 3)).toBe(Number(raw));
  });
  it.each(["0", "4", "abc", "1.5", "-1", "01", "", " 2"])("rejects %j", (raw) => {
    expect(parseVersionParam(raw, 3)).toBeNull();
  });
});

describe("revisionStoragePath", () => {
  it("keeps every revision under the file's own prefix", () => {
    const path = revisionStoragePath("01FILE", "01M5S269ZPZAQ65A57RD9VR76G");
    expect(path).toBe("timothy-files/01FILE/rev-01M5S269ZPZAQ65A57RD9VR76G.html");
    expect(path.startsWith(revisionPrefix("01FILE"))).toBe(true);
  });
});

describe("isUploadId", () => {
  it("accepts a ULID", () => expect(isUploadId("01M5S269ZPZAQ65A57RD9VR76G")).toBe(true));
  it.each(["../x", "01M5S269ZPZAQ65A57RD9VR76", "01m5s269zpzaq65a57rd9vr76g", "01M5S269ZPZAQ65A57RD9VR76I"])(
    "rejects %j",
    (v) => expect(isUploadId(v)).toBe(false)
  );
});

describe("revisionDenial", () => {
  const future = { toDate: () => new Date(Date.now() + 60_000) };
  const past = { toDate: () => new Date(Date.now() - 60_000) };
  it("allows the owner", () => {
    expect(revisionDenial(TEST_USER, { ownerEmail: TEST_USER.email, expiresAt: future })).toBeNull();
  });
  it("allows the owner of a file without expiry", () => {
    expect(revisionDenial(TEST_USER, { ownerEmail: TEST_USER.email, expiresAt: null })).toBeNull();
  });
  it("refuses an expired file before looking at the owner", () => {
    expect(revisionDenial(TEST_USER, { ownerEmail: TEST_USER.email, expiresAt: past })).toBe("gone");
  });
  it("refuses a file without an owner", () => {
    expect(revisionDenial(TEST_USER, { expiresAt: null })).toBe("no_owner");
  });
  it("refuses someone else's file", () => {
    expect(revisionDenial(TEST_USER, { ownerEmail: "other@example.com", expiresAt: null })).toBe("forbidden");
  });
});
