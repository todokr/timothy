import { describe, it, expect, vi, beforeEach } from "vitest";

const getSignedUrl = vi.fn();

vi.mock("./firebase.js", () => ({
  storage: { bucket: () => ({ file: () => ({ getSignedUrl }) }) },
}));

import { generateSignedCreateOnlyUploadUrl, generateSignedUploadUrl } from "./storage.js";

beforeEach(() => {
  getSignedUrl.mockReset().mockResolvedValue(["https://storage.example/signed"]);
});

describe("generateSignedCreateOnlyUploadUrl", () => {
  it("signs the if-generation-match precondition so existing objects cannot be overwritten", async () => {
    expect(await generateSignedCreateOnlyUploadUrl("p")).toBe("https://storage.example/signed");
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        version: "v4",
        action: "write",
        contentType: "text/html; charset=utf-8",
        extensionHeaders: { "x-goog-if-generation-match": "0" },
      }),
    );
  });
});

describe("generateSignedUploadUrl", () => {
  it("does not add the precondition header", async () => {
    await generateSignedUploadUrl("p");
    expect(getSignedUrl.mock.calls[0][0]).not.toHaveProperty("extensionHeaders");
  });
});
