import { Hono, type Context } from "hono";
import { getAuthMethod, getUser, type AppEnv } from "../lib/auth.js";
import { addReply, createComment, listComments, parseBody, parseNewComment, setResolved } from "../lib/comments.js";
import { db } from "../lib/firebase.js";
import { HTML_FILES_COLLECTION } from "../lib/files.js";
import { isJsonContentType } from "../lib/http.js";
import { isUploadId, latestVersionOf } from "../lib/versions.js";

const app = new Hono<AppEnv>();

const JSON_REQUIRED = { error: "Content-Type must be application/json" };
const COMMENT_NOT_FOUND = { error: "Comment not found" };

type FileDoc = Awaited<ReturnType<ReturnType<ReturnType<typeof db.collection>["doc"]>["get"]>>;
type FileCheck = { ok: true } | { ok: false; res: Response };

function fetchFile(id: string): Promise<FileDoc> {
  return db.collection(HTML_FILES_COLLECTION).doc(id).get();
}

// 親ファイルの存在と期限を確かめる。所有者は問わない（ログイン済みなら誰でも読み書きできる）。
function checkFile(c: Context<AppEnv>, doc: FileDoc): FileCheck {
  if (!doc.exists) return { ok: false, res: c.json({ error: "Not Found" }, 404) };
  const expiresAt: Date | null = doc.data()!.expiresAt ? doc.data()!.expiresAt.toDate() : null;
  if (expiresAt !== null && expiresAt < new Date()) return { ok: false, res: c.json({ error: "Gone" }, 410) };
  return { ok: true };
}

app.get("/:id/comments", async (c) => {
  const file = checkFile(c, await fetchFile(c.req.param("id")));
  if (!file.ok) return file.res;
  return c.json({ comments: await listComments(c.req.param("id")) });
});

app.post("/:id/comments", async (c) => {
  if (!isJsonContentType(c.req.header("content-type"))) return c.json(JSON_REQUIRED, 415);
  if (getAuthMethod(c) === "token") {
    return c.json({ error: "Comments can only be created from the browser" }, 403);
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const id = c.req.param("id");
  const parent = await fetchFile(id);
  // 検証の 400 を 404・410 より先に返す。ファイルが無いときは版の上限が決まらないので、版の範囲以外だけ検証する。
  const latest = parent.exists ? latestVersionOf(parent.data()!) : Number.MAX_SAFE_INTEGER;
  const parsed = parseNewComment(raw, latest);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const file = checkFile(c, parent);
  if (!file.ok) return file.res;
  return c.json({ comment: await createComment(id, parsed.data, getUser(c)) }, 201);
});

app.post("/:id/comments/:commentId/replies", async (c) => {
  if (!isJsonContentType(c.req.header("content-type"))) return c.json(JSON_REQUIRED, 415);
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return c.json({ error: "request body must be an object" }, 400);
  }
  if (!Object.keys(raw).every((k) => k === "body")) {
    return c.json({ error: "request body has unexpected fields" }, 400);
  }
  const body = parseBody((raw as Record<string, unknown>).body);
  if (!body.ok) return c.json({ error: body.error }, 400);

  const id = c.req.param("id");
  const file = checkFile(c, await fetchFile(id));
  if (!file.ok) return file.res;
  const commentId = c.req.param("commentId");
  if (!isUploadId(commentId)) return c.json(COMMENT_NOT_FOUND, 404);

  // CLI トークンでの返信はエージェントによるものとして記録する
  const comment = await addReply(id, commentId, body.body, getUser(c), getAuthMethod(c) === "token");
  if (!comment) return c.json(COMMENT_NOT_FOUND, 404);
  return c.json({ comment }, 201);
});

app.post("/:id/comments/:commentId/resolve", async (c) => {
  if (!isJsonContentType(c.req.header("content-type"))) return c.json(JSON_REQUIRED, 415);
  if (getAuthMethod(c) === "token") {
    return c.json({ error: "Comments can only be resolved from the browser" }, 403);
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const obj = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (obj === null) return c.json({ error: "request body must be an object" }, 400);
  if (!Object.keys(obj).every((k) => k === "resolved")) {
    return c.json({ error: "request body has unexpected fields" }, 400);
  }
  if (typeof obj.resolved !== "boolean") return c.json({ error: "resolved must be a boolean" }, 400);

  const id = c.req.param("id");
  const file = checkFile(c, await fetchFile(id));
  if (!file.ok) return file.res;
  const commentId = c.req.param("commentId");
  if (!isUploadId(commentId)) return c.json(COMMENT_NOT_FOUND, 404);

  const comment = await setResolved(id, commentId, obj.resolved, getUser(c));
  if (!comment) return c.json(COMMENT_NOT_FOUND, 404);
  return c.json({ comment });
});

export default app;
