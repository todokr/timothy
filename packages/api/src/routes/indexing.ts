import { Hono } from "hono";
import { indexStateOf, listFiles, resolveBaseUrl } from "../lib/files.js";
import { CURRENT_EXTRACTOR_VERSION } from "../lib/htmlText.js";
import { indexFile } from "../lib/textIndex.js";
import { epochMills, isExpired } from "../lib/time.js";

// /files 配下にマウントするので ipAllowlistMiddleware の "/files/*" がそのまま効く
// （index.test.ts の 403 ケースでその前提を固定している）。
const app = new Hono();

/** Lambda + API Gateway の29秒タイムアウトに収める。残りは呼び出し側が繰り返す。 */
const REINDEX_BATCH_LIMIT = 10;

app.post("/reindex", async (c) => {
  const files = await listFiles(resolveBaseUrl(c));
  const nowMs = epochMills();
  const pending = files
    .filter((file) => !isExpired(file.expiresAt, nowMs))
    .filter((file) => indexStateOf(file, CURRENT_EXTRACTOR_VERSION) !== "indexed")
    .map((file) => file.id);

  const batch = pending.slice(0, REINDEX_BATCH_LIMIT);

  // 1件の失敗でバッチ全体を落とさない。リトライはもう一度呼ぶだけ。
  const results = await Promise.all(
    batch.map((id) =>
      indexFile(id)
        .then((result) => result.status === "indexed")
        .catch(() => false),
    ),
  );
  const indexed = results.filter(Boolean).length;
  const failed = results.length - indexed;

  return c.json({
    indexed,
    failed,
    remaining: Math.max(0, pending.length - batch.length),
  });
});

app.post("/:id/index", async (c) => {
  const id = c.req.param("id");
  const result = await indexFile(id);

  switch (result.status) {
    case "notFound":
      return c.json({ error: "Not Found" }, 404);
    case "expired":
      return c.json({ error: "Gone" }, 410);
    case "objectMissing":
      return c.json({ error: "Object not uploaded" }, 409);
    case "indexed":
      return c.json({ id });
  }
});

export default app;
