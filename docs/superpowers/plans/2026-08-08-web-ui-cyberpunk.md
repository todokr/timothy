# Web UI サイバーパンク化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Timothy の管理画面（`GET /`）の見た目を、Cyberpunk 2077 の UI を題材にした暗色 HUD 表現に刷新する。

**Architecture:** デザイントークンを CSS カスタムプロパティとして `:root` に定義し、既存の `hono/css` 定数を `var(--…)` 参照に置き換える。スタイルは `routes/webStyles.ts` に切り出し、`web.tsx` はマークアップに専念させる。レイアウト構造（フォーム + 一覧）は変えない。

**Tech Stack:** Hono 4 / hono/jsx / hono/css / TypeScript 6 (NodeNext) / vitest 4

## Global Constraints

- 設計書: `docs/superpowers/specs/2026-08-08-web-ui-cyberpunk-design.md`。矛盾があれば設計書が優先。
- 作業ブランチは `feature/web-ui`。すでにチェックアウト済み。
- TypeScript は `strict: true`、モジュールは `NodeNext`。**相対 import は必ず `.js` 拡張子を付ける**（`.tsx` を import する場合も `.js`）。
- テストファイル名は必ず `*.test.ts`。vitest の `include` は `src/**/*.test.ts`。テストコード内で JSX は書かない。
- コマンドはリポジトリルートから実行する。テスト: `pnpm --filter @timothy/api run test`、ビルド: `pnpm --filter @timothy/api run build`、lint: `pnpm lint`。3 つとも成功すること。
- 開始時点のテストは 93 件（`web.test.ts` は 23 件）。**既存テストを 1 件も書き換えない**。それがリグレッションの担保。
- **変更してはいけない文言**（既存テストが判定に使っている）:
  `期限切れ` / `まだファイルがありません` / `ファイル` / `タイトル` / `説明（任意）` / `有効期間（日）` / `アップロード` / `削除` / `コピー` / `一覧を取得できませんでした`
- **変更してはいけない DOM**（`webScript.ts` が引いている）:
  `#upload-form` / `#drop-zone`（`data-dragging` 属性）/ `#file-input` / `#title-input` / `#description-input` / `#ttl-input` / `#submit-button` / `#form-error` / `[data-delete-id]` / `[data-copy-url]` / `[data-row-error]`
- `packages/api/src/routes/webScript.ts` は**変更しない**。
- 外部リソース（Web フォント、CDN、画像）を一切読み込まない。
- デザイントークンの値（設計書より、そのまま使う）:

  | 変数 | 値 | 変数 | 値 |
  |---|---|---|---|
  | `--bg` | `#08090B` | `--accent` | `#FF2E3E` |
  | `--panel` | `#0E1013` | `--cyan` | `#00E5E8` |
  | `--panel-edge` | `#1A1D22` | `--yellow` | `#FCEE0A` |
  | `--line` | `#2A1116` | `--text` | `#D3D7DE` |
  | `--line-strong` | `#7A1020` | `--text-dim` | `#7B828E` |

- 等幅フォント: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`
- 本文フォント: `system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`

## ローカル確認環境

Firebase エミュレータと API サーバーがすでに動いている場合がある。動いていなければ次で起動する。

```bash
# エミュレータ（別プロセス、起動済みなら不要）
PATH="/opt/homebrew/opt/openjdk/bin:$PATH" npx -y firebase-tools emulators:start \
  --only firestore,storage --project demo-test

# API サーバー
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
STORAGE_EMULATOR_HOST=http://127.0.0.1:9199 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 \
FIREBASE_PROJECT_ID=demo-test \
FIREBASE_STORAGE_BUCKET=demo-test.appspot.com \
PORT=3000 pnpm dev:api
```

スクリーンショットは `agent-browser` で撮る。

```bash
agent-browser open http://localhost:3000/
agent-browser screenshot /tmp/shot.png
```

エミュレータに接続できない場合、`GET /` は 500 のエラーページを返す。その場合でも
`curl -s http://localhost:3000/ | grep …` で出力の検証はできるので、目視確認だけ後回しにして先へ進むこと。

---

### Task 1: スタイルを `webStyles.ts` に切り出す（見た目は変えない）

まず純粋なリファクタとして、既存の `css` 定数をそのまま別ファイルへ移す。**この時点で見た目は 1px も変わらない。** 既存 23 件のテストが全部通ることが正しさの証拠になる。

**Files:**
- Create: `packages/api/src/routes/webStyles.ts`
- Modify: `packages/api/src/routes/web.tsx`（`css` 定数の定義を削除し import に置き換え）

**Interfaces:**
- Consumes: なし
- Produces: `packages/api/src/routes/webStyles.ts` から次の名前付きエクスポート。すべて `Promise<string>`（`hono/css` の `css` が返すクラス名）。
  `bodyClass`, `containerClass`, `tableClass`, `badgeClass`, `formClass`, `dropZoneClass`, `errorBoxClass`, `emptyClass`, `errorPageClass`

- [ ] **Step 1: `webStyles.ts` を作る**

Create `packages/api/src/routes/webStyles.ts`。`web.tsx` の 24〜147 行にある 9 個の `css` 定数を、**値を一切変えずに**そのまま移す。ファイル冒頭は次のとおり。

```ts
import { css } from "hono/css";

export const bodyClass = css`
  margin: 0;
  padding: 2rem 1.5rem 4rem;
  font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  color: #1f2933;
  background: #f7f8fa;
`;
```

以下同様に `containerClass`, `tableClass`, `badgeClass`, `formClass`, `dropZoneClass`, `errorBoxClass`, `emptyClass`, `errorPageClass` を移す。定義順は `web.tsx` での出現順に揃える。

- [ ] **Step 2: `web.tsx` を書き換える**

`packages/api/src/routes/web.tsx` から 24〜147 行の `css` 定数定義をすべて削除し、import を差し替える。

削除する import:

```ts
import { css, Style } from "hono/css";
```

追加する import（`Style` は引き続き使う）:

```ts
import { Style } from "hono/css";
import {
  bodyClass,
  containerClass,
  tableClass,
  badgeClass,
  formClass,
  dropZoneClass,
  errorBoxClass,
  emptyClass,
  errorPageClass,
} from "./webStyles.js";
```

`DOCTYPE` の定義（149〜151 行）とその上のコメントは `web.tsx` に残す。マークアップの都合であってスタイルではないため。

- [ ] **Step 3: テスト・ビルド・lint を実行する**

Run: `pnpm --filter @timothy/api run test && pnpm --filter @timothy/api run build && pnpm lint`

Expected: テスト 93 件すべて成功、ビルド成功、lint 0 エラー。

**1 件でも落ちたら、それは移設ミス。** 値を変えずに移すだけなので落ちる理由はない。

- [ ] **Step 4: 見た目が変わっていないことを確認する**

Run:

```bash
curl -s http://localhost:3000/ | grep -o 'background:#f7f8fa' | head -1
```

Expected: `background:#f7f8fa` が出力される（切り出し前と同じスタイルが配信されている）。

サーバーが動いていなければこの手順は飛ばしてよい。

- [ ] **Step 5: コミット**

```bash
git add packages/api/src/routes/webStyles.ts packages/api/src/routes/web.tsx
git commit -m "refactor(api): extract web UI styles into webStyles"
```

---

### Task 2: デザイントークンとダークテーマの土台を入れる

`:root` にトークンを定義し、全体を暗色に切り替える。この時点ではレイアウトも装飾も変えず、色とフォントだけが変わる。

`hono/css` の `<Style>` は children を受け取れる（型定義: `(args?: { children?: Promise<string>; nonce?: string })`）。これを使ってグローバル CSS を出す。

**Files:**
- Modify: `packages/api/src/routes/webStyles.ts`
- Modify: `packages/api/src/routes/web.tsx`
- Modify: `packages/api/src/routes/web.test.ts`（1 件追加）

**Interfaces:**
- Consumes: Task 1 の各 `*Class`
- Produces: `webStyles.ts` に `export const globalStyles` を追加（`Promise<string>`）。`<Style>{globalStyles}</Style>` の形で使う。`bodyClass` は削除する。

- [ ] **Step 1: 失敗するテストを書く**

`packages/api/src/routes/web.test.ts` の `describe("GET /", ...)` ブロックの末尾に追加:

```ts
  it("declares a dark color scheme", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toMatch(/color-scheme:\s*dark/);
  });
```

`hono/css` が宣言をどう圧縮するかに依存しないよう、コロンの後の空白を正規表現で吸収している。

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `pnpm --filter @timothy/api run test src/routes/web.test.ts`

Expected: FAIL（新しい 1 件のみ）

- [ ] **Step 3: `webStyles.ts` にトークンとグローバルスタイルを追加する**

`packages/api/src/routes/webStyles.ts` の `import` 直後に追加する。

```ts
export const globalStyles = css`
  :root {
    color-scheme: dark;

    --bg: #08090b;
    --panel: #0e1013;
    --panel-edge: #1a1d22;
    --line: #2a1116;
    --line-strong: #7a1020;
    --accent: #ff2e3e;
    --cyan: #00e5e8;
    --yellow: #fcee0a;
    --text: #d3d7de;
    --text-dim: #7b828e;

    --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    --font-ui: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;

    --gap: 1rem;
    --gap-lg: 2rem;
  }

  html,
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
  }

  body {
    padding: 2rem 1.5rem 4rem;
    font-family: var(--font-ui);
    font-size: 0.9375rem;
    line-height: 1.6;
  }

  a {
    color: var(--cyan);
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

- [ ] **Step 4: `bodyClass` を削除する**

`webStyles.ts` から `bodyClass` の定義を削除する。`body` のスタイルは `globalStyles` に移った。

- [ ] **Step 5: 既存の 8 定数をトークン参照に置き換える**

`webStyles.ts` の残り 8 定数の色をトークンに差し替える。レイアウト（padding・margin・サイズ）はこのタスクでは変えない。

```ts
export const containerClass = css`
  max-width: 60rem;
  margin: 0 auto;
`;

export const tableClass = css`
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
  border: 1px solid var(--panel-edge);
  overflow: hidden;

  th,
  td {
    padding: 0.6rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--line);
    font-size: 0.875rem;
    vertical-align: top;
  }

  th {
    background: #121419;
    font-weight: 600;
    color: var(--text-dim);
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr[data-expired="true"] {
    color: var(--text-dim);
  }
`;

export const badgeClass = css`
  display: inline-block;
  padding: 0.1rem 0.4rem;
  margin-left: 0.4rem;
  font-size: 0.75rem;
  color: var(--accent);
  border: 1px solid var(--line-strong);
`;

export const formClass = css`
  margin-bottom: var(--gap-lg);
  padding: 1.25rem;
  background: var(--panel);
  border: 1px solid var(--panel-edge);

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
    color: var(--text);
    background: #14171c;
    border: 1px solid var(--panel-edge);
  }
`;

export const dropZoneClass = css`
  margin-bottom: var(--gap);
  padding: 1.5rem;
  text-align: center;
  color: var(--text-dim);
  border: 1px dashed var(--panel-edge);

  &[data-dragging="true"] {
    color: var(--yellow);
    border-color: var(--yellow);
  }
`;

export const errorBoxClass = css`
  margin: 0 0 var(--gap);
  padding: 0.6rem 0.75rem;
  font-size: 0.875rem;
  color: var(--accent);
  background: #1a0d10;
  border: 1px solid var(--line-strong);

  &[hidden] {
    display: none;
  }
`;

export const emptyClass = css`
  padding: 3rem 1rem;
  text-align: center;
  color: var(--text-dim);
  background: var(--panel);
  border: 1px solid var(--panel-edge);
`;

export const errorPageClass = css`
  padding: 3rem 1rem;
  text-align: center;
  color: var(--accent);
`;
```

- [ ] **Step 6: `web.tsx` を書き換える**

import から `bodyClass` を外し、`globalStyles` を足す。

```ts
import {
  globalStyles,
  containerClass,
  tableClass,
  badgeClass,
  formClass,
  dropZoneClass,
  errorBoxClass,
  emptyClass,
  errorPageClass,
} from "./webStyles.js";
```

`Layout` の `<Style />` を差し替え、`<body>` から `class` を外す。

```tsx
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Timothy</title>
          <Style>{globalStyles}</Style>
        </head>
        <body>
          <div class={containerClass}>{props.children}</div>
```

- [ ] **Step 7: テスト・ビルド・lint を実行する**

Run: `pnpm --filter @timothy/api run test && pnpm --filter @timothy/api run build && pnpm lint`

Expected: テスト 94 件すべて成功、ビルド成功、lint 0 エラー。

- [ ] **Step 8: 目視で確認する**

```bash
agent-browser open http://localhost:3000/
agent-browser screenshot /tmp/cp-task2.png
```

背景が黒くなり、文字が明るいグレーになっていること。レイアウトは Task 1 と同じであること。

- [ ] **Step 9: コミット**

```bash
git add packages/api/src/routes/webStyles.ts packages/api/src/routes/web.tsx packages/api/src/routes/web.test.ts
git commit -m "feat(api): introduce dark design tokens for web UI"
```

---

### Task 3: ヘッダー・パネル・データレール

HUD の骨格を入れる。等幅大文字のヘッダー、階段状の罫線、シアンのステータス行、L 字コーナーブラケット、画面端の装飾レール。

コーナーブラケットは **左上と右下の対角 2 箇所**とする。1 要素の疑似要素は 2 つしかないため、4 隅すべてに出すには余分なマークアップか 8 層の背景グラデーションが必要になり、割に合わない。対角 2 箇所でも参照デザインの意図は十分伝わる。

**Files:**
- Modify: `packages/api/src/routes/webStyles.ts`
- Modify: `packages/api/src/routes/web.tsx`
- Modify: `packages/api/src/routes/web.test.ts`（1 件追加）

**Interfaces:**
- Consumes: Task 2 の `globalStyles` とトークン
- Produces:
  - `webStyles.ts` に `headerClass`, `stepRuleClass`, `statusClass`, `panelClass`, `railClass` を追加
  - `web.tsx` に `function Header(props: { fileCount?: number })` と `function DataRails()` を追加

- [ ] **Step 1: 失敗するテストを書く**

`packages/api/src/routes/web.test.ts` の `describe("GET /", ...)` ブロックの末尾に追加:

```ts
  it("hides the decorative rails from assistive technology", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toContain('aria-hidden="true"');
  });
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `pnpm --filter @timothy/api run test src/routes/web.test.ts`

Expected: FAIL（新しい 1 件のみ）

- [ ] **Step 3: `webStyles.ts` にスタイルを追加する**

`webStyles.ts` の `containerClass` の直後に追加する。

```ts
export const headerClass = css`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap);
  margin: 0 0 0.25rem;
  font-family: var(--font-mono);
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--text);
`;

export const statusClass = css`
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 400;
  letter-spacing: 0.18em;
  color: var(--cyan);
  white-space: nowrap;
`;

/**
 * 左から入った罫線が途中で一段下がって右へ抜ける、HUD 風の区切り線。
 * ::before が上段の水平線、::after が縦のつなぎと下段の水平線を描く。
 */
export const stepRuleClass = css`
  position: relative;
  height: 12px;
  margin-bottom: var(--gap-lg);

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 58%;
    border-top: 1px solid var(--line-strong);
  }

  &::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    width: 42%;
    height: 100%;
    border-left: 1px solid var(--line-strong);
    border-bottom: 1px solid var(--line-strong);
  }
`;

/** 全周の枠ではなく、対角 2 箇所に L 字のブラケットを出す。 */
export const panelClass = css`
  position: relative;

  &::before,
  &::after {
    content: "";
    position: absolute;
    width: 12px;
    height: 12px;
    border-style: solid;
    border-color: var(--accent);
    pointer-events: none;
  }

  &::before {
    top: -1px;
    left: -1px;
    border-width: 1px 0 0 1px;
  }

  &::after {
    right: -1px;
    bottom: -1px;
    border-width: 0 1px 1px 0;
  }
`;

/** 画面端の装飾。内容に意味はないので aria-hidden で隠す。 */
export const railClass = css`
  position: fixed;
  top: 0;
  bottom: 0;
  width: 1.25rem;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 0.5rem;
  line-height: 1.2;
  letter-spacing: 0.05em;
  text-align: center;
  word-break: break-all;
  color: var(--line-strong);
  opacity: 0.7;
  pointer-events: none;
  user-select: none;

  &[data-side="left"] {
    left: 0;
  }

  &[data-side="right"] {
    right: 0;
  }

  @media (max-width: 70rem) {
    display: none;
  }
`;
```

- [ ] **Step 4: `web.tsx` に `Header` と `DataRails` を追加する**

import に新しいクラスを足す。

```ts
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
```

`Layout` の直前に 2 つのコンポーネントを追加する。

```tsx
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
```

- [ ] **Step 5: `Layout` にレールを差し込む**

`Layout` の `<body>` を次のように変える。

```tsx
        <body>
          <DataRails />
          <div class={containerClass}>{props.children}</div>
```

- [ ] **Step 6: ルートハンドラを書き換える**

`app.get("/")` の 2 つの `return` を次のように変える。エラー分岐にもヘッダーを出すが、件数は取れていないので渡さない。

```tsx
    return c.html(
      <Layout>
        <Header />
        <p class={errorPageClass}>一覧を取得できませんでした。時間をおいて再読み込みしてください。</p>
      </Layout>,
      500
    );
```

```tsx
  return c.html(
    <Layout withScript>
      <Header fileCount={files.length} />
      <UploadForm />
      <FileTable files={files} nowMs={Date.now()} />
    </Layout>
  );
```

既存の `<h1>Timothy</h1>` は `Header` に置き換わるので削除する。

- [ ] **Step 7: パネルのブラケットをフォームと一覧に適用する**

`web.tsx` の `UploadForm` の `<form>` と `FileTable` の `<table>`、`emptyClass` の `<p>` に `panelClass` を足す。`hono/css` は複数クラスをスペース区切りで書ける。

`UploadForm`:

```tsx
    <form id="upload-form" class={`${formClass} ${panelClass}`}>
```

`FileTable` の空状態:

```tsx
    return <p class={`${emptyClass} ${panelClass}`}>まだファイルがありません</p>;
```

`FileTable` のテーブル:

```tsx
    <table class={`${tableClass} ${panelClass}`}>
```

**注意:** `formClass` などは `Promise<string>` なので、テンプレートリテラルに埋めると `[object Promise]` になる。`hono/css` の `cx` を使うこと。import に足す。

```ts
import { Style, cx } from "hono/css";
```

そのうえで次のように書く。

```tsx
    <form id="upload-form" class={cx(formClass, panelClass)}>
```

```tsx
    return <p class={cx(emptyClass, panelClass)}>まだファイルがありません</p>;
```

```tsx
    <table class={cx(tableClass, panelClass)}>
```

- [ ] **Step 8: テスト・ビルド・lint を実行する**

Run: `pnpm --filter @timothy/api run test && pnpm --filter @timothy/api run build && pnpm lint`

Expected: テスト 95 件すべて成功、ビルド成功、lint 0 エラー。

既存テストのうち `renders the empty state`（`まだファイルがありません` を含むか）と `does not render the upload form on the error page` が特に影響を受けやすい。落ちたら `cx` の使い方かエラー分岐の構成を疑うこと。

- [ ] **Step 9: 目視で確認する**

```bash
agent-browser open http://localhost:3000/
agent-browser screenshot /tmp/cp-task3.png
```

確認する点:

1. ヘッダーが `TIMOTHY` と大文字・広いトラッキングで出ている
2. 右端にシアンで `FILES: 03` のような行が出ている
3. ヘッダー下の罫線が途中で一段下がっている
4. フォームとテーブルの左上・右下に赤い L 字が出ている
5. 画面の左右端に赤い細かい文字列の縦列が出ている（ウィンドウ幅が 70rem 未満だと消える。その場合はウィンドウを広げて確認する）

- [ ] **Step 10: コミット**

```bash
git add packages/api/src/routes/webStyles.ts packages/api/src/routes/web.tsx packages/api/src/routes/web.test.ts
git commit -m "feat(api): add HUD header, panel brackets and data rails"
```

---

### Task 4: アップロードフォームの仕上げ

ラベルを等幅大文字に、入力欄を下線のみに、送信ボタンを黄色の斜め切り落としにする。

**Files:**
- Modify: `packages/api/src/routes/webStyles.ts`
- Modify: `packages/api/src/routes/web.tsx`

**Interfaces:**
- Consumes: Task 3 までのトークンと `panelClass`
- Produces: `webStyles.ts` に `submitButtonClass` を追加

- [ ] **Step 1: `formClass` と `dropZoneClass` を書き換える**

`webStyles.ts` の `formClass` を次で置き換える。

```ts
export const formClass = css`
  margin-bottom: var(--gap-lg);
  padding: 1.5rem;
  background: var(--panel);
  border: 1px solid var(--panel-edge);

  label {
    display: block;
    margin-bottom: 1rem;
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    font-weight: 400;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--cyan);
  }

  input[type="text"],
  input[type="number"] {
    display: block;
    width: 100%;
    max-width: 24rem;
    margin-top: 0.35rem;
    padding: 0.45rem 0.1rem;
    font-family: var(--font-mono);
    font-size: 0.875rem;
    letter-spacing: 0.02em;
    color: var(--text);
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--panel-edge);
    border-radius: 0;
    transition: border-color 120ms linear;
  }

  input[type="text"]:focus,
  input[type="number"]:focus {
    outline: none;
    border-bottom-color: var(--cyan);
  }

  input[type="file"] {
    margin-top: 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-dim);
  }

  input[type="file"]::file-selector-button {
    margin-right: 0.6rem;
    padding: 0.3rem 0.7rem;
    font: inherit;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--cyan);
    background: transparent;
    border: 1px solid var(--line-strong);
    cursor: pointer;
  }
`;
```

`dropZoneClass` を次で置き換える。

```ts
export const dropZoneClass = css`
  margin-bottom: 1.5rem;
  padding: 2rem 1rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.14em;
  text-align: center;
  color: var(--text-dim);
  border: 1px dashed var(--panel-edge);
  transition:
    color 120ms linear,
    border-color 120ms linear,
    background-color 120ms linear;

  &[data-dragging="true"] {
    color: var(--yellow);
    background: #17170a;
    border-color: var(--yellow);
  }
`;
```

- [ ] **Step 2: 送信ボタンのスタイルを追加する**

`webStyles.ts` の `dropZoneClass` の直後に追加する。

```ts
export const submitButtonClass = css`
  padding: 0.55rem 1.6rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #08090b;
  background: var(--yellow);
  border: none;
  cursor: pointer;
  /* 右下の角を斜めに落として HUD のボタンらしくする */
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
  transition: opacity 120ms linear;

  &:hover:not(:disabled) {
    opacity: 0.85;
  }

  &:disabled {
    color: var(--text-dim);
    background: #2a2c31;
    cursor: default;
  }
`;
```

- [ ] **Step 3: `web.tsx` の送信ボタンにクラスを当てる**

import に `submitButtonClass` を足したうえで、`UploadForm` の送信ボタンを次のように変える。

```tsx
      <button id="submit-button" type="submit" class={submitButtonClass}>
        アップロード
      </button>
```

`id="submit-button"` と文言 `アップロード` は変えないこと。`webScript.ts` がこの ID を引き、アップロード中に `textContent` を差し替える。

- [ ] **Step 4: テスト・ビルド・lint を実行する**

Run: `pnpm --filter @timothy/api run test && pnpm --filter @timothy/api run build && pnpm lint`

Expected: テスト 95 件すべて成功、ビルド成功、lint 0 エラー。

- [ ] **Step 5: 目視で確認する**

```bash
agent-browser open http://localhost:3000/
agent-browser screenshot /tmp/cp-task4.png
```

確認する点:

1. ラベルがシアンの等幅大文字になっている
2. 入力欄が下線だけになっている
3. アップロードボタンが黄色で、右下の角が斜めに落ちている

フォーカス時にシアンになることも確認する。

```bash
agent-browser focus "#title-input"
agent-browser screenshot /tmp/cp-task4-focus.png
```

- [ ] **Step 6: コミット**

```bash
git add packages/api/src/routes/webStyles.ts packages/api/src/routes/web.tsx
git commit -m "feat(api): restyle upload form as HUD console"
```

---

### Task 5: 一覧テーブルの仕上げと空状態

行番号、hover の効果、期限切れ行の減光、ゴーストボタン、空状態の `NO FILES` を入れる。

**Files:**
- Modify: `packages/api/src/routes/webStyles.ts`
- Modify: `packages/api/src/routes/web.tsx`
- Modify: `packages/api/src/routes/web.test.ts`（1 件追加）

**Interfaces:**
- Consumes: Task 4 までのトークンと `panelClass`
- Produces: `webStyles.ts` に `rowNumberClass`, `urlClass`, `ghostButtonClass`, `dangerButtonClass`, `rowErrorClass`, `emptyTitleClass` を追加

- [ ] **Step 1: 失敗するテストを書く**

`packages/api/src/routes/web.test.ts` の `describe("GET /", ...)` ブロックの末尾に追加:

```ts
  it("numbers the rows", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry({ id: "01AAA" }),
      entry({ id: "01BBB" }),
    ]);
    const html = await (await app.request("/")).text();
    expect(html).toContain(">01<");
    expect(html).toContain(">02<");
  });
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `pnpm --filter @timothy/api run test src/routes/web.test.ts`

Expected: FAIL（新しい 1 件のみ）

- [ ] **Step 3: `tableClass` と `badgeClass` と `emptyClass` を書き換える**

`webStyles.ts` の該当 3 定数を次で置き換える。

```ts
export const tableClass = css`
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
  border: 1px solid var(--panel-edge);

  th,
  td {
    padding: 0.7rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--line);
    font-size: 0.8125rem;
    vertical-align: top;
  }

  th {
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    font-weight: 400;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--cyan);
    background: #121419;
    border-bottom-color: var(--line-strong);
  }

  tbody tr {
    position: relative;
    transition: background-color 120ms linear;
  }

  tbody tr:hover {
    background: #14090c;
  }

  tbody tr:hover td:first-child {
    box-shadow: inset 2px 0 0 var(--accent);
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr[data-expired="true"] {
    color: var(--text-dim);
  }

  tr[data-expired="true"] a {
    color: #4c7275;
  }
`;

export const badgeClass = css`
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.05rem 0.4rem;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  color: var(--accent);
  border: 1px solid var(--line-strong);
`;

export const emptyClass = css`
  padding: 4rem 1rem;
  text-align: center;
  color: var(--text-dim);
  background: var(--panel);
  border: 1px solid var(--panel-edge);
`;
```

- [ ] **Step 4: 新しいクラスを追加する**

`webStyles.ts` の末尾に追加する。

```ts
export const rowNumberClass = css`
  width: 2.5rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  color: var(--text-dim);
`;

export const urlClass = css`
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.01em;
  word-break: break-all;
`;

export const ghostButtonClass = css`
  margin-left: 0.5rem;
  padding: 0.15rem 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  color: var(--cyan);
  background: transparent;
  border: 1px solid var(--panel-edge);
  cursor: pointer;
  transition:
    color 120ms linear,
    border-color 120ms linear;

  &:hover:not(:disabled) {
    border-color: var(--cyan);
  }

  &:disabled {
    color: var(--text-dim);
    cursor: default;
  }
`;

export const dangerButtonClass = css`
  padding: 0.15rem 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  color: var(--accent);
  background: transparent;
  border: 1px solid var(--line-strong);
  cursor: pointer;
  transition:
    color 120ms linear,
    background-color 120ms linear;

  &:hover:not(:disabled) {
    color: #08090b;
    background: var(--accent);
  }

  &:disabled {
    color: var(--text-dim);
    border-color: var(--panel-edge);
    cursor: default;
  }
`;

export const rowErrorClass = css`
  display: block;
  margin-top: 0.3rem;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: var(--accent);
`;

export const emptyTitleClass = css`
  margin: 0 0 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--line-strong);
`;
```

- [ ] **Step 5: `FileTable` を書き換える**

`web.tsx` の import に `rowNumberClass`, `urlClass`, `ghostButtonClass`, `dangerButtonClass`, `rowErrorClass`, `emptyTitleClass` を足したうえで、`FileTable` 全体を次で置き換える。

```tsx
function FileTable(props: { files: FileEntry[]; nowMs: number }) {
  if (props.files.length === 0) {
    return (
      <div class={cx(emptyClass, panelClass)}>
        <p class={emptyTitleClass}>No files</p>
        <p>まだファイルがありません</p>
      </div>
    );
  }

  return (
    <table class={cx(tableClass, panelClass)}>
      <thead>
        <tr>
          <th></th>
          <th>タイトル</th>
          <th>説明</th>
          <th>共有 URL</th>
          <th>有効期限</th>
          <th>作成日時</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {props.files.map((file, index) => {
          const expired = isExpired(file.expiresAt, props.nowMs);
          return (
            <tr key={file.id} data-expired={String(expired)}>
              <td class={rowNumberClass}>{String(index + 1).padStart(2, "0")}</td>
              <td>{file.title}</td>
              <td>{file.description}</td>
              <td class={urlClass}>
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
}
```

`emptyTitleClass` のテキストは `No files` と書く。CSS の `text-transform: uppercase` で `NO FILES` として表示される。日本語の `まだファイルがありません` は既存テストが判定に使うのでそのまま残すこと。

- [ ] **Step 6: テスト・ビルド・lint を実行する**

Run: `pnpm --filter @timothy/api run test && pnpm --filter @timothy/api run build && pnpm lint`

Expected: テスト 96 件すべて成功、ビルド成功、lint 0 エラー。

既存テスト `renders the empty state` は `まだファイルがありません` を含むかを見るだけなので、`<p>` が `<div>` に変わっても通る。落ちる場合は文言を消していないか確認すること。

- [ ] **Step 7: 目視で確認する**

```bash
agent-browser open http://localhost:3000/
agent-browser screenshot /tmp/cp-task5.png
```

確認する点:

1. 行頭に `01` `02` の連番が減光した等幅で出ている
2. 見出し行がシアンの等幅大文字になっている
3. 期限切れ行が減光され、`期限切れ` チップに赤枠が付いている
4. `削除` が赤枠、`コピー` がシアン枠のゴーストボタンになっている
5. 行にカーソルを乗せると背景がわずかに赤くなり、左端に赤いバーが出る

- [ ] **Step 8: 削除が壊れていないことを確認する**

`webScript.ts` は `[data-delete-id]` と `[data-row-error]` を引いている。クラスを足しただけなので動くはずだが、実際に確認する。

```bash
curl -s http://localhost:3000/files | head -c 200
```

一覧に 1 件以上あることを確認したうえで、ブラウザで削除ボタンを押し、確認ダイアログを承認して行が消えることを見る。

- [ ] **Step 9: コミット**

```bash
git add packages/api/src/routes/webStyles.ts packages/api/src/routes/web.tsx packages/api/src/routes/web.test.ts
git commit -m "feat(api): restyle file table with row numbers and HUD controls"
```

---

### Task 6: コントラスト検証と仕上げ

配色が WCAG AA を満たすか実測し、下回っていればトークンを調整する。最後に全体のスクリーンショットを撮る。

**Files:**
- Modify: `packages/api/src/routes/webStyles.ts`（実測が基準を下回った場合のみ）

**Interfaces:**
- Consumes: Task 5 までのすべて
- Produces: なし

- [ ] **Step 1: コントラスト比を計算する**

次のスクリプトを一時ファイルに書いて実行する。リポジトリには置かないこと。

```bash
cat > /tmp/contrast.mjs <<'EOF'
// WCAG 2.1 の相対輝度とコントラスト比
function lum(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const bg = "#08090b";
const panel = "#0e1013";
const pairs = [
  ["本文 / 背景", "#d3d7de", bg],
  ["本文 / パネル", "#d3d7de", panel],
  ["減光文字 / パネル", "#7b828e", panel],
  ["シアン / パネル", "#00e5e8", panel],
  ["アクセント赤 / パネル", "#ff2e3e", panel],
  ["黄ボタンの黒文字", "#08090b", "#fcee0a"],
  ["行番号 / パネル", "#7b828e", panel],
];
for (const [name, fg, back] of pairs) {
  const r = ratio(fg, back);
  const verdict = r >= 4.5 ? "AA" : r >= 3 ? "AA Large のみ" : "不足";
  console.log(`${r.toFixed(2).padStart(6)}  ${verdict.padEnd(14)} ${name}`);
}
EOF
node /tmp/contrast.mjs
```

- [ ] **Step 2: 結果を判定する**

本文サイズ（14px 前後）で使う色は 4.5 以上が必要。基準を満たさない組み合わせがあれば、該当するトークンの明度を上げて Step 1 をやり直す。

特に注意する組み合わせ:

- `--accent: #ff2e3e` を `--panel` の上で本文として使っているのは `badgeClass`（`期限切れ`）と `dangerButtonClass`（`削除`）と `errorPageClass`。ここが 4.5 を下回るなら `--accent` を明るめに振る
- `--text-dim: #7b828e` は行番号・説明・ドロップ領域の文言に使っている

調整した場合は `webStyles.ts` の `:root` の値を書き換え、設計書の表と食い違わないよう `docs/superpowers/specs/2026-08-08-web-ui-cyberpunk-design.md` のトークン表も同じ値に直す。

- [ ] **Step 3: 一時ファイルを消す**

Run: `rm -f /tmp/contrast.mjs`

- [ ] **Step 4: テスト・ビルド・lint を実行する**

Run: `pnpm --filter @timothy/api run test && pnpm --filter @timothy/api run build && pnpm lint`

Expected: テスト 96 件すべて成功、ビルド成功、lint 0 エラー。

- [ ] **Step 5: 全体のスクリーンショットを撮る**

```bash
agent-browser open http://localhost:3000/
agent-browser screenshot /tmp/cp-final-top.png
agent-browser scroll down 500
agent-browser screenshot /tmp/cp-final-list.png
```

空状態も確認する。一覧が空になる状況を作れない場合はこの手順を飛ばし、その旨を報告すること。

- [ ] **Step 6: エラーページを確認する**

エミュレータを止めた状態で `GET /` を叩き、500 のエラーページにもヘッダーとダークテーマが効いていること、スクリプトが埋め込まれていないことを確認する。

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
curl -s http://localhost:3000/ | grep -c "addEventListener"
```

Expected: ステータス 500、`addEventListener` の出現回数 0。

- [ ] **Step 7: コミット（調整があった場合のみ）**

Step 2 でトークンを調整した場合のみコミットする。調整が不要だった場合はこのタスクにコミットは発生しない。

```bash
git add packages/api/src/routes/webStyles.ts docs/superpowers/specs/2026-08-08-web-ui-cyberpunk-design.md
git commit -m "fix(api): adjust palette to meet WCAG AA contrast"
```

---

## 完了条件

- [ ] `pnpm --filter @timothy/api run build` が成功する
- [ ] `pnpm --filter @timothy/api run test` が 96 件すべて成功する
- [ ] `pnpm lint` が 0 エラー
- [ ] 既存 23 件の `web.test.ts` を 1 件も書き換えていない
- [ ] `webScript.ts` を変更していない
- [ ] アップロード・削除・コピー・ドラッグ&ドロップがブラウザで動く
- [ ] 本文サイズで使うすべての配色が WCAG AA（4.5:1）を満たす
- [ ] 500 のエラーページにもテーマが効いており、スクリプトが埋め込まれていない
