import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./credentials.js", () => ({
  readCredentials: vi.fn(),
}));

import { apiDelete, apiList, apiLogoutToken, apiUpload, apiUploadRevision } from "./api.js";
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

describe("apiUploadRevision", () => {
  it("issues, uploads and commits a revision", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ uploadId: "up1", uploadUrl: "https://storage.example/put", uploadHeaders: { "X-A": "b" } })
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(json({ id: "01F", version: 2, url: "https://api.example.com/s/01F?v=2" }));

    const result = await apiUploadRevision("01F", "<h1>v2</h1>", config);

    expect(result).toEqual({ id: "01F", version: 2, url: "https://api.example.com/s/01F?v=2" });
    const [issueUrl, issueInit] = fetchMock.mock.calls[0];
    expect(issueUrl).toBe("https://api.example.com/files/01F/versions");
    expect(issueInit.method).toBe("POST");
    expect(issueInit.headers.Authorization).toBe("Bearer tok_123");
    expect(issueInit.body).toBe("{}");
    const [putUrl, putInit] = fetchMock.mock.calls[1];
    expect(putUrl).toBe("https://storage.example/put");
    expect(putInit.method).toBe("PUT");
    expect(putInit.body).toBe("<h1>v2</h1>");
    expect(putInit.headers).toEqual({ "X-A": "b" });
    const [commitUrl, commitInit] = fetchMock.mock.calls[2];
    expect(commitUrl).toBe("https://api.example.com/files/01F/versions/up1/commit");
    expect(commitInit.method).toBe("POST");
    expect(commitInit.headers.Authorization).toBe("Bearer tok_123");
    expect(commitInit.body).toBe("{}");
  });

  it("does not commit when the storage upload fails", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ uploadId: "up1", uploadUrl: "https://storage.example/put", uploadHeaders: {} }))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(apiUploadRevision("01F", "x", config)).rejects.toThrow("Storage upload failed 500: boom");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports why a revision was refused", async () => {
    fetchMock.mockResolvedValue(
      json({ error: "Revisions are not allowed for files without an owner" }, 403)
    );
    await expect(apiUploadRevision("01F", "x", config)).rejects.toThrow(
      "Forbidden: Revisions are not allowed for files without an owner"
    );
  });

  it("reports a refused commit the same way", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ uploadId: "up1", uploadUrl: "https://storage.example/put", uploadHeaders: {} }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(json({ error: "Only the owner can upload revisions" }, 403));
    await expect(apiUploadRevision("01F", "x", config)).rejects.toThrow(
      "Forbidden: Only the owner can upload revisions"
    );
  });
});
