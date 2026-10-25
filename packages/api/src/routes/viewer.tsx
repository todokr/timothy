import { Hono } from "hono";
import { db } from "../lib/firebase.js";
import { effectiveSandboxTokens } from "../lib/responseHeaders.js";
import { latestVersionOf, listVersions, parseVersionParam } from "../lib/versions.js";
import { Layout, formatJst } from "./web.js";
import {
  viewerClass,
  viewerFrameClass,
  viewerHeaderClass,
  viewerNoticeClass,
} from "./webStyles.js";

const HTML_FILES_COLLECTION = "htmlFiles";

// 版を選んだら ?v=<N> へ移る。最新版を選んだときも ?v=<latest> にする。
const VIEWER_SCRIPT = `
document.getElementById("version-select").addEventListener("change", function (e) {
  location.href = "?v=" + encodeURIComponent(e.target.value);
});
`;

const app = new Hono();

app.get("/:id", async (c) => {
  const id = c.req.param("id");

  const doc = await db.collection(HTML_FILES_COLLECTION).doc(id).get();
  if (!doc.exists) return c.json({ error: "Not Found" }, 404);

  const data = doc.data()!;
  // expiresAt が null なら無期限。期限判定そのものを行わない。
  const expiresAt: Date | null = data.expiresAt ? data.expiresAt.toDate() : null;
  if (expiresAt !== null && expiresAt < new Date()) return c.json({ error: "Gone" }, 410);

  // 期限切れの判定が先。版の検証はその後。
  const latest = latestVersionOf(data);
  const shown = parseVersionParam(c.req.query("v"), latest);
  if (shown === null) return c.json({ error: "Not Found" }, 404);

  const versions = await listVersions(id, data);
  const title: string = data.title ?? id;
  // 本体の CSP sandbox と同じトークンを属性にも付ける（二重の防御）。同じ集合なので打ち消し合わない。
  const sandbox = effectiveSandboxTokens(data.responseHeaders).join(" ");

  // 確認画面と同じく、別サイトの iframe に入れられないようにする。
  c.header("X-Frame-Options", "DENY");
  // frame-src 'self' は、本体の JS が iframe を外部サイトへ遷移させ、
  // timothy の画面の中に偽のページを出すのを防ぐ。
  c.header("Content-Security-Policy", "frame-ancestors 'none'; frame-src 'self'");
  c.header("Cache-Control", "no-store");

  return c.html(
    <Layout script={VIEWER_SCRIPT} title={title}>
      <div class={viewerClass}>
        <header data-viewer-header class={viewerHeaderClass}>
          <h1>{title}</h1>
          <span>
            v{shown} / 全 {latest} 版
          </span>
          <select id="version-select" aria-label="版">
            {versions.map((v) => (
              <option value={String(v.number)} selected={v.number === shown}>
                {`v${v.number}（${formatJst(v.createdAt.toISOString())}）`}
              </option>
            ))}
          </select>
          {shown !== latest ? (
            <span class={viewerNoticeClass}>
              最新版ではありません <a href={`/s/${id}?v=${latest}`}>最新版（v{latest}）を開く</a>
            </span>
          ) : null}
        </header>
        <iframe
          id="viewer-frame"
          class={viewerFrameClass}
          src={`/s/${id}/v/${shown}`}
          title={title}
          sandbox={sandbox}
        ></iframe>
      </div>
    </Layout>,
  );
});

export default app;
