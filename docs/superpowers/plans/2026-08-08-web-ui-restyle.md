# Web UI ビジュアルリニューアル 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Timothy の管理画面（`GET /`）の見た目を、静かな無彩色 + アクセント 1 色のトーンに刷新する。

**Architecture:** デザイントークンを CSS 変数として `bodyClass` に定義し、各スタイルがそれを参照する。スタイル定数は `web.tsx` から `webStyles.ts` に切り出し、`web.tsx` はマークアップに専念させる。マークアップの変更はテーブルの横スクロール用ラッパーと共有列の中身の 2 箇所のみ。

**Tech Stack:** Hono 4 / hono/jsx / hono/css / TypeScript 6 (NodeNext) / vitest 4

## Global Constraints

- 設計書: `docs/superpowers/specs/2026-08-08-web-ui-restyle-design.md`。矛盾があれば設計書が優先。
- 作業ブランチは `feature/web-ui`。すでにチェックアウト済み。
- TypeScript は `strict: true`、モジュールは `NodeNext`。**相対 import は必ず `.js` 拡張子を付ける**（`.tsx` を import する場合も `.js`）。
- テストファイル名は必ず `*.test.ts`。vitest の `include` が `src/**/*.test.ts` のため `.test.tsx` は実行されない。テストコード内で JSX は書かない。
- **DOM の要素 ID を変更してはならない。** `#upload-form` `#drop-zone` `#file-input` `#title-input` `#description-input` `#ttl-input` `#submit-button` `#form-error`、および `data-delete-id` `data-copy-url` `data-row-error` `data-dragging` `data-expired` は `webScript.ts` のクライアント JS が参照している。
- **`packages/api/src/routes/webScript.ts` は変更しない。**
- UI の文言はすべて日本語。
- ライトテーマのみ。`prefers-color-scheme` は使わない。
- 外部フォント・外部アセットは読み込まない。
- コマンドはリポジトリルートから実行する。テスト `pnpm --filter @timothy/api run test`、ビルド `pnpm --filter @timothy/api run build`、lint `pnpm lint`。3 つとも成功する状態を保つこと。
- `packages/api/vitest.config.ts` のカバレッジ閾値は `src/routes/**` に対して lines 80 / functions 50 / branches 80 / statements 80。`webStyles.ts` もこの対象に入るが、定数のみのファイルなので実行されるのは import 時のトップレベルだけで、`GET /` を叩くテストが通れば充足する。

### デザイントークン（値は設計書からの写し。実装時はこの表を正とする）

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

---

### Task 1: スタイル定数を `webStyles.ts` に切り出す

見た目はまだ変えない。純粋な移動のみ。こうすることで、次のタスクの差分が「見た目の変更」だけになり、レビューしやすくなる。

**Files:**
- Create: `packages/api/src/routes/webStyles.ts`
- Modify: `packages/api/src/routes/web.tsx`

**Interfaces:**
- Consumes: なし
- Produces: `packages/api/src/routes/webStyles.ts` が次の 9 つを名前付きエクスポートする。すべて `string`（`hono/css` の `css` が返すクラス名）。
  - `bodyClass`, `containerClass`, `formClass`, `dropZoneClass`, `errorBoxClass`, `tableClass`, `badgeClass`, `emptyClass`, `errorPageClass`

- [ ] **Step 1: 現在のスタイル定数を確認する**

Run: `sed -n '24,148p' packages/api/src/routes/web.tsx`

`bodyClass` から `errorPageClass` までの 9 つの `css` テンプレートが並んでいることを確認する。この範囲をそのまま移す。

- [ ] **Step 2: `webStyles.ts` を作る**

Create `packages/api/src/routes/webStyles.ts`。`web.tsx` の 24〜147 行にある 9 つの `css` 定数を**値を一切変えずに**移し、それぞれ `export const` にする。ファイル先頭に import を置く:

```ts
import { css } from "hono/css";
```

移す定数は `bodyClass`, `containerClass`, `tableClass`, `badgeClass`, `formClass`, `dropZoneClass`, `errorBoxClass`, `emptyClass`, `errorPageClass` の 9 つ。

- [ ] **Step 3: `web.tsx` から定数を消して import に置き換える**

`web.tsx` の 2 行目の `import { css, Style } from "hono/css";` を次に変える（`css` はもう使わない）:

```tsx
import { Style } from "hono/css";
```

`import { CLIENT_SCRIPT } from "./webScript.js";` の直後に追加:

```tsx
import {
  badgeClass,
  bodyClass,
  containerClass,
  dropZoneClass,
  emptyClass,
  errorBoxClass,
  errorPageClass,
  formClass,
  tableClass,
} from "./webStyles.js";
```

そのうえで、`web.tsx` に残っている 9 つの `const ...Class = css\`...\`` の定義をすべて削除する。`JST_FORMATTER` / `formatJst` / `isExpired` / `DOCTYPE` は残す。

- [ ] **Step 4: テストとビルドが通ることを確認する**

Run: `pnpm --filter @timothy/api run build && pnpm --filter @timothy/api run test && pnpm lint`

Expected: すべて成功。テストは 93 件。見た目を変えていないので、既存テストは 1 件も落ちない。

- [ ] **Step 5: 出力 HTML が変わっていないことを確認する**

Run:

```bash
pnpm --filter @timothy/api exec vitest run src/routes/web.test.ts --reporter=dot
```

Expected: PASS。特に「一覧を取得できませんでした」「まだファイルがありません」を検証するテストが通ること。

- [ ] **Step 6: コミット**

```bash
git add packages/api/src/routes/webStyles.ts packages/api/src/routes/web.tsx
git commit -m "refactor(api): move web UI style constants into webStyles"
```

---

### Task 2: デザイントークンを導入し、ページとカードを整える

トークンを定義し、まずページ全体・見出し・カード（フォームとテーブルの外枠）・空状態・500 ページに適用する。ボタンとテーブルの中身は Task 3・4 で扱う。

**Files:**
- Modify: `packages/api/src/routes/webStyles.ts`
- Modify: `packages/api/src/routes/web.test.ts`

**Interfaces:**
- Consumes: Task 1 の 9 つのクラス定数
- Produces: `bodyClass` のブロック内に全デザイントークンが CSS 変数として定義された状態。Task 3・4 のスタイルはこれを `var(--...)` で参照する。

- [ ] **Step 1: 失敗するテストを書く**

Append to the `describe("GET /", ...)` block in `packages/api/src/routes/web.test.ts`:

```ts
  // webStyles.ts の import が外れたり <Style /> が消えたりすると、
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

Expected: FAIL。`#2563eb` はまだどこにも無い（`<style id="hono-css">` は既に出ているので、そちらは通る）。

- [ ] **Step 3: `bodyClass` にトークンを定義してページを整える**

Replace `bodyClass` in `packages/api/src/routes/webStyles.ts`:

```ts
export const bodyClass = css`
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

  margin: 0;
  padding: var(--space-6) var(--space-4) var(--space-6);
  font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  font-size: 0.9375rem;
  line-height: 1.6;
  color: var(--gray-900);
  background: var(--gray-50);

  h1 {
    margin: 0 0 var(--space-5);
    font-size: 1.5rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
`;
```

- [ ] **Step 4: カード・空状態・500 ページを整える**

Replace `formClass`, `emptyClass`, `errorPageClass` in `packages/api/src/routes/webStyles.ts`。`formClass` の入力欄とボタンの指定は Task 3 で足すので、ここでは外枠だけにする:

```ts
export const formClass = css`
  margin-bottom: var(--space-5);
  padding: var(--space-5);
  background: var(--gray-0);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
`;

export const emptyClass = css`
  margin: 0;
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--gray-500);
  background: var(--gray-0);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
`;

export const errorPageClass = css`
  margin: 0;
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--danger);
  background: var(--gray-0);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
`;
```

- [ ] **Step 5: テストを実行して成功することを確認する**

Run: `pnpm --filter @timothy/api run test src/routes/web.test.ts`

Expected: PASS（24 テスト）

- [ ] **Step 6: 全テスト・ビルド・lint を確認する**

Run: `pnpm --filter @timothy/api run build && pnpm --filter @timothy/api run test && pnpm lint`

Expected: すべて成功（94 テスト）

- [ ] **Step 7: コミット**

```bash
git add packages/api/src/routes/webStyles.ts packages/api/src/routes/web.test.ts
git commit -m "feat(api): introduce design tokens and restyle page shell"
```

---

### Task 3: フォームとボタンを整える

入力欄・ラベル・ドロップゾーン・エラー表示を整え、ボタンのクラスを 3 種類（primary / ghost / danger）用意する。この時点ではまだマークアップに `class` を足さないので、画面上のボタンは素のままに見える。適用は Task 4 で行う。

**Files:**
- Modify: `packages/api/src/routes/webStyles.ts`

**Interfaces:**
- Consumes: Task 2 のデザイントークン
- Produces: `webStyles.ts` が次の 3 つを追加でエクスポートする。すべて `string`。
  - `primaryButtonClass` — アップロードボタン用
  - `ghostButtonClass` — 「開く」リンクと「URL をコピー」ボタン用
  - `dangerButtonClass` — 削除ボタン用

- [ ] **Step 1: 入力欄とラベルを整える**

Replace `formClass` in `packages/api/src/routes/webStyles.ts`（Task 2 で作った外枠に、中身の指定を足す）:

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
    transition: border-color 0.15s, box-shadow 0.15s;
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
    font-weight: 400;
    color: var(--gray-700);
  }
`;
```

- [ ] **Step 2: ドロップゾーンとエラー表示を整える**

Replace `dropZoneClass` and `errorBoxClass` in `packages/api/src/routes/webStyles.ts`:

```ts
export const dropZoneClass = css`
  margin-bottom: var(--space-4);
  padding: var(--space-6) var(--space-4);
  text-align: center;
  font-size: 0.875rem;
  color: var(--gray-500);
  border: 2px dashed var(--gray-300);
  border-radius: var(--radius-md);
  transition: border-color 0.15s, background-color 0.15s, color 0.15s;

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

`&[hidden] { display: none; }` は必ず残すこと。`web.test.ts` の `hides the error area by default` はマークアップ側の `hidden` 属性を見ているので落ちないが、これを消すとエラー欄が常時表示される。

- [ ] **Step 3: ボタンのクラスを 3 つ追加する**

Append to `packages/api/src/routes/webStyles.ts`:

```ts
const buttonBaseClass = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 2.25rem;
  padding: 0 var(--space-4);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
`;

export const primaryButtonClass = css`
  ${buttonBaseClass}
  color: #fff;
  background: var(--accent);

  &:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

export const ghostButtonClass = css`
  ${buttonBaseClass}
  height: 1.75rem;
  padding: 0 var(--space-3);
  font-size: 0.8125rem;
  color: var(--gray-700);
  background: transparent;
  border-color: var(--gray-200);

  &:hover {
    background: var(--gray-100);
  }
`;

export const dangerButtonClass = css`
  ${buttonBaseClass}
  height: 1.75rem;
  padding: 0 var(--space-3);
  font-size: 0.8125rem;
  color: var(--danger);
  background: transparent;

  &:hover:not(:disabled) {
    background: var(--danger-soft);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;
```

`hono/css` はテンプレート内に別のクラスを `${}` で埋め込むと、その定義を展開して合成する。`buttonBaseClass` は外部から使わないので `export` しない。

- [ ] **Step 4: ビルドとテストが通ることを確認する**

Run: `pnpm --filter @timothy/api run build && pnpm --filter @timothy/api run test && pnpm lint`

Expected: すべて成功（94 テスト）。マークアップを変えていないので既存テストは影響を受けない。

この 3 つのクラスを実際にマークアップへ適用するのは Task 4 なので、この時点では画面上のボタンの見た目は変わらない。ビルドが通ればこのタスクは完了でよい。

- [ ] **Step 5: コミット**

```bash
git add packages/api/src/routes/webStyles.ts
git commit -m "feat(api): restyle form inputs and add button variants"
```

---

### Task 4: テーブルを整え、共有列を「開く」「URL をコピー」に置き換える

テーブルのスタイルを整え、マークアップに 2 箇所手を入れる。ボタンのクラスもここで適用する。

**Files:**
- Modify: `packages/api/src/routes/webStyles.ts`
- Modify: `packages/api/src/routes/web.tsx`
- Modify: `packages/api/src/routes/web.test.ts`

**Interfaces:**
- Consumes: Task 3 の `primaryButtonClass` / `ghostButtonClass` / `dangerButtonClass`、Task 2 のデザイントークン
- Produces: `webStyles.ts` が `tableWrapClass`（`string`）を追加でエクスポートする。

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

Expected: FAIL。3 件とも失敗する（現状は URL 文字列を本文に出しており、見出しは「共有 URL」、ラッパー `div` も無い）。

- [ ] **Step 3: テーブルのスタイルを整え、ラッパー用クラスを追加する**

Replace `tableClass` and `badgeClass` in `packages/api/src/routes/webStyles.ts`, and append `tableWrapClass`:

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

  /* 日時の桁を揃える。有効期限と作成日時の 2 列。 */
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

  /* 説明は長くなりうるので、この列だけ折り返しを許す。 */
  td:nth-child(2) {
    white-space: normal;
    min-width: 12rem;
    color: var(--gray-700);
  }

  [data-row-error] {
    margin-left: var(--space-2);
    font-size: 0.8125rem;
    color: var(--danger);
  }
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
```

- [ ] **Step 4: `web.tsx` のマークアップを更新する**

`packages/api/src/routes/web.tsx` の import に 4 つ足す（`webStyles.js` からの既存 import に追加）:

```tsx
  dangerButtonClass,
  ghostButtonClass,
  primaryButtonClass,
  tableWrapClass,
```

`FileTable` の `return` を次に差し替える。変更点は (a) `table` を `div class={tableWrapClass}` で包む、(b) 見出しを「共有 URL」→「共有」、(c) 共有セルの中身を 2 ボタンに、(d) 各ボタンにクラスを付ける:

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
                  <a
                    class={ghostButtonClass}
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    開く
                  </a>{" "}
                  <button type="button" class={ghostButtonClass} data-copy-url={file.url}>
                    URL をコピー
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
                  <span data-row-error></span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
```

`UploadForm` の送信ボタンにもクラスを付ける:

```tsx
      <button id="submit-button" class={primaryButtonClass} type="submit">
        アップロード
      </button>
```

- [ ] **Step 5: テストを実行して成功することを確認する**

Run: `pnpm --filter @timothy/api run test src/routes/web.test.ts`

Expected: PASS（27 テスト）

`wraps the table` が落ちる場合は、実際に出力された HTML を見てから直すこと。次で確認できる:

```bash
pnpm --filter @timothy/api exec vitest run src/routes/web.test.ts -t "wraps the table" --reporter=verbose
```

`div` が `table` を直接包んでいない（間に別の要素が入った、`hono/jsx` がフラグメントを挟んだ等）ことが原因なら実装を直す。正規表現を緩めて通すのは禁止。

- [ ] **Step 6: 全テスト・ビルド・lint を確認する**

Run: `pnpm --filter @timothy/api run build && pnpm --filter @timothy/api run test && pnpm lint`

Expected: すべて成功（97 テスト）

既存テストのうち `renders a row with the title and share URL` は `expect(html).toContain("http://localhost/s/01ABC")` を検証している。`href` と `data-copy-url` に URL が残るので通る。落ちた場合は実装を疑うこと（テストを緩めてはいけない）。

- [ ] **Step 7: コミット**

```bash
git add packages/api/src/routes/webStyles.ts packages/api/src/routes/web.tsx packages/api/src/routes/web.test.ts
git commit -m "feat(api): restyle table and replace share URL text with actions"
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

Run（バックグラウンドで実行し、`All emulators ready` が出るまで待つ）:

```bash
PATH="/opt/homebrew/opt/openjdk/bin:$PATH" npx -y firebase-tools emulators:start --only firestore,storage --project demo-test
```

Java は PATH に無いが `/opt/homebrew/opt/openjdk/bin` に入っている。`firebase` CLI は未インストールなので `npx` で取得する。

- [ ] **Step 2: 確認用データを投入する**

有効なファイル・期限切れのファイル・説明が空のファイル・長いタイトルの 4 件を Firestore に入れる。次のスクリプトを一時ファイルとして書き、`tsx` で実行する（リポジトリ内には置かないこと）:

```ts
import { db } from "/Users/shunsuke.tadokoro/work/timothy-cli/packages/api/src/lib/firebase.js";

const days = (n: number) => new Date(Date.now() + n * 86400000);

const fixtures = [
  { id: "01ALIVE", title: "月次レポート", description: "2026 年 7 月の集計結果", expiresAt: days(7), createdAt: days(-1) },
  { id: "01EXPIRED", title: "先月のレポート", description: "期限切れの表示確認用", expiresAt: days(-3), createdAt: days(-30) },
  { id: "01NODESC", title: "説明なしのファイル", description: "", expiresAt: days(30), createdAt: days(-2) },
  { id: "01LONG", title: "四半期ごとの売上と原価の推移をまとめた資料", description: "説明も長い場合にテーブルがどう折り返すかを確認するための行。二文目。", expiresAt: days(14), createdAt: new Date() },
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

拡張子は `.mts` にすること。スクラッチ用ディレクトリには `package.json` が無く、`.ts` だと tsx が CJS として扱ってトップレベル `await` が使えない。

実行:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=demo-test \
FIREBASE_STORAGE_BUCKET=demo-test.appspot.com \
npx tsx /private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/seed.mts
```

- [ ] **Step 3: 開発サーバーを起動する**

Run（バックグラウンド）:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=demo-test \
FIREBASE_STORAGE_BUCKET=demo-test.appspot.com PORT=3000 pnpm dev:api
```

`Server running on http://localhost:3000` が出るまで待つ。

- [ ] **Step 4: 一覧ページを撮影して確認する**

```bash
agent-browser open http://localhost:3000/
agent-browser screenshot /private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/list.png
```

撮った画像を Read して、次を目視で確認する:

- `h1` が過大になっていない
- カードの枠線と影が控えめで、面が分かれて見える
- テーブルの見出しが淡いグレーで、罫線が細い
- 有効期限と作成日時の桁が揃っている
- 期限切れの行は日時だけ淡く、タイトルは読める
- 「開く」「URL をコピー」がボタンとして並び、URL の文字列は出ていない
- 削除ボタンが赤系の文字色

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

Expected: `eval` が `true` を返す。`false` ならテーブルのラッパーが効いていないので `tableWrapClass` を調整する。

- [ ] **Step 7: 空状態と 500 ページを確認する**

空状態は Firestore のデータを消して確認する:

```bash
curl -s -X DELETE "http://127.0.0.1:8080/emulator/v1/projects/demo-test/databases/(default)/documents"
agent-browser resize 1280 900
agent-browser open http://localhost:3000/
agent-browser screenshot /private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/empty.png
```

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
- [ ] `pnpm --filter @timothy/api run test` が成功する（97 件以上）
- [ ] `pnpm lint` が 0 errors
- [ ] `web.tsx` にスタイル定数が残っていない
- [ ] DOM の ID と `data-*` 属性が変わっていない
- [ ] `webScript.ts` が変更されていない
- [ ] 一覧に URL の文字列が表示されず、「開く」「URL をコピー」が動く
- [ ] 幅 420px でページ全体が横スクロールしない
