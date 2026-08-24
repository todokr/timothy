import { Hono } from "hono";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase.js";
import { logger } from "../lib/logger.js";
import { getClientIp } from "../lib/ipAllowlist.js";
import { isJsonContentType, isSameOriginBrowserRequest } from "../lib/http.js";
import {
  parseSettings,
  riskLevel,
  type ResponseHeaderSettings,
} from "../lib/responseHeaders.js";

const HTML_FILES_COLLECTION = "htmlFiles";

const app = new Hono();

app.put("/:id/headers", async (c) => {
  if (!isSameOriginBrowserRequest(c)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  if (!isJsonContentType(c.req.header("content-type"))) {
    return c.json({ error: "Content-Type must be application/json" }, 415);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = parseSettings(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const id = c.req.param("id");
  const docRef = db.collection(HTML_FILES_COLLECTION).doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return c.json({ error: "Not Found" }, 404);

  const before: ResponseHeaderSettings | undefined = doc.data()!.responseHeaders;
  const after = parsed.data;
  const empty = Object.keys(after).length === 0;

  // 空の設定は「既定に戻す」。フィールドを消して未設定と同じ状態にする。
  await docRef.update({
    responseHeaders: empty ? FieldValue.delete() : after,
  });

  // 認証が無いため「誰が」は記録できない。残せるのは「いつ・どの IP から・何を」まで。
  logger.info({
    event: "headers.updated",
    fileId: id,
    clientIp: getClientIp(c),
    before: before ?? null,
    after: empty ? null : after,
    riskLevel: riskLevel(empty ? undefined : after),
  });

  return c.json({ id });
});

export default app;
