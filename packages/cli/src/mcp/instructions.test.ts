import { describe, expect, it } from "vitest";
import { REVIEW_WORKFLOW } from "./instructions.js";

describe("REVIEW_WORKFLOW", () => {
  it("covers every step of the review workflow", () => {
    for (const s of [
      "list_comments",
      "get_file",
      "upload_revision",
      "reply_to_comment",
      "Outdated",
      "解決にしない",
    ]) {
      expect(REVIEW_WORKFLOW).toContain(s);
    }
  });
});
