import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { ulid } from "ulid";
import { parseAnchor, type Anchor } from "./anchors.js";
import { db } from "./firebase.js";
import { HTML_FILES_COLLECTION } from "./files.js";
import type { SessionUser } from "./session.js";
import { now } from "./time.js";

export const COMMENTS_SUBCOLLECTION = "comments";
export const COMMENT_BODY_MAX = 10000;

export type Person = { email: string; name: string };

export type CommentReply = {
  id: string;
  body: string;
  author: Person;
  viaAgent: boolean;
  createdAt: string;
};

export type CommentDto = {
  id: string;
  version: number;
  anchor: Anchor;
  body: string;
  author: Person;
  createdAt: string;
  resolved: boolean;
  resolvedBy: Person | null;
  resolvedAt: string | null;
  replies: CommentReply[];
};

export function parseBody(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "body must be a string" };
  const body = raw.trim();
  if (body.length === 0) return { ok: false, error: "body must not be empty" };
  if (body.length > COMMENT_BODY_MAX) {
    return { ok: false, error: `body must be at most ${COMMENT_BODY_MAX} characters` };
  }
  return { ok: true, body };
}

export function parseNewComment(
  raw: unknown,
  latest: number
):
  | { ok: true; data: { version: number; anchor: Anchor; body: string } }
  | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "request body must be an object" };
  }
  const obj = raw as Record<string, unknown>;
  if (!Object.keys(obj).every((k) => k === "version" || k === "anchor" || k === "body")) {
    return { ok: false, error: "request body has unexpected fields" };
  }
  const version = obj.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > latest) {
    return { ok: false, error: `version must be between 1 and ${latest}` };
  }
  const anchor = parseAnchor(obj.anchor);
  if (!anchor.ok) return anchor;
  const body = parseBody(obj.body);
  if (!body.ok) return body;
  return { ok: true, data: { version, anchor: anchor.anchor, body: body.body } };
}

function commentsRef(fileId: string) {
  return db.collection(HTML_FILES_COLLECTION).doc(fileId).collection(COMMENTS_SUBCOLLECTION);
}

function toIso(value: { toDate(): Date }): string {
  return value.toDate().toISOString();
}

function toDto(id: string, data: DocumentData): CommentDto {
  const resolved = data.resolved === true;
  return {
    id,
    version: data.version,
    anchor: data.anchor,
    body: data.body,
    author: { email: data.authorEmail, name: data.authorName },
    createdAt: toIso(data.createdAt),
    resolved,
    resolvedBy: resolved && data.resolvedByEmail ? { email: data.resolvedByEmail, name: data.resolvedByName } : null,
    resolvedAt: resolved && data.resolvedAt ? toIso(data.resolvedAt) : null,
    replies: ((data.replies ?? []) as DocumentData[]).map((r) => ({
      id: r.id,
      body: r.body,
      author: { email: r.authorEmail, name: r.authorName },
      viaAgent: r.viaAgent === true,
      createdAt: toIso(r.createdAt),
    })),
  };
}

/** 作成日時の昇順。 */
export async function listComments(fileId: string): Promise<CommentDto[]> {
  const snap = await commentsRef(fileId).orderBy("createdAt", "asc").get();
  return snap.docs.map((doc) => toDto(doc.id, doc.data()));
}

export async function createComment(
  fileId: string,
  data: { version: number; anchor: Anchor; body: string },
  user: SessionUser
): Promise<CommentDto> {
  const id = ulid();
  const doc = {
    version: data.version,
    anchor: data.anchor,
    body: data.body,
    authorEmail: user.email,
    authorName: user.name,
    createdAt: now(),
    resolved: false,
    resolvedAt: null,
    resolvedByEmail: null,
    resolvedByName: null,
    replies: [],
  };
  const ref = commentsRef(fileId).doc(id);
  await ref.set(doc);
  return toDto(id, (await ref.get()).data()!);
}

/** コメントが無ければ null。 */
export async function addReply(
  fileId: string,
  commentId: string,
  body: string,
  user: SessionUser,
  viaAgent: boolean
): Promise<CommentDto | null> {
  const ref = commentsRef(fileId).doc(commentId);
  if (!(await ref.get()).exists) return null;
  const reply = {
    id: ulid(),
    body,
    authorEmail: user.email,
    authorName: user.name,
    viaAgent,
    createdAt: now(),
  };
  try {
    await ref.update({ replies: FieldValue.arrayUnion(reply) });
  } catch (e) {
    if ((e as { code?: number }).code === 5) return null; // NOT_FOUND（確認後に消えた）
    throw e;
  }
  const snap = await ref.get();
  return snap.exists ? toDto(snap.id, snap.data()!) : null;
}

/** コメントが無ければ null。未解決に戻すと resolvedBy・resolvedAt は null になる。 */
export async function setResolved(
  fileId: string,
  commentId: string,
  resolved: boolean,
  user: SessionUser
): Promise<CommentDto | null> {
  const ref = commentsRef(fileId).doc(commentId);
  try {
    await ref.update(
      resolved
        ? { resolved: true, resolvedAt: now(), resolvedByEmail: user.email, resolvedByName: user.name }
        : { resolved: false, resolvedAt: null, resolvedByEmail: null, resolvedByName: null }
    );
  } catch (e) {
    if ((e as { code?: number }).code === 5) return null; // NOT_FOUND
    throw e;
  }
  const snap = await ref.get();
  return snap.exists ? toDto(snap.id, snap.data()!) : null;
}
