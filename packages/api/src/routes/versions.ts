import { Hono } from "hono";
import { ulid } from "ulid";
import { getUser, type AppEnv } from "../lib/auth.js";
import { db } from "../lib/firebase.js";
import { HTML_FILES_COLLECTION, resolveBaseUrl } from "../lib/files.js";
import { isJsonContentType } from "../lib/http.js";
import { UPLOAD_CONTENT_TYPE, generateSignedUploadUrl } from "../lib/storage.js";
import {
  commitRevision,
  isUploadId,
  revisionDenial,
  revisionStoragePath,
  type RevisionDenial,
} from "../lib/versions.js";

const app = new Hono<AppEnv>();

const JSON_REQUIRED = { error: "Content-Type must be application/json" };

function denialResponse(reason: RevisionDenial) {
  switch (reason) {
    case "gone":
      return { body: { error: "Gone" }, status: 410 as const };
    case "no_owner":
      return {
        body: { error: "Revisions are not allowed for files without an owner" },
        status: 403 as const,
      };
    case "forbidden":
      return { body: { error: "Forbidden" }, status: 403 as const };
  }
}

// 修正版のアップロード URL を発行する。本文は使わないが、ブラウザのセッションで呼ばれるため
// <form> からのクロスサイト送信を塞ぐ目的で JSON の Content-Type を必須にする（upload.ts と同じ）。
app.post("/:id/versions", async (c) => {
  if (!isJsonContentType(c.req.header("content-type"))) {
    return c.json(JSON_REQUIRED, 415);
  }

  const id = c.req.param("id");
  const doc = await db.collection(HTML_FILES_COLLECTION).doc(id).get();
  if (!doc.exists) return c.json({ error: "Not Found" }, 404);

  // URL は検査をすべて通ってから発行する
  const denied = revisionDenial(getUser(c), doc.data()!);
  if (denied) {
    const r = denialResponse(denied);
    return c.json(r.body, r.status);
  }

  const uploadId = ulid();
  const uploadUrl = await generateSignedUploadUrl(revisionStoragePath(id, uploadId));

  return c.json({
    uploadId,
    uploadUrl,
    uploadHeaders: { "Content-Type": UPLOAD_CONTENT_TYPE },
  });
});

// アップロード済みの修正版を新しい版として確定する。
app.post("/:id/versions/:uploadId/commit", async (c) => {
  if (!isJsonContentType(c.req.header("content-type"))) {
    return c.json(JSON_REQUIRED, 415);
  }

  const id = c.req.param("id");
  const uploadId = c.req.param("uploadId");
  if (!isUploadId(uploadId)) return c.json({ error: "Invalid upload id" }, 400);

  const result = await commitRevision({ fileId: id, uploadId, user: getUser(c) });
  if (result.ok) {
    return c.json({
      id,
      version: result.version,
      url: `${resolveBaseUrl(c)}/s/${id}?v=${result.version}`,
    });
  }

  switch (result.reason) {
    case "not_found":
      return c.json({ error: "Not Found" }, 404);
    case "content_missing":
      return c.json({ error: "Uploaded content not found" }, 409);
    default: {
      const r = denialResponse(result.reason);
      return c.json(r.body, r.status);
    }
  }
});

export default app;
