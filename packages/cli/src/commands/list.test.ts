import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../lib/config.js", () => ({
  readConfig: vi.fn().mockResolvedValue({ apiEndpoint: "https://api.example.com", token: "t" }),
}));
vi.mock("../lib/api.js", () => ({ apiList: vi.fn() }));

import { apiList } from "../lib/api.js";
import { listCommand } from "./list.js";

afterEach(() => vi.restoreAllMocks());

describe("tim list", () => {
  it("prints v1 when the API does not return latestVersion", async () => {
    vi.mocked(apiList).mockResolvedValue([
      {
        id: "a",
        url: "https://x/s/a",
        title: "月次レポート",
        owner: null,
        createdAt: "2026-05-20T00:00:00Z",
        expiresAt: null,
      },
    ] as never);
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await listCommand.parseAsync([], { from: "user" });
    const out = write.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("v1 月次レポート");
    expect(out).not.toContain("undefined");
  });
});
