import { Hono } from "hono";
import { db } from "../lib/firebase.js";
import { effectiveSandboxTokens } from "../lib/responseHeaders.js";
import { latestVersionOf, listVersions, parseVersionParam } from "../lib/versions.js";
import { Layout, formatJst } from "./web.js";
import { VIEWER_SCRIPT } from "./viewerScript.js";
import {
  commentPanelClass,
  pickToggleClass,
  viewerBodyClass,
  viewerClass,
  viewerFrameClass,
  viewerHeaderClass,
  viewerNoticeClass,
  viewerToastClass,
} from "./webStyles.js";

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

  // 期限切れの判定が先。版の検証はその後。
  const latest = latestVersionOf(data);
  const shown = parseVersionParam(c.req.query("v"), latest);
  if (shown === null) return c.json({ error: "Not Found" }, 404);

  const versions = await listVersions(id, data);
  const title: string = data.title ?? id;
  // 本体の CSP sandbox と同じトークンを属性にも付ける（二重の防御）。同じ集合なので打ち消し合わない。
  const sandboxTokens = effectiveSandboxTokens(data.responseHeaders);
  const sandbox = sandboxTokens.join(" ");
  // スクリプトが動かないと本体の中のブリッジも動かず、本文を選んでコメントできない。
  const scriptsAllowed = sandboxTokens.includes("allow-scripts");

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
          <button
            id="pick-toggle"
            type="button"
            class={pickToggleClass}
            title="⌥+C / Alt+C"
            aria-pressed="false"
            disabled={!scriptsAllowed}
          >
            ◎ 要素を選んでコメント
          </button>
        </header>
        <div class={viewerBodyClass}>
          <iframe
            id="viewer-frame"
            class={viewerFrameClass}
            src={`/s/${id}/v/${shown}`}
            title={title}
            sandbox={sandbox}
          ></iframe>
          <aside
            id="comment-panel"
            class={commentPanelClass}
            data-file-id={id}
            data-shown-version={String(shown)}
            data-latest-version={String(latest)}
            data-scripts-allowed={scriptsAllowed ? "true" : "false"}
          >
            <div id="composer" class="composer" hidden>
              <div id="composer-anchor" class="anchor"></div>
              <textarea id="composer-text" placeholder="コメントを書く…" aria-label="コメント"></textarea>
              <div id="composer-error" class="error" hidden></div>
              <div class="row">
                <button id="composer-submit" type="button" class="primary">
                  コメント
                </button>
                <button id="composer-cancel" type="button">
                  キャンセル
                </button>
              </div>
              <div class="hint">⌘+Enter / Ctrl+Enter で送信</div>
            </div>
            {scriptsAllowed ? (
              <p id="idle-hint" class="hint">
                文字を選択するか、「要素を選んでコメント」で図などを選ぶと、その箇所にコメントできます
              </p>
            ) : (
              <p class="hint">この HTML はスクリプトを許可していないため、本文を選んでコメントすることはできません</p>
            )}
            <div class="row spread">
              <span id="comment-count" class="hint"></span>
              <label>
                <input id="show-resolved" type="checkbox" /> 解決済みも表示
              </label>
            </div>
            <div id="comment-list" class="threads"></div>
          </aside>
        </div>
        <div id="toast" class={viewerToastClass} role="status" hidden></div>
      </div>
    </Layout>,
  );
});

export default app;
