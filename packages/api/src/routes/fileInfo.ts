import { Hono } from "hono";
import { db } from "../lib/firebase.js";
import { HTML_FILES_COLLECTION, resolveBaseUrl } from "../lib/files.js";
import { getFileContent } from "../lib/storage.js";
import { getVersion, latestVersionOf, listVersions, parseVersionParam } from "../lib/versions.js";

const app = new Hono();

// ファイルの親ドキュメントを読み、無い・期限切れならその応答を返す。
// 期限切れの判定は版の検証より先に行う（serve.ts と同じ）。
async function loadLive(id: string) {
  const doc = await db.collection(HTML_FILES_COLLECTION).doc(id).get();
  if (!doc.exists) return { status: 404 as const, error: "Not Found" };
  const data = doc.data()!;
  // expiresAt が null なら無期限。
  const expiresAt: Date | null = data.expiresAt ? data.expiresAt.toDate() : null;
  if (expiresAt !== null && expiresAt < new Date()) return { status: 410 as const, error: "Gone" };
  return { data, expiresAt };
}

// ファイルの情報と全版の一覧。
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const loaded = await loadLive(id);
  if ("error" in loaded) return c.json({ error: loaded.error }, loaded.status);
  const { data, expiresAt } = loaded;

  const versions = await listVersions(id, data);
  return c.json({
    id,
    title: data.title,
    description: data.description,
    url: `${resolveBaseUrl(c)}/s/${id}`,
    owner: data.ownerEmail
      ? { email: data.ownerEmail as string, name: (data.ownerName as string) ?? "" }
      : null,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    latestVersion: latestVersionOf(data),
    versions: versions.map((v) => ({
      version: v.number,
      createdAt: v.createdAt.toISOString(),
      uploadedBy: v.uploader,
    })),
  });
});

// 保存された HTML をそのまま JSON で返す。ブリッジは差し込まない。
app.get("/:id/content", async (c) => {
  const id = c.req.param("id");
  const loaded = await loadLive(id);
  if ("error" in loaded) return c.json({ error: loaded.error }, loaded.status);
  const { data } = loaded;

  const n = parseVersionParam(c.req.query("v"), latestVersionOf(data));
  if (n === null) return c.json({ error: "Not Found" }, 404);
  const version = await getVersion(id, data, n);
  if (!version) return c.json({ error: "Not Found" }, 404);

  const html = await getFileContent(version.storagePath);
  c.header("Cache-Control", "no-store");
  return c.json({ id, version: n, html });
});

export default app;
