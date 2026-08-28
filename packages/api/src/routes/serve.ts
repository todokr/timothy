import { Hono } from "hono";
import { db } from "../lib/firebase.js";
import { getFileContent } from "../lib/storage.js";
import { buildHeaders } from "../lib/responseHeaders.js";

const HTML_FILES_COLLECTION = "htmlFiles";

const app = new Hono();

app.get("/:id", async (c) => {
  const id = c.req.param("id");

  const doc = await db.collection(HTML_FILES_COLLECTION).doc(id).get();
  if (!doc.exists) return c.json({ error: "Not Found" }, 404);

  const data = doc.data()!;
  // expiresAt が null なら無期限。期限判定そのものを行わない。
  const expiresAt: Date | null = data.expiresAt ? data.expiresAt.toDate() : null;
  if (expiresAt !== null && expiresAt < new Date()) return c.json({ error: "Gone" }, 410);

  const html = await getFileContent(data.storagePath);

  // ヘッダ名はここで固定し、保存された設定から名前が渡る経路を作らない。
  // c.header() は後勝ちで上書きでき、値 undefined では削除もできるため、
  // ループで回すと設定側から床を壊せてしまう。
  const headers = buildHeaders(data.responseHeaders, expiresAt);
  c.header("Content-Security-Policy", headers.csp);
  if (headers.cacheControl) c.header("Cache-Control", headers.cacheControl);
  c.header("X-Frame-Options", headers.xFrameOptions);
  if (headers.referrerPolicy) c.header("Referrer-Policy", headers.referrerPolicy);

  return c.html(html);
});

export default app;
