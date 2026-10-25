import { Hono } from "hono";
import { getUser, type AppEnv } from "../lib/auth.js";
import { canManage } from "../lib/ownership.js";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/firebase.js";
import { HTML_FILES_COLLECTION } from "../lib/files.js";
import { logger } from "../lib/logger.js";
import { getClientIp } from "../lib/ipAllowlist.js";
import { isJsonContentType, isSameOriginBrowserRequest } from "../lib/http.js";
import {
  parseSettings,
  riskLevel,
  type ResponseHeaderSettings,
} from "../lib/responseHeaders.js";

const app = new Hono<AppEnv>();

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

  const user = getUser(c);
  const data = doc.data()!;
  if (!canManage(user, data)) return c.json({ error: "Forbidden" }, 403);

  const before: ResponseHeaderSettings | undefined = data.responseHeaders;
  const after = parsed.data;
  const empty = Object.keys(after).length === 0;

  // 空の設定は「既定に戻す」。フィールドを消して未設定と同じ状態にする。
  await docRef.update({
    responseHeaders: empty ? FieldValue.delete() : after,
  });

  // 「いつ・誰が・どの IP から・何を」を残す。誰が（actor）はセッションのメールアドレス。
  logger.info({
    event: "headers.updated",
    fileId: id,
    actor: user.email,
    clientIp: getClientIp(c),
    before: before ?? null,
    after: empty ? null : after,
    riskLevel: riskLevel(empty ? undefined : after),
  });

  return c.json({ id });
});

export default app;
