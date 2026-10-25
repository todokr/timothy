import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/firebase.js", () => ({
  db: { collection: vi.fn() },
}));

// Firestore を触る 4 関数だけ差し替え、検証関数は本物を使う。
vi.mock("../lib/comments.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/comments.js")>()),
  listComments: vi.fn(),
  createComment: vi.fn(),
  addReply: vi.fn(),
  setResolved: vi.fn(),
}));

import commentsApp from "./comments.js";
import { TEST_USER, withUser } from "../test/auth.js";
import { db } from "../lib/firebase.js";
import { addReply, createComment, listComments, setResolved } from "../lib/comments.js";

const app = withUser(commentsApp);
const tokenApp = withUser(commentsApp, TEST_USER, "token");
const CID = "01JBAAAAAAAAAAAAAAAAAAAAAA";
const ANCHOR = { type: "text", quote: "hello", prefix: "", suffix: "" };
const VALID = { version: 1, anchor: ANCHOR, body: "ここを直してください" };
const COMMENT = { id: CID, body: "x" };

function mockDoc(exists: boolean, data: Record<string, unknown> = {}) {
  const get = vi.fn().mockResolvedValue({ exists, data: () => data });
  vi.mocked(db.collection).mockReturnValue({
    doc: vi.fn().mockReturnValue({ get }),
  } as unknown as ReturnType<typeof db.collection>);
  return { get };
}

function post(a: typeof app, path: string, body: unknown) {
  return a.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const past = { toDate: () => new Date(Date.now() - 60_000) };

beforeEach(() => {
  vi.resetAllMocks();
  mockDoc(true, { ownerEmail: "other@example.com", expiresAt: null, latestVersion: 2 });
  vi.mocked(listComments).mockResolvedValue([]);
  vi.mocked(createComment).mockResolvedValue(COMMENT as never);
  vi.mocked(addReply).mockResolvedValue(COMMENT as never);
  vi.mocked(setResolved).mockResolvedValue(COMMENT as never);
});

describe("comments API", () => {
  it("lists comments for a logged-in user on someone else's file", async () => {
    const res = await app.request("/01F/comments");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ comments: [] });
    expect(listComments).toHaveBeenCalledWith("01F");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("creates a comment on an ownerless legacy file", async () => {
    mockDoc(true, { expiresAt: null });
    const res = await post(app, "/01F/comments", VALID);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ comment: COMMENT });
    expect(createComment).toHaveBeenCalledWith("01F", { ...VALID, anchor: expect.anything() }, TEST_USER);
  });

  it("refuses to create a comment with a CLI token", async () => {
    const res = await post(tokenApp, "/01F/comments", VALID);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Comments can only be created from the browser" });
    expect(createComment).not.toHaveBeenCalled();
  });

  it("refuses to resolve with a CLI token", async () => {
    const res = await post(tokenApp, `/01F/comments/${CID}/resolve`, { resolved: true });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Comments can only be resolved from the browser" });
    expect(setResolved).not.toHaveBeenCalled();
  });

  it("records a reply made with a CLI token as via agent", async () => {
    const res = await post(tokenApp, `/01F/comments/${CID}/replies`, { body: "直しました" });
    expect(res.status).toBe(201);
    expect(addReply).toHaveBeenCalledWith("01F", CID, "直しました", TEST_USER, true);
  });

  it("records a browser reply as not via agent", async () => {
    await post(app, `/01F/comments/${CID}/replies`, { body: "直しました" });
    expect(addReply).toHaveBeenCalledWith("01F", CID, "直しました", TEST_USER, false);
  });

  it("resolves a comment", async () => {
    const res = await post(app, `/01F/comments/${CID}/resolve`, { resolved: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ comment: COMMENT });
    expect(setResolved).toHaveBeenCalledWith("01F", CID, true, TEST_USER);
  });

  it.each(["/01F/comments", `/01F/comments/${CID}/replies`, `/01F/comments/${CID}/resolve`])(
    "rejects a non-JSON body on %s without touching Firestore",
    async (path) => {
      const res = await app.request(path, { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" });
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: "Content-Type must be application/json" });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(db.collection).not.toHaveBeenCalled();
    }
  );

  it.each(["/01F/comments", `/01F/comments/${CID}/replies`, `/01F/comments/${CID}/resolve`])(
    "rejects broken JSON on %s",
    async (path) => {
      const res = await post(app, path, "{oops");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    }
  );

  it("rejects a version newer than the latest", async () => {
    const res = await post(app, "/01F/comments", { ...VALID, version: 3 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "version must be between 1 and 2" });
    expect(createComment).not.toHaveBeenCalled();
  });

  it("rejects extra keys and empty bodies on a reply", async () => {
    let res = await post(app, `/01F/comments/${CID}/replies`, { body: "a", extra: 1 });
    expect(res.status).toBe(400);
    res = await post(app, `/01F/comments/${CID}/replies`, { body: "  " });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "body must not be empty" });
    expect(addReply).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean or extra-key resolve body", async () => {
    let res = await post(app, `/01F/comments/${CID}/resolve`, { resolved: "yes" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "resolved must be a boolean" });
    res = await post(app, `/01F/comments/${CID}/resolve`, { resolved: true, x: 1 });
    expect(res.status).toBe(400);
    expect(setResolved).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing file", async () => {
    mockDoc(false);
    expect((await app.request("/01F/comments")).status).toBe(404);
    const res = await post(app, "/01F/comments", VALID);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not Found" });
  });

  it("returns 410 for an expired file", async () => {
    mockDoc(true, { expiresAt: past });
    const get = await app.request("/01F/comments");
    expect(get.status).toBe(410);
    expect(await get.json()).toEqual({ error: "Gone" });
    expect((await post(app, "/01F/comments", VALID)).status).toBe(410);
    expect((await post(app, `/01F/comments/${CID}/replies`, { body: "a" })).status).toBe(410);
    expect(listComments).not.toHaveBeenCalled();
    expect(createComment).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing comment", async () => {
    vi.mocked(addReply).mockResolvedValue(null);
    vi.mocked(setResolved).mockResolvedValue(null);
    const r1 = await post(app, `/01F/comments/${CID}/replies`, { body: "a" });
    expect(r1.status).toBe(404);
    expect(await r1.json()).toEqual({ error: "Comment not found" });
    expect((await post(app, `/01F/comments/${CID}/resolve`, { resolved: true })).status).toBe(404);
  });

  it("returns 404 for a malformed comment id", async () => {
    const r1 = await post(app, "/01F/comments/..%2Fx/replies", { body: "a" });
    expect(r1.status).toBe(404);
    expect(await r1.json()).toEqual({ error: "Comment not found" });
    expect((await post(app, "/01F/comments/x/resolve", { resolved: true })).status).toBe(404);
    expect(addReply).not.toHaveBeenCalled();
    expect(setResolved).not.toHaveBeenCalled();
  });
});
