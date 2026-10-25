import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./credentials.js", () => ({
  readCredentials: vi.fn(),
}));

import {
  apiDelete,
  apiGetContent,
  apiGetFile,
  apiList,
  apiListComments,
  apiLogoutToken,
  apiReply,
  apiUpload,
  apiUploadRevision,
} from "./api.js";
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

  it.each([
    [404, "Not found: 01F"],
    [410, "Expired: 01F"],
  ])("maps %i on issuing a revision to a readable error", async (status, message) => {
    fetchMock.mockResolvedValue(json({ error: "x" }, status));
    await expect(apiUploadRevision("01F", "x", config)).rejects.toThrow(message);
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

describe("apiUploadRevision commit retry", () => {
  const issued = () =>
    json({ uploadId: "up1", uploadUrl: "https://storage.example/put", uploadHeaders: {} });

  it("retries the commit once when it fails with a 5xx", async () => {
    fetchMock
      .mockResolvedValueOnce(issued())
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response("oops", { status: 500 }))
      .mockResolvedValueOnce(json({ id: "01F", version: 2, url: "https://api.example.com/s/01F?v=2" }));

    const result = await apiUploadRevision("01F", "x", config);

    expect(result.version).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2][0]).toBe("https://api.example.com/files/01F/versions/up1/commit");
    expect(fetchMock.mock.calls[3][0]).toBe("https://api.example.com/files/01F/versions/up1/commit");
  });

  it("gives up after one retry", async () => {
    fetchMock
      .mockResolvedValueOnce(issued())
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response("a", { status: 503 }))
      .mockResolvedValueOnce(new Response("b", { status: 502 }));
    await expect(apiUploadRevision("01F", "x", config)).rejects.toThrow("API error 502: b");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not retry the commit on a 4xx", async () => {
    fetchMock
      .mockResolvedValueOnce(issued())
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(json({ error: "Conflict" }, 409));
    await expect(apiUploadRevision("01F", "x", config)).rejects.toThrow("API error 409");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("file info, content and comments", () => {
  it("gets file info with a bearer token", async () => {
    const info = { id: "01F", title: "t", versions: [] };
    fetchMock.mockResolvedValue(json(info));
    expect(await apiGetFile("01F", config)).toEqual(info);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/files/01F");
    expect(init.headers.Authorization).toBe("Bearer tok_123");
  });

  it("gets the latest content when no version is given and a past one when given", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ id: "01F", version: 1, html: "<p>x</p>" })));
    expect(await apiGetContent("01F", undefined, config)).toEqual({ id: "01F", version: 1, html: "<p>x</p>" });
    await apiGetContent("01F", 1, config);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/files/01F/content");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.com/files/01F/content?v=1");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer tok_123");
  });

  it("lists comments", async () => {
    const comments = [{ id: "01C", body: "hi", replies: [] }];
    fetchMock.mockResolvedValue(json({ comments }));
    expect(await apiListComments("01F", config)).toEqual(comments);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/files/01F/comments");
    expect(init.headers.Authorization).toBe("Bearer tok_123");
  });

  it("posts a reply as JSON", async () => {
    const comment = { id: "01C", body: "hi", replies: [{ id: "r1" }] };
    fetchMock.mockResolvedValue(json({ comment }, 201));
    expect(await apiReply("01F", "01C", "v3 で直しました", config)).toEqual(comment);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/files/01F/comments/01C/replies");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBe("Bearer tok_123");
    expect(init.body).toBe(JSON.stringify({ body: "v3 で直しました" }));
  });

  it("URL-encodes the commentId in the reply URL", async () => {
    fetchMock.mockResolvedValue(json({ comment: { id: "x", replies: [] } }, 201));
    await apiReply("01F", "../resolve", "b", config);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/files/01F/comments/..%2Fresolve/replies"
    );
  });

  it.each([
    [404, "Not found: 01F"],
    [410, "Expired: 01F"],
  ])("maps %i to a readable error", async (status, message) => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ error: "x" }, status)));
    await expect(apiGetFile("01F", config)).rejects.toThrow(message);
    await expect(apiGetContent("01F", 2, config)).rejects.toThrow(message);
    await expect(apiListComments("01F", config)).rejects.toThrow(message);
    await expect(apiReply("01F", "01C", "b", config)).rejects.toThrow(message);
  });

  it("explains a 403 with the API error and keeps the other statuses", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Not allowed here" }, 403));
    await expect(apiGetFile("01F", config)).rejects.toThrow("Forbidden: Not allowed here");
    fetchMock.mockResolvedValueOnce(json({ error: "Unauthorized" }, 401));
    await expect(apiGetFile("01F", config)).rejects.toThrow(/tim login/);
    fetchMock.mockResolvedValueOnce(new Response("bad", { status: 400 }));
    await expect(apiReply("01F", "01C", "b", config)).rejects.toThrow("API error 400: bad");
  });
});
