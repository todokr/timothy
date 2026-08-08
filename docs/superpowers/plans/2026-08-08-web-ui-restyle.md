# Web UI ビジュアルリニューアル（サイバーパンク調 → 静かな無彩色）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理画面（`GET /`）を、ほぼ黒の背景に赤・黄・シアンを載せた HUD 表現から、静かな無彩色 + アクセント 1 色のライトテーマに作り替える。

**Architecture:** まず HUD 固有の装飾マークアップを取り除いて構造を素にし、そのうえで `webStyles.ts` の `globalStyles` にある `:root` トークンをライトの無彩色に差し替え、各クラスの参照先を更新する。最後にテーブルの共有列を「開く」「URL をコピー」の 2 ボタンに置き換える。

**Tech Stack:** Hono 4 / hono/jsx / hono/css / TypeScript 6 (NodeNext) / vitest 4

## Global Constraints

- 設計書: `docs/superpowers/specs/2026-08-08-web-ui-restyle-design.md`。矛盾があれば設計書が優先。
- 作業ブランチは `feature/web-ui`。すでにチェックアウト済み。
- TypeScript は `strict: true`、モジュールは `NodeNext`。**相対 import は必ず `.js` 拡張子を付ける**（`.tsx` を import する場合も `.js`）。
- テストファイル名は必ず `*.test.ts`。vitest の `include` が `src/**/*.test.ts` のため `.test.tsx` は実行されない。テストコード内で JSX は書かない。
- **DOM の要素 ID と `data-*` 属性を変更してはならない。** `#upload-form` `#drop-zone` `#file-input` `#title-input` `#description-input` `#ttl-input` `#submit-button` `#form-error`、および `data-delete-id` `data-copy-url` `data-row-error` `data-dragging` `data-expired` は `webScript.ts` のクライアント JS が参照している。
- **`packages/api/src/routes/webScript.ts` は変更しない。**
- UI の文言はすべて日本語。「開く」「URL をコピー」「削除」「期限切れ」「まだファイルがありません」など、設計書に書かれた文言をそのまま使う。
- ライトテーマのみ。`prefers-color-scheme` は使わない。
- 外部フォント・外部アセットは読み込まない。
- コマンドはリポジトリルートから実行する。ビルド `pnpm --filter @timothy/api run build`、テスト `pnpm --filter @timothy/api run test`、lint `pnpm lint`。3 つとも成功する状態を保つこと。
- **`.secretlintrc` などのセキュリティ設定ファイルを作成・変更してはならない。** コミットがフックに阻まれた場合は、設定を弱めるのではなく停止して報告すること。
- 着手前の全テスト件数は **96 件**（7 ファイル）。うち `packages/api/src/routes/web.test.ts` が 26 件。

### デザイントークン（実装時はこの表を正とする）

| 変数 | 値 |
|---|---|
| `--gray-0` | `#ffffff` |
| `--gray-25` | `#fcfcfd` |
| `--gray-50` | `#f8f9fa` |
| `--gray-100` | `#f1f3f5` |
| `--gray-200` | `#e9ecef` |
| `--gray-300` | `#dee2e6` |
| `--gray-400` | `#adb5bd` |
| `--gray-500` | `#868e96` |
| `--gray-700` | `#495057` |
| `--gray-900` | `#212529` |
| `--accent` | `#2563eb` |
| `--accent-hover` | `#1d4ed8` |
| `--accent-soft` | `#eff4ff` |
| `--danger` | `#e03131` |
| `--danger-soft` | `#fff5f5` |
| `--radius-sm` | `6px` |
| `--radius-md` | `10px` |
| `--shadow-sm` | `0 1px 2px rgba(16, 24, 40, 0.05)` |
| `--space-1` 〜 `--space-6` | `4px` `8px` `12px` `16px` `24px` `32px` |
| `--font-sans` | `system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif` |

---

### Task 1: HUD 固有の装飾を取り除く

配色はまだ変えない。装飾マークアップとそれ専用のスタイル定数だけを削除して、構造を素にする。こうすると次のタスクの差分が配色の変更だけになり、レビューしやすくなる。

この時点の画面は「装飾のない暗いテーマ」という中途半端な見た目になるが、壊れてはいない状態を保つ。

**Files:**
- Modify: `packages/api/src/routes/web.tsx`
- Modify: `packages/api/src/routes/webStyles.ts`
- Modify: `packages/api/src/routes/web.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `webStyles.ts` から次の 7 つのエクスポートが消えた状態 — `railClass`, `panelClass`, `stepRuleClass`, `statusClass`, `rowNumberClass`, `emptyTitleClass`, `urlClass`（7 つ）。残るエクスポートは `globalStyles`, `containerClass`, `headerClass`, `tableClass`, `badgeClass`, `formClass`, `dropZoneClass`, `submitButtonClass`, `errorBoxClass`, `emptyClass`, `errorPageClass`, `ghostButtonClass`, `dangerButtonClass`, `rowErrorClass` の 14 個。

- [ ] **Step 1: 削除する要素を検証しているテストを消す**

`packages/api/src/routes/web.test.ts` から次の 2 件のテストを**丸ごと削除**する（171〜191 行目付近）:

- `it("hides the decorative rails from assistive technology", ...)` — 装飾レールを消すため
- `it("numbers the rows", ...)` — 行番号列を消すため

`it("declares a dark color scheme", ...)` は**残す**。ライトへの差し替えは Task 2 で行う。

- [ ] **Step 2: テストを実行して 94 件になることを確認する**

Run: `pnpm --filter @timothy/api run test`

Expected: PASS、96 件から 94 件に減る。まだ実装を変えていないので失敗は出ない。

- [ ] **Step 3: `web.tsx` から装飾マークアップを削除する**

`packages/api/src/routes/web.tsx` に次の変更を加える。

(a) import から `cx` を外す。`panelClass` の合成が無くなるため:

```tsx
import { Style } from "hono/css";
```

(b) `webStyles.js` からの import を次の 14 個に減らす:

```tsx
import {
  globalStyles,
  containerClass,
  headerClass,
  tableClass,
  badgeClass,
  formClass,
  dropZoneClass,
  submitButtonClass,
  errorBoxClass,
  emptyClass,
  errorPageClass,
  ghostButtonClass,
  dangerButtonClass,
  rowErrorClass,
} from "./webStyles.js";
```

(c) `RAIL_TEXT` 定数と `DataRails` コンポーネントを削除する（52〜65 行目付近）。

(d) `Header` コンポーネントを削除し（67〜81 行目付近）、呼び出し 2 箇所を `<h1 class={headerClass}>Timothy</h1>` に置き換える。

(e) `Layout` の `<body>` から `<DataRails />` を削除する。

(f) `FileTable` の空状態から英字見出しを外し、`cx` をやめる:

```tsx
  if (props.files.length === 0) {
    return (
      <div class={emptyClass}>
        <p>まだファイルがありません</p>
      </div>
    );
  }
```

(g) `FileTable` のテーブルから行番号列を外し、`cx` をやめる。`<thead>` の先頭の空 `<th></th>` を削除し、`map` の `index` 引数と `rowNumberClass` の `<td>` を削除する。共有 URL のセルからは `urlClass` を外す（中身は Task 4 で置き換えるのでここでは触らない）:

```tsx
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
                <button type="button" class={ghostButtonClass} data-copy-url={file.url}>
                  コピー
                </button>
              </td>
              <td>
                {formatJst(file.expiresAt)}
                {expired ? <span class={badgeClass}>期限切れ</span> : null}
              </td>
              <td>{formatJst(file.createdAt)}</td>
              <td>
                <button type="button" class={dangerButtonClass} data-delete-id={file.id}>
                  削除
                </button>
                <span class={rowErrorClass} data-row-error></span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
```

(h) `UploadForm` の `<form>` から `cx` をやめる:

```tsx
    <form id="upload-form" class={formClass}>
```

- [ ] **Step 4: `webStyles.ts` から不要になった定数を削除する**

`packages/api/src/routes/webStyles.ts` から次の 7 つの `export const` を削除する。他の定数には触らない。

`stepRuleClass`, `panelClass`, `railClass`, `statusClass`, `rowNumberClass`, `urlClass`, `emptyTitleClass`

- [ ] **Step 5: ビルド・テスト・lint を確認する**

Run: `pnpm --filter @timothy/api run build && pnpm --filter @timothy/api run test && pnpm lint`

Expected: すべて成功（94 件）。未使用 import が残っていると lint か tsc が落ちるので、その場合は取りこぼしを探すこと。

- [ ] **Step 6: 削除の取りこぼしが無いか確認する**

Run:

```bash
grep -nE "railClass|panelClass|stepRuleClass|statusClass|rowNumberClass|emptyTitleClass|urlClass|RAIL_TEXT|DataRails|fileCount|\bcx\b" packages/api/src/routes/web.tsx packages/api/src/routes/webStyles.ts
```

Expected: 1 件も出ない。出た場合は消し忘れ。

- [ ] **Step 7: コミット**

```bash
git add packages/api/src/routes/web.tsx packages/api/src/routes/webStyles.ts packages/api/src/routes/web.test.ts
git commit -m "refactor(api): drop HUD decorations from the web UI"
```

---

### Task 2: トークンをライトに差し替え、ページとカードを整える

`globalStyles` の `:root` を無彩色のトークンに入れ替え、ページ全体・見出し・カードの外枠・空状態・500 ページを整える。フォームの中身とテーブルの中身は Task 3・4 で扱う。

**Files:**
- Modify: `packages/api/src/routes/webStyles.ts`
- Modify: `packages/api/src/routes/web.test.ts`

**Interfaces:**
- Consumes: Task 1 の 14 個のクラス定数
- Produces: `globalStyles` の `:root` に全デザイントークンが定義された状態。Task 3・4 のスタイルはこれを `var(--...)` で参照する。

- [ ] **Step 1: 既存テストを書き換え、新しいテストを足す**

`packages/api/src/routes/web.test.ts` の `it("declares a dark color scheme", ...)` を次に**置き換える**:

```ts
  it("declares a light color scheme", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toMatch(/color-scheme:\s*light/);
    expect(html).not.toMatch(/color-scheme:\s*dark/);
  });
```

続けて `describe("GET /", ...)` の中に 1 件追加する:

```ts
  // webStyles.ts の import が外れたり <Style> が空になったりすると、
  // 画面は無スタイルになるが他のテストは通ってしまうため、ここで検出する。
  it("emits the stylesheet with the accent token", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toContain('<style id="hono-css">');
    expect(html).toContain("#2563eb");
  });
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `pnpm --filter @timothy/api run test src/routes/web.test.ts`

Expected: FAIL 2 件。`color-scheme: dark` のままであること、`#2563eb` がまだ無いこと。

- [ ] **Step 3: `globalStyles` を差し替える**

Replace `globalStyles` in `packages/api/src/routes/webStyles.ts`:

```ts
export const globalStyles = css`
  :root {
    color-scheme: light;

    --gray-0: #ffffff;
    --gray-25: #fcfcfd;
    --gray-50: #f8f9fa;
    --gray-100: #f1f3f5;
    --gray-200: #e9ecef;
    --gray-300: #dee2e6;
    --gray-400: #adb5bd;
    --gray-500: #868e96;
    --gray-700: #495057;
    --gray-900: #212529;

    --accent: #2563eb;
    --accent-hover: #1d4ed8;
    --accent-soft: #eff4ff;

    --danger: #e03131;
    --danger-soft: #fff5f5;

    --radius-sm: 6px;
    --radius-md: 10px;
    --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.05);

    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 24px;
    --space-6: 32px;

    --font-sans: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  }

  html,
  body {
    margin: 0;
    background: var(--gray-50);
    color: var(--gray-900);
  }

  body {
    padding: var(--space-6) var(--space-4);
    font-family: var(--font-sans);
    font-size: 0.9375rem;
    line-height: 1.6;
  }

  a {
    color: var(--accent);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none !important;
      animation: none !important;
    }
  }
`;
```

- [ ] **Step 4: 見出しとカードを整える**

Replace `headerClass`, `formClass`（外枠のみ。中身は Task 3）, `emptyClass`, `errorPageClass` in `packages/api/src/routes/webStyles.ts`:

```ts
export const headerClass = css`
  margin: 0 0 var(--space-5);
  font-size: 1.5rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--gray-900);
`;

export const formClass = css`
  margin-bottom: var(--space-5);
  padding: var(--space-5);
  background: var(--gray-0);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
`;

export const emptyClass = css`
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--gray-500);
  background: var(--gray-0);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);

  p {
    margin: 0;
  }
`;

export const errorPageClass = css`
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--danger);
  background: var(--gray-0);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
`;
```

`containerClass` は `max-width: 60rem; margin: 0 auto;` のままでよい。変更しない。

- [ ] **Step 5: テストを実行して成功することを確認する**

Run: `pnpm --filter @timothy/api run test src/routes/web.test.ts`

Expected: PASS（25 件）

- [ ] **Step 6: 旧トークンの参照が残っていないか確認する**

Run:

```bash
grep -nE "var\(--(bg|panel|panel-edge|line|line-strong|cyan|yellow|text|text-dim|gap|gap-lg|font-mono|font-ui)\)" packages/api/src/routes/webStyles.ts
```

この時点では Task 3・4 で扱うクラス（`tableClass` など）にまだ旧トークンが残っている。**出力があってよい**。ただし `globalStyles` `headerClass` `formClass` `emptyClass` `errorPageClass` の 5 つに残っていたら消し忘れなので直すこと。

- [ ] **Step 7: ビルド・全テスト・lint を確認する**

Run: `pnpm --filter @timothy/api run build && pnpm --filter @timothy/api run test && pnpm lint`

Expected: すべて成功（95 件）

- [ ] **Step 8: コミット**

```bash
git add packages/api/src/routes/webStyles.ts packages/api/src/routes/web.test.ts
git commit -m "feat(api): swap web UI tokens to a light neutral palette"
```

---

### Task 3: フォームとボタンを整える

入力欄・ラベル・ドロップゾーン・エラー表示と、ボタン 3 種を無彩色に整える。等幅フォント・字間拡張・大文字化・`clip-path` の角落としをすべて外す。

**Files:**
- Modify: `packages/api/src/routes/webStyles.ts`

**Interfaces:**
- Consumes: Task 2 のデザイントークン
- Produces: なし（既存のエクスポート名 `formClass` `dropZoneClass` `errorBoxClass` `submitButtonClass` `ghostButtonClass` `dangerButtonClass` の中身が変わるのみ）

- [ ] **Step 1: フォームの中身を整える**

Replace `formClass` in `packages/api/src/routes/webStyles.ts`（Task 2 の外枠に中身を足す）:

```ts
export const formClass = css`
  margin-bottom: var(--space-5);
  padding: var(--space-5);
  background: var(--gray-0);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);

  label {
    display: block;
    margin-bottom: var(--space-4);
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--gray-700);
  }

  input[type="text"],
  input[type="number"] {
    display: block;
    width: 100%;
    max-width: 24rem;
    height: 2.25rem;
    margin-top: var(--space-1);
    padding: 0 var(--space-3);
    font: inherit;
    font-weight: 400;
    color: var(--gray-900);
    background: var(--gray-0);
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    transition: border-color 120ms linear, box-shadow 120ms linear;
  }

  input[type="number"] {
    max-width: 8rem;
  }

  input[type="text"]::placeholder {
    color: var(--gray-400);
  }

  input[type="text"]:focus,
  input[type="number"]:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  input[type="file"] {
    display: block;
    margin-top: var(--space-1);
    font: inherit;
    font-size: 0.875rem;
    color: var(--gray-700);
  }

  input[type="file"]::file-selector-button {
    margin-right: var(--space-3);
    padding: 0 var(--space-3);
    height: 1.75rem;
    font: inherit;
    font-size: 0.8125rem;
    color: var(--gray-700);
    background: transparent;
    border: 1px solid var(--gray-200);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
`;
```

- [ ] **Step 2: ドロップゾーンと `#form-error` を整える**

Replace `dropZoneClass` and `errorBoxClass` in `packages/api/src/routes/webStyles.ts`:

```ts
export const dropZoneClass = css`
  margin-bottom: var(--space-4);
  padding: var(--space-6) var(--space-4);
  font-size: 0.875rem;
  text-align: center;
  color: var(--gray-500);
  border: 2px dashed var(--gray-300);
  border-radius: var(--radius-md);
  transition:
    color 120ms linear,
    border-color 120ms linear,
    background-color 120ms linear;

  &[data-dragging="true"] {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: var(--accent);
  }
`;

export const errorBoxClass = css`
  margin: 0 0 var(--space-4);
  padding: var(--space-3) var(--space-4);
  font-size: 0.875rem;
  color: var(--danger);
  background: var(--danger-soft);
  border-left: 3px solid var(--danger);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;

  &[hidden] {
    display: none;
  }
`;
```

`&[hidden] { display: none; }` は必ず残すこと。これを消すとエラー欄が常時表示される。

- [ ] **Step 3: ボタン 3 種を整える**

Replace `submitButtonClass`, `ghostButtonClass`, `dangerButtonClass` in `packages/api/src/routes/webStyles.ts`。`ghostButtonClass` の `margin-left` は共有列の `gap` で作るので削除する:

```ts
export const submitButtonClass = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2.25rem;
  padding: 0 var(--space-4);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  color: #fff;
  background: var(--accent);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 120ms linear;

  &:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const ghostButtonClass = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.75rem;
  padding: 0 var(--space-3);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  text-decoration: none;
  color: var(--gray-700);
  background: transparent;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 120ms linear, border-color 120ms linear;

  &:hover:not(:disabled) {
    background: var(--gray-100);
    text-decoration: none;
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  &:disabled {
    color: var(--gray-400);
    cursor: not-allowed;
  }
`;

export const dangerButtonClass = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.75rem;
  padding: 0 var(--space-3);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  white-space: nowrap;
  color: var(--danger);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 120ms linear;

  &:hover:not(:disabled) {
    background: var(--danger-soft);
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  &:disabled {
    color: var(--gray-400);
    cursor: not-allowed;
  }
`;
```

`ghostButtonClass` は Task 4 で `<a>` にも付ける。`text-decoration: none` を hover にも書いているのは、`globalStyles` の `a:hover` が下線を付けるのを打ち消すため。

- [ ] **Step 4: ビルド・全テスト・lint を確認する**

Run: `pnpm --filter @timothy/api run build && pnpm --filter @timothy/api run test && pnpm lint`

Expected: すべて成功（95 件）。マークアップを変えていないので既存テストは影響を受けない。

- [ ] **Step 5: コミット**

```bash
git add packages/api/src/routes/webStyles.ts
git commit -m "feat(api): restyle form inputs and buttons in the neutral palette"
```

---

### Task 4: テーブルを整え、共有列を「開く」「URL をコピー」にする

テーブルのスタイルを無彩色に整え、横スクロール用のラッパーを足し、共有列の中身を 2 ボタンに置き換える。

**Files:**
- Modify: `packages/api/src/routes/webStyles.ts`
- Modify: `packages/api/src/routes/web.tsx`
- Modify: `packages/api/src/routes/web.test.ts`

**Interfaces:**
- Consumes: Task 3 の `ghostButtonClass` / `dangerButtonClass`、Task 2 のデザイントークン
- Produces: `webStyles.ts` が `tableWrapClass`（`string`）と `shareCellClass`（`string`）を追加でエクスポートする。

- [ ] **Step 1: 失敗するテストを書く**

Append to the `describe("GET /", ...)` block in `packages/api/src/routes/web.test.ts`:

```ts
  it("offers 開く and URL をコピー instead of printing the URL", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    const html = await (await app.request("/")).text();

    expect(html).toContain(">開く<");
    expect(html).toContain(">URL をコピー<");
    // URL は href と data-copy-url にのみ残り、本文としては出ない。
    expect(html).toContain('href="http://localhost/s/01ABC"');
    expect(html).toContain('data-copy-url="http://localhost/s/01ABC"');
    expect(html).not.toContain(">http://localhost/s/01ABC<");
  });

  it("labels the share column 共有", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("<th>共有</th>");
    expect(html).not.toContain("<th>共有 URL</th>");
  });

  it("wraps the table so narrow screens scroll the table, not the page", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    const html = await (await app.request("/")).text();
    // ラッパーの div が table を直接包んでいること。
    expect(html).toMatch(/<div class="css-[^"]*"><table/);
    // 横スクロールの指定がスタイルシートに出ていること。
    expect(html).toContain("overflow-x:auto");
  });
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `pnpm --filter @timothy/api run test src/routes/web.test.ts`

Expected: FAIL 3 件。現状は URL 文字列を本文に出し、見出しは「共有 URL」、ラッパー `div` も無い。

- [ ] **Step 3: テーブルのスタイルを整え、2 つのクラスを追加する**

Replace `tableClass`, `badgeClass`, `rowErrorClass` in `packages/api/src/routes/webStyles.ts`, and append `tableWrapClass` と `shareCellClass`:

```ts
export const tableWrapClass = css`
  overflow-x: auto;
  background: var(--gray-0);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
`;

export const tableClass = css`
  width: 100%;
  border-collapse: collapse;

  th,
  td {
    padding: var(--space-3) var(--space-4);
    text-align: left;
    vertical-align: middle;
    white-space: nowrap;
  }

  th {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--gray-500);
    border-bottom: 1px solid var(--gray-200);
  }

  td {
    font-size: 0.875rem;
    border-bottom: 1px solid var(--gray-100);
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr:hover {
    background: var(--gray-25);
  }

  /* 説明は長くなりうるので、この列だけ折り返しを許す。 */
  td:nth-child(2) {
    white-space: normal;
    min-width: 12rem;
    color: var(--gray-700);
  }

  /* 有効期限と作成日時。桁を揃える。 */
  td:nth-child(4),
  td:nth-child(5) {
    font-variant-numeric: tabular-nums;
    color: var(--gray-700);
  }

  /* 期限切れは日時だけ淡くする。タイトルと説明は読めるまま残す。 */
  tr[data-expired="true"] td:nth-child(4),
  tr[data-expired="true"] td:nth-child(5) {
    color: var(--gray-400);
  }
`;

export const shareCellClass = css`
  display: flex;
  gap: var(--space-2);
`;

export const badgeClass = css`
  display: inline-block;
  margin-left: var(--space-2);
  padding: 2px var(--space-2);
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--danger);
  background: var(--danger-soft);
  border-radius: 999px;
`;

export const rowErrorClass = css`
  margin-left: var(--space-2);
  font-size: 0.8125rem;
  color: var(--danger);
`;
```

`shareCellClass` は共有セルの中でボタン 2 つを横に並べるためのもの。`td` に直接 `display: flex` を当てると行の高さが崩れるので、セル内に `div` を 1 つ置いてそれに当てる。

- [ ] **Step 4: `web.tsx` のマークアップを更新する**

`packages/api/src/routes/web.tsx` の `webStyles.js` からの import に 2 つ足す:

```tsx
  tableWrapClass,
  shareCellClass,
```

`FileTable` の `return` を次に差し替える。変更点は (a) `table` を `div class={tableWrapClass}` で包む、(b) 見出しを「共有 URL」→「共有」、(c) 共有セルの中身を 2 ボタンに:

```tsx
  return (
    <div class={tableWrapClass}>
      <table class={tableClass}>
        <thead>
          <tr>
            <th>タイトル</th>
            <th>説明</th>
            <th>共有</th>
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
                <td>
                  {formatJst(file.expiresAt)}
                  {expired ? <span class={badgeClass}>期限切れ</span> : null}
                </td>
                <td>{formatJst(file.createdAt)}</td>
                <td>
                  <button type="button" class={dangerButtonClass} data-delete-id={file.id}>
                    削除
                  </button>
                  <span class={rowErrorClass} data-row-error></span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
```

- [ ] **Step 5: テストを実行して成功することを確認する**

Run: `pnpm --filter @timothy/api run test src/routes/web.test.ts`

Expected: PASS（28 件）

`wraps the table` が落ちる場合は、実際に出力された HTML を見てから直すこと:

```bash
pnpm --filter @timothy/api exec vitest run src/routes/web.test.ts -t "wraps the table" --reporter=verbose
```

`div` が `table` を直接包んでいない（間に別の要素が入った等）ことが原因なら実装を直す。正規表現を緩めて通すのは禁止。

- [ ] **Step 6: 旧トークンの参照が完全に消えたことを確認する**

Run:

```bash
grep -nE "var\(--(bg|panel|panel-edge|line|line-strong|cyan|yellow|text|text-dim|gap|gap-lg|font-mono|font-ui)\)|ui-monospace|text-transform|letter-spacing: 0\.|clip-path" packages/api/src/routes/webStyles.ts
```

Expected: 1 件も出ない。出た場合は Task 2・3 で消し忘れた HUD 由来の指定なので、設計書に沿って直すこと。

- [ ] **Step 7: ビルド・全テスト・lint を確認する**

Run: `pnpm --filter @timothy/api run build && pnpm --filter @timothy/api run test && pnpm lint`

Expected: すべて成功（98 件）

既存テスト `renders a row with the title and share URL` は `expect(html).toContain("http://localhost/s/01ABC")` を検証している。`href` と `data-copy-url` に URL が残るので通る。落ちた場合は実装を疑うこと（テストを緩めてはいけない）。

- [ ] **Step 8: コミット**

```bash
git add packages/api/src/routes/webStyles.ts packages/api/src/routes/web.tsx packages/api/src/routes/web.test.ts
git commit -m "feat(api): restyle the table and replace share URL text with actions"
```

---

### Task 5: 実画面で見た目を確認する

自動テストは構造しか見ていないので、実際に描画して確認する。コードの変更は原則不要。崩れが見つかった場合のみ `webStyles.ts` を調整する。

**Files:**
- Modify: `packages/api/src/routes/webStyles.ts`（崩れが見つかった場合のみ）

**Interfaces:**
- Consumes: Task 4 までの全成果
- Produces: なし

- [ ] **Step 1: Firebase エミュレータを起動する**

バックグラウンドで実行し、`All emulators ready` が出るまで待つ:

```bash
PATH="/opt/homebrew/opt/openjdk/bin:$PATH" npx -y firebase-tools emulators:start --only firestore,storage --project demo-test
```

Java は PATH に無いが `/opt/homebrew/opt/openjdk/bin` に入っている。`firebase` CLI は未インストールなので `npx` で取得する。

- [ ] **Step 2: 確認用データを投入する**

次の内容を `/private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/seed.mts` に書く。拡張子は `.mts` にすること（このディレクトリには `package.json` が無く、`.ts` だと tsx が CJS として扱ってトップレベル `await` が使えない）:

```ts
import { db } from "/Users/shunsuke.tadokoro/work/timothy-cli/packages/api/src/lib/firebase.js";

const days = (n: number) => new Date(Date.now() + n * 86400000);

const fixtures = [
  { id: "01ALIVE", title: "月次レポート", description: "2026 年 7 月の集計結果", expiresAt: days(7), createdAt: days(-1) },
  { id: "01EXPIRED", title: "先月のレポート", description: "期限切れの表示確認用", expiresAt: days(-3), createdAt: days(-30) },
  { id: "01NODESC", title: "説明なしのファイル", description: "", expiresAt: days(30), createdAt: days(-2) },
  { id: "01LONG", title: "四半期ごとの売上と原価の推移をまとめた資料", description: "説明も長い場合にテーブルがどう折り返すかを確認するための行。二文目もある。", expiresAt: days(14), createdAt: new Date() },
];

for (const f of fixtures) {
  await db.collection("htmlFiles").doc(f.id).set({
    title: f.title,
    description: f.description,
    storagePath: `timothy-files/${f.id}.html`,
    expiresAt: f.expiresAt,
    createdAt: f.createdAt,
  });
}
console.log("seeded");
```

実行:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=demo-test \
FIREBASE_STORAGE_BUCKET=demo-test.appspot.com \
npx tsx /private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/seed.mts
```

- [ ] **Step 3: 開発サーバーを起動する**

バックグラウンドで実行し、`Server running on http://localhost:3000` が出るまで待つ:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=demo-test \
FIREBASE_STORAGE_BUCKET=demo-test.appspot.com PORT=3000 pnpm dev:api
```

ポート 3000 が既に使われている場合は `lsof -ti:3000 | xargs kill -9` で解放してから起動する。

- [ ] **Step 4: 一覧ページを撮影して確認する**

```bash
agent-browser open http://localhost:3000/
agent-browser screenshot /private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/list.png
```

撮った画像を Read して、次を目視で確認する:

- 背景が明るいグレー、文字が濃いグレーで、赤・黄・シアンが残っていない
- 画面端のバイナリ列、四隅の L 字ブラケット、段差の罫線が消えている
- `h1` が「Timothy」だけで、件数表示が付いていない
- 行番号列が無く、列が タイトル / 説明 / 共有 / 有効期限 / 作成日時 / （削除）の 6 つ
- 「開く」「URL をコピー」がボタンとして並び、URL の文字列は出ていない
- 有効期限と作成日時の桁が揃っている
- 期限切れの行は日時だけ淡く、タイトルは読める
- 等幅フォントと広い字間が残っていない

- [ ] **Step 5: ホバーとフォーカスを確認する**

```bash
agent-browser hover "[data-delete-id='01ALIVE']"
agent-browser screenshot /private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/hover.png
agent-browser focus "#title-input"
agent-browser screenshot /private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/focus.png
```

削除ボタンの hover で淡い赤の背景が出ること、入力欄のフォーカスで青いリングが出ることを画像で確認する。

- [ ] **Step 6: 狭い画面でページが横スクロールしないことを確認する**

```bash
agent-browser resize 420 900
agent-browser screenshot /private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/narrow.png
agent-browser eval 'document.documentElement.scrollWidth <= document.documentElement.clientWidth'
```

Expected: `eval` が `true` を返す。`false` ならラッパーが効いていないので `tableWrapClass` を調整する。

- [ ] **Step 7: 空状態と 500 ページを確認する**

空状態は Firestore のデータを消して確認する:

```bash
curl -s -X DELETE "http://127.0.0.1:8080/emulator/v1/projects/demo-test/databases/(default)/documents"
agent-browser resize 1280 900
agent-browser open http://localhost:3000/
agent-browser screenshot /private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/empty.png
```

「まだファイルがありません」の 1 行だけが出て、英字見出しが無いことを確認する。

500 ページはエミュレータを止めてから開くと出る。確認したらエミュレータを戻す。

- [ ] **Step 8: 後片付け**

```bash
lsof -ti:3000 | xargs kill
```

エミュレータのプロセスも止める。一時スクリプトとスクリーンショットはリポジトリ外に置いてあること、`git status` が clean であることを確認する。

- [ ] **Step 9: 調整した場合のみコミット**

崩れを直した場合:

```bash
git add packages/api/src/routes/webStyles.ts
git commit -m "fix(api): adjust web UI styling found in visual check"
```

調整が不要だった場合はコミットしない。確認結果を報告すること。

---

## 完了条件

- [ ] `pnpm --filter @timothy/api run build` が成功する
- [ ] `pnpm --filter @timothy/api run test` が成功する（98 件）
- [ ] `pnpm lint` が 0 errors
- [ ] `webStyles.ts` に旧トークン（`--bg` `--panel` `--cyan` `--yellow` `--text-dim` 等）と `ui-monospace` / `text-transform` / `clip-path` が残っていない
- [ ] `web.tsx` に `DataRails` `Header` `cx` `rowNumberClass` `urlClass` が残っていない
- [ ] DOM の ID と `data-*` 属性が変わっていない
- [ ] `webScript.ts` が変更されていない
- [ ] 一覧に URL の文字列が表示されず、「開く」「URL をコピー」が動く
- [ ] 幅 420px でページ全体が横スクロールしない
