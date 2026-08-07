import { Hono } from "hono";
import { css, Style } from "hono/css";
import { listFiles, resolveBaseUrl, type FileEntry } from "../lib/files.js";

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

const bodyClass = css`
  margin: 0;
  padding: 2rem 1.5rem 4rem;
  font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  color: #1f2933;
  background: #f7f8fa;
`;

const containerClass = css`
  max-width: 60rem;
  margin: 0 auto;
`;

const tableClass = css`
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border: 1px solid #e2e6eb;
  border-radius: 8px;
  overflow: hidden;

  th,
  td {
    padding: 0.6rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid #eef1f4;
    font-size: 0.875rem;
    vertical-align: top;
  }

  th {
    background: #f2f4f7;
    font-weight: 600;
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr[data-expired="true"] {
    color: #9aa5b1;
  }
`;

const badgeClass = css`
  display: inline-block;
  padding: 0.1rem 0.4rem;
  margin-left: 0.4rem;
  font-size: 0.75rem;
  border-radius: 4px;
  background: #fde2e2;
  color: #a61b1b;
`;

const formClass = css`
  margin-bottom: 2rem;
  padding: 1.25rem;
  background: #fff;
  border: 1px solid #e2e6eb;
  border-radius: 8px;

  label {
    display: block;
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
  }

  input[type="text"],
  input[type="number"] {
    display: block;
    width: 100%;
    max-width: 24rem;
    margin-top: 0.25rem;
    padding: 0.4rem 0.5rem;
    font: inherit;
    font-weight: 400;
    border: 1px solid #cbd2d9;
    border-radius: 4px;
  }
`;

const dropZoneClass = css`
  margin-bottom: 1rem;
  padding: 1.5rem;
  text-align: center;
  color: #7b8794;
  border: 2px dashed #cbd2d9;
  border-radius: 8px;

  &[data-dragging="true"] {
    border-color: #2f80ed;
    background: #eef5fe;
    color: #2f80ed;
  }
`;

const errorBoxClass = css`
  margin: 0 0 1rem;
  padding: 0.6rem 0.75rem;
  font-size: 0.875rem;
  color: #a61b1b;
  background: #fde2e2;
  border-radius: 4px;

  &[hidden] {
    display: none;
  }
`;

const emptyClass = css`
  padding: 3rem 1rem;
  text-align: center;
  color: #7b8794;
  background: #fff;
  border: 1px solid #e2e6eb;
  border-radius: 8px;
`;

const errorPageClass = css`
  padding: 3rem 1rem;
  text-align: center;
  color: #a61b1b;
`;

function Layout(props: { children: unknown }) {
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Timothy</title>
        <Style />
      </head>
      <body class={bodyClass}>
        <div class={containerClass}>{props.children}</div>
      </body>
    </html>
  );
}

function FileTable(props: { files: FileEntry[]; nowMs: number }) {
  if (props.files.length === 0) {
    return <p class={emptyClass}>まだファイルがありません</p>;
  }

  return (
    <table class={tableClass}>
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
    <form id="upload-form" class={formClass}>
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
        <p class={errorPageClass}>一覧を取得できませんでした。時間をおいて再読み込みしてください。</p>
      </Layout>,
      500
    );
  }

  return c.html(
    <Layout>
      <h1>Timothy</h1>
      <UploadForm />
      <FileTable files={files} nowMs={Date.now()} />
    </Layout>
  );
});

export default app;
