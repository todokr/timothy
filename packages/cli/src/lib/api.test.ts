import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./credentials.js", () => ({
  readCredentials: vi.fn(),
}));

import { apiDelete, apiList, apiLogoutToken, apiUpload } from "./api.js";
import { readCredentials } from "./credentials.js";

const config = { apiEndpoint: "https://api.example.com" };
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(readCredentials).mockResolvedValue({ token: "tok_123" });
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("api auth", () => {
  it("sends the bearer token", async () => {
    fetchMock.mockResolvedValue(json({ files: [] }));
    await apiList(config);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer tok_123");
  });

  it("turns a 401 into a login hint", async () => {
    fetchMock.mockResolvedValue(json({ error: "Unauthorized" }, 401));
    await expect(apiList(config)).rejects.toThrow(/tim login/);
  });

  it("asks for login without calling the API when there are no credentials", async () => {
    vi.mocked(readCredentials).mockResolvedValue(null);
    await expect(apiList(config)).rejects.toThrow(/tim login/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes owner=me for --mine", async () => {
    fetchMock.mockResolvedValue(json({ files: [] }));
    await apiList(config, { mine: true });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/files?owner=me");
  });

  it("does not add a query without --mine", async () => {
    fetchMock.mockResolvedValue(json({ files: [] }));
    await apiList(config);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/files");
  });

  it("sends the bearer on delete and explains a 403", async () => {
    fetchMock.mockResolvedValue(json({ error: "Forbidden" }, 403));
    await expect(apiDelete("id1", config)).rejects.toThrow(
      "Forbidden: you are not the owner of this file"
    );
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok_123");
  });

  it("keeps the generic error for other statuses", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(apiDelete("id1", config)).rejects.toThrow("API error 500: boom");
  });

  it("sends the bearer to the API on upload but not to the storage URL", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ id: "i", uploadUrl: "https://storage.example/put", uploadHeaders: { "X-A": "b" }, url: "u", expiresAt: null })
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await apiUpload({ title: "t", description: "", ttlDays: 7 }, "<html></html>", config);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok_123");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });

  it("revokes the token with DELETE /auth/cli-token", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await apiLogoutToken(config);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/auth/cli-token");
    expect(init.method).toBe("DELETE");
    expect(init.headers.Authorization).toBe("Bearer tok_123");
  });
});
