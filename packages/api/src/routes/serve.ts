import { Hono } from "hono";
import { db } from "../lib/firebase.js";
import { getFileContent } from "../lib/storage.js";

const HTML_FILES_COLLECTION = "htmlFiles";

const app = new Hono();

app.get("/:id", async (c) => {
  const id = c.req.param("id");

  const doc = await db.collection(HTML_FILES_COLLECTION).doc(id).get();
  if (!doc.exists) return c.json({ error: "Not Found" }, 404);

  const data = doc.data()!;
  const expiresAt: Date = data.expiresAt.toDate();
  if (expiresAt < new Date()) return c.json({ error: "Gone" }, 410);

  const html = await getFileContent(data.storagePath);
  // アップロードされた HTML は管理画面と同一オリジンで配信されるため、
  // sandbox で不透明オリジンに隔離し /files や /upload への同一オリジン
  // リクエストを遮断する。各トークンの意図:
  //   allow-scripts   … グラフ描画など、レポート内の JS を動かすため
  //   allow-popups    … 出典リンクを別タブで開くレポートのため
  //   allow-downloads … CSV などのダウンロードリンクを提供するレポートのため
  //   allow-modals    … alert() / confirm() を呼ぶレポートのため
  // allow-forms は意図的に付与しない（外部への値送信を許さない）。
  // allow-same-origin は絶対に追加しないこと。これを付けると不透明オリジンが
  // 解除され、レポート内のスクリプトが IP 許可リストの内側から /files や
  // /upload を同一オリジンで叩けてしまい、sandbox の意味がなくなる。
  c.header(
    "Content-Security-Policy",
    "sandbox allow-scripts allow-popups allow-downloads allow-modals",
  );
  return c.html(html);
});

export default app;
