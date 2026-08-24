import { Hono } from "hono";
import { db } from "../lib/firebase.js";
import { getFileContent } from "../lib/storage.js";

const HTML_FILES_COLLECTION = "htmlFiles";

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
//
// sandbox が止めるのは管理 API へのアクセスだけで、外向きの通信は素通しになる。
// 以下は送信を塞ぐためのもの。レスポンスを読めなくても送信自体は成立するため
// connect-src が最も効く。
// 'unsafe-inline' は妥協ではなく必須 — LLM 生成 HTML は <script> / <style> の
// 直書きが前提で、絞るとレポートが軒並み壊れる。
// img-src の blob: は canvas.toBlob() が返す画像用。生成元のドキュメント内で
// 完結するため送信経路にはならない。
// 'self' は使わない — 不透明オリジンでは何にもマッチしない。
// frame-src / media-src / object-src は明示せず default-src 'none' に落としている。
// window.open() は CSP では塞げない（navigate-to は仕様から削除済み）ため、
// allow-popups がある限り送信経路として残る。
const SHARE_CSP = [
  "sandbox allow-scripts allow-popups allow-downloads allow-modals",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

const app = new Hono();

app.get("/:id", async (c) => {
  const id = c.req.param("id");

  const doc = await db.collection(HTML_FILES_COLLECTION).doc(id).get();
  if (!doc.exists) return c.json({ error: "Not Found" }, 404);

  const data = doc.data()!;
  const expiresAt: Date = data.expiresAt.toDate();
  if (expiresAt < new Date()) return c.json({ error: "Gone" }, 410);

  const html = await getFileContent(data.storagePath);
  c.header("Content-Security-Policy", SHARE_CSP);
  return c.html(html);
});

export default app;
