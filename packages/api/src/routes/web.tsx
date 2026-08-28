import { Hono } from "hono";
import { Style } from "hono/css";
import { raw } from "hono/html";
import {
  HTML_FILES_COLLECTION,
  listFiles,
  resolveBaseUrl,
  type FileEntry,
} from "../lib/files.js";
import { CLIENT_SCRIPT, SETTINGS_SCRIPT } from "./webScript.js";
import { db } from "../lib/firebase.js";
import {
  CACHE_CONTROL_VALUES,
  DEFAULT_SANDBOX_TOKENS,
  REFERRER_POLICY_VALUES,
  SANDBOX_TOKEN_RISK,
  SOURCE_KEYS,
  availableSandboxTokens,
  buildCsp,
  type ResponseHeaderSettings,
  type SandboxToken,
  type SourceKey,
} from "../lib/responseHeaders.js";
import {
  globalStyles,
  containerClass,
  headerClass,
  tableClass,
  tableWrapClass,
  shareCellClass,
  titleCellClass,
  titleTextClass,
  descriptionTextClass,
  dateCellClass,
  formClass,
  dropZoneClass,
  submitButtonClass,
  errorBoxClass,
  emptyClass,
  errorPageClass,
  ghostButtonClass,
  dangerButtonClass,
  rowErrorClass,
  previewClass,
  previewLabelClass,
  fieldNoteClass,
  tokenListClass,
  riskBadgeClass,
  formActionsClass,
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

/** null は無期限。Date.parse の NaN 比較に頼らず、明示的に期限なしと判定する。 */
export function isExpired(iso: string | null, nowMs: number): boolean {
  if (iso === null) return false;
  return Date.parse(iso) < nowMs;
}

// hono の c.html は doctype を付けないため、明示的に先頭へ出力して
// ブラウザが互換モード (quirks mode) で描画するのを防ぐ。
const DOCTYPE = raw("<!DOCTYPE html>");

function Layout(props: { children: unknown; script?: string }) {
  return (
    <>
      {DOCTYPE}
      <html lang="ja">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Tim</title>
          <Style>{globalStyles}</Style>
        </head>
        <body>
          <div class={containerClass}>{props.children}</div>
          {props.script ? (
            <script dangerouslySetInnerHTML={{ __html: props.script }}></script>
          ) : null}
        </body>
      </html>
    </>
  );
}

function FileTable(props: { files: FileEntry[]; emptyMessage: string }) {
  if (props.files.length === 0) {
    return (
      <div class={emptyClass}>
        <p>{props.emptyMessage}</p>
      </div>
    );
  }

  return (
    <div class={tableWrapClass}>
      <table class={tableClass}>
        <thead>
          <tr>
            <th>タイトル</th>
            <th>共有</th>
            <th>有効期限</th>
            <th>作成日時</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {props.files.map((file) => (
            <tr key={file.id}>
              {/*
                説明はタイトルに従属する情報なので、独立した列を与えず下に積む。
                空のときは要素ごと出さない — 空の span が残ると margin の分だけ
                行の高さが揺れる。
              */}
              <td class={titleCellClass}>
                <span class={titleTextClass}>{file.title}</span>
                {file.description ? (
                  <span class={descriptionTextClass} title={file.description}>
                    {file.description}
                  </span>
                ) : null}
              </td>
              <td>
                <div class={shareCellClass}>
                  <a
                    class={ghostButtonClass}
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    開く
                  </a>
                  <button type="button" class={ghostButtonClass} data-copy-url={file.url}>
                    URL をコピー
                  </button>
                </div>
              </td>
              <td class={dateCellClass}>
                {file.expiresAt === null ? "無期限" : formatJst(file.expiresAt)}
              </td>
              <td class={dateCellClass}>{formatJst(file.createdAt)}</td>
              <td>
                {/*
                  エラー表示もこの flex 行に入れる。外に出すとブロック要素の下に
                  もう一行できてしまい、td の vertical-align: middle と相まって
                  ボタンだけが他の列より上にずれる。
                */}
                <div class={shareCellClass}>
                  <a class={ghostButtonClass} href={`/files/${file.id}/headers/edit`}>
                    ヘッダ設定
                  </a>
                  <button type="button" class={dangerButtonClass} data-delete-id={file.id}>
                    削除
                  </button>
                  <span class={rowErrorClass} data-row-error></span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      {/*
        チェック中は日数入力を disabled にして required を外す（webScript 側）。
        「7 日と入力しつつ無期限」という矛盾した状態を UI で作れなくするため。
      */}
      <label>
        <input id="no-expiry-input" type="checkbox" name="noExpiry" />
        無期限にする
      </label>
      <button id="submit-button" type="submit" class={submitButtonClass}>
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
        <h1 class={headerClass}>Tim</h1>
        <p class={errorPageClass}>一覧を取得できませんでした。時間をおいて再読み込みしてください。</p>
      </Layout>,
      500
    );
  }

  const nowMs = Date.now();
  const live = files.filter((file) => !isExpired(file.expiresAt, nowMs));

  // 取得は出来たが全件期限切れ、という状態を「まだファイルがありません」と
  // 表示するとデータが消えたように読めるため、文言を分ける。
  const emptyMessage =
    files.length === 0 ? "まだファイルがありません" : "有効期限内のファイルがありません";

  return c.html(
    <Layout script={CLIENT_SCRIPT}>
      <h1 class={headerClass}>Tim</h1>
      <UploadForm />
      <FileTable files={live} emptyMessage={emptyMessage} />
    </Layout>
  );
});

/**
 * 各トークンで何ができるようになるかの説明。
 *
 * Partial ではなく全キー必須にしてあるので、SANDBOX_TOKEN_RISK にトークンを
 * 足すと説明が無いままではコンパイルが通らない。危険度のバッジだけあって
 * 中身が分からない選択肢が増えるのを型で防ぐ。
 */
const TOKEN_DESCRIPTION: Record<SandboxToken, string> = {
  "allow-scripts": "レポート内の JavaScript が動きます（グラフ描画など）",
  "allow-popups": "レポートが新しいタブを開けます",
  "allow-downloads": "レポートがファイルのダウンロードを促せます",
  "allow-modals": "レポートが alert() / confirm() を表示できます",
  "allow-pointer-lock": "レポートがマウスカーソルを固定できます",
  "allow-orientation-lock": "レポートが画面の向きを固定できます",
  "allow-presentation": "レポートが外部ディスプレイへの表示を開始できます",
  "allow-top-navigation-by-user-activation": "クリック操作で閲覧者を外部サイトへ移動させられます",
  "allow-forms": "レポートが入力内容を外部サイトへ送信できます",
  "allow-popups-to-escape-sandbox": "レポートが開いたタブがこの制限の外に出ます",
  "allow-top-navigation": "レポートが閲覧者を任意のサイトへ勝手に移動させられます",
  "allow-same-origin":
    "このインスタンスの全ファイルの一覧取得・閲覧・削除がレポートから可能になります",
};

const SOURCE_LABEL: Record<SourceKey, string> = {
  script: "スクリプト (script-src)",
  style: "スタイル (style-src)",
  img: "画像 (img-src)",
  font: "フォント (font-src)",
  connect: "通信先 (connect-src)",
};

function SettingsForm(props: { settings?: ResponseHeaderSettings }) {
  const tokens = props.settings?.sandbox;
  return (
    <form id="settings-form" class={formClass}>
      <p id="form-error" class={errorBoxClass} hidden></p>

      <div class={tokenListClass}>
        {availableSandboxTokens().map((token) => {
          const risk = SANDBOX_TOKEN_RISK[token];
          return (
            <label key={token}>
              <input
                type="checkbox"
                data-token={token}
                data-risk={risk}
                data-description={TOKEN_DESCRIPTION[token]}
                checked={
                  tokens
                    ? tokens.includes(token)
                    : (DEFAULT_SANDBOX_TOKENS as readonly string[]).includes(token)
                }
              />
              <code>{token}</code>
              {risk === "safe" ? null : (
                <em class={riskBadgeClass} data-risk={risk}>
                  {risk === "danger" ? "危険" : "注意"}
                </em>
              )}
              <span>{TOKEN_DESCRIPTION[token]}</span>
            </label>
          );
        })}
      </div>

      {SOURCE_KEYS.map((key) => (
        <label key={key}>
          {SOURCE_LABEL[key]}
          {/* textarea の値は value 属性ではなく子要素。属性で書くと表示されない。 */}
          <textarea data-source={key} rows={3} placeholder="https://cdn.example.com">
            {(props.settings?.allowedSources?.[key] ?? []).join("\n")}
          </textarea>
        </label>
      ))}

      <label>
        Cache-Control
        <select data-field="cacheControl">
          <option value="">設定しない</option>
          {CACHE_CONTROL_VALUES.map((value) => (
            <option key={value} value={value} selected={props.settings?.cacheControl === value}>
              {value}
            </option>
          ))}
        </select>
        <span class={fieldNoteClass}>
          有効期限までの max-age は自動で付きます。public は CDN やプロキシなど共有キャッシュにも
          保存されるため、期限が切れてもキャッシュ上のコピーは消せません。
        </span>
      </label>

      <label>
        Referrer-Policy
        <select data-field="referrerPolicy">
          <option value="">設定しない</option>
          {REFERRER_POLICY_VALUES.map((value) => (
            <option key={value} value={value} selected={props.settings?.referrerPolicy === value}>
              {value}
            </option>
          ))}
        </select>
        <span class={fieldNoteClass}>
          レポート内のリンクを開いたとき、リンク先に送られる参照元 URL を制限します。
        </span>
      </label>

      <div class={formActionsClass}>
        <button id="save-button" type="submit" class={submitButtonClass}>
          保存
        </button>
        <button id="reset-button" type="button" class={ghostButtonClass}>
          既定に戻す
        </button>
      </div>
    </form>
  );
}

app.get("/files/:id/headers/edit", async (c) => {
  const id = c.req.param("id");

  const doc = await db.collection(HTML_FILES_COLLECTION).doc(id).get();
  if (!doc.exists) {
    return c.html(
      <Layout>
        <h1 class={headerClass}>Tim</h1>
        <p class={errorPageClass}>指定されたファイルが見つかりません。</p>
      </Layout>,
      404
    );
  }

  const data = doc.data()!;
  const settings: ResponseHeaderSettings | undefined = data.responseHeaders;

  return c.html(
    <Layout script={SETTINGS_SCRIPT}>
      <h1 class={headerClass}>ヘッダ設定 — {data.title}</h1>
      <p>
        <a href="/">← 一覧に戻る</a>
      </p>
      {/*
        説明文ではなく現物を出す。ただしこれは保存済みの内容であって、
        下のフォームの編集中の状態ではない。取り違えると
        「反映されていない」と誤解されるので、見出しで明示する。
      */}
      <p class={previewLabelClass}>現在このファイルに適用されているポリシー（保存後に更新されます）</p>
      <p class={previewClass}>{buildCsp(settings)}</p>
      <SettingsForm settings={settings} />
    </Layout>
  );
});

export default app;
