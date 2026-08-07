import { Hono } from "hono";
import { Style, cx } from "hono/css";
import { raw } from "hono/html";
import { listFiles, resolveBaseUrl, type FileEntry } from "../lib/files.js";
import { CLIENT_SCRIPT } from "./webScript.js";
import {
  globalStyles,
  containerClass,
  headerClass,
  statusClass,
  stepRuleClass,
  panelClass,
  railClass,
  tableClass,
  badgeClass,
  formClass,
  dropZoneClass,
  errorBoxClass,
  emptyClass,
  errorPageClass,
} from "./webStyles.js";

const JST_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatJst(iso: string): string {
  return JST_FORMATTER.format(new Date(iso));
}

export function isExpired(iso: string, nowMs: number): boolean {
  return Date.parse(iso) < nowMs;
}

// hono の c.html は doctype を付けないため、明示的に先頭へ出力して
// ブラウザが互換モード (quirks mode) で描画するのを防ぐ。
const DOCTYPE = raw("<!DOCTYPE html>");

// 画面端に流す装飾用の文字列。意味は無い。
const RAIL_TEXT = "01001100 0110 10 001101 0111 1001 0010 1101 0011 ".repeat(24);

function DataRails() {
  return (
    <>
      <div class={railClass} data-side="left" aria-hidden="true">
        {RAIL_TEXT}
      </div>
      <div class={railClass} data-side="right" aria-hidden="true">
        {RAIL_TEXT}
      </div>
    </>
  );
}

function Header(props: { fileCount?: number }) {
  return (
    <>
      <h1 class={headerClass}>
        Timothy
        {props.fileCount === undefined ? null : (
          <span class={statusClass}>
            FILES: {String(props.fileCount).padStart(2, "0")}
          </span>
        )}
      </h1>
      <div class={stepRuleClass} aria-hidden="true"></div>
    </>
  );
}

function Layout(props: { children: unknown; withScript?: boolean }) {
  return (
    <>
      {DOCTYPE}
      <html lang="ja">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Timothy</title>
          <Style>{globalStyles}</Style>
        </head>
        <body>
          <DataRails />
          <div class={containerClass}>{props.children}</div>
          {props.withScript ? (
            <script dangerouslySetInnerHTML={{ __html: CLIENT_SCRIPT }}></script>
          ) : null}
        </body>
      </html>
    </>
  );
}

function FileTable(props: { files: FileEntry[]; nowMs: number }) {
  if (props.files.length === 0) {
    return <p class={cx(emptyClass, panelClass)}>まだファイルがありません</p>;
  }

  return (
    <table class={cx(tableClass, panelClass)}>
      <thead>
        <tr>
          <th>タイトル</th>
          <th>説明</th>
          <th>共有 URL</th>
          <th>有効期限</th>
          <th>作成日時</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {props.files.map((file) => {
          const expired = isExpired(file.expiresAt, props.nowMs);
          return (
            <tr key={file.id} data-expired={String(expired)}>
              <td>{file.title}</td>
              <td>{file.description}</td>
              <td>
                <a href={file.url} target="_blank" rel="noreferrer">
                  {file.url}
                </a>
                <button type="button" data-copy-url={file.url}>
                  コピー
                </button>
              </td>
              <td>
                {formatJst(file.expiresAt)}
                {expired ? <span class={badgeClass}>期限切れ</span> : null}
              </td>
              <td>{formatJst(file.createdAt)}</td>
              <td>
                <button type="button" data-delete-id={file.id}>
                  削除
                </button>
                <span data-row-error></span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function UploadForm() {
  return (
    <form id="upload-form" class={cx(formClass, panelClass)}>
      <p id="form-error" class={errorBoxClass} hidden></p>
      <div id="drop-zone" class={dropZoneClass} data-dragging="false">
        ここに HTML ファイルをドラッグ&amp;ドロップ
      </div>
      <label>
        ファイル
        <input id="file-input" type="file" name="file" accept=".html,.htm" required />
      </label>
      <label>
        タイトル
        <input id="title-input" type="text" name="title" required />
      </label>
      <label>
        説明（任意）
        <input id="description-input" type="text" name="description" />
      </label>
      <label>
        有効期間（日）
        <input id="ttl-input" type="number" name="ttlDays" value="7" min="1" step="1" required />
      </label>
      <button id="submit-button" type="submit">
        アップロード
      </button>
    </form>
  );
}

const app = new Hono();

app.get("/", async (c) => {
  let files: FileEntry[];
  try {
    files = await listFiles(resolveBaseUrl(c));
  } catch {
    return c.html(
      <Layout>
        <Header />
        <p class={errorPageClass}>一覧を取得できませんでした。時間をおいて再読み込みしてください。</p>
      </Layout>,
      500
    );
  }

  return c.html(
    <Layout withScript>
      <Header fileCount={files.length} />
      <UploadForm />
      <FileTable files={files} nowMs={Date.now()} />
    </Layout>
  );
});

export default app;
