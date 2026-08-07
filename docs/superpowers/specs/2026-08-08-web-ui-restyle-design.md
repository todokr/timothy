# Web UI ビジュアルリニューアル設計

作成日: 2026-08-08

## 目的

Timothy の管理画面（`GET /`）の見た目を刷新する。現状はブラウザ既定のスタイルに近い
プレーンなテーブルとフォームで、`h1` が過大、罫線と影が強い、数字の桁が揃わないなど、
管理画面として雑然としている。

トーンは「静かな無彩色 + アクセント 1 色」。ライトテーマのみ。

## スコープ

**見た目の変更に限る。** マークアップの構造、DOM の ID、クライアント JavaScript、
API の挙動は変更しない。例外は「テーブルの横スクロール用ラッパー」1 箇所のみ（後述）。

レイアウトの作り替え（カード一覧化、フォームの多カラム化、ヘッダー追加）や、
インタラクションの追加（トースト、自前の確認ダイアログ、進捗表示）は行わない。

## 全体方針

デザイントークンを CSS 変数として 1 箇所に定義し、各スタイルはそれを参照する。
色や余白を後から調整するとき 1 箇所だけを触れば済むようにする。

変数は `bodyClass` のブロック内で宣言する。`hono/css` はクラス名を生成する仕組みなので
`:root` を直接扱えないが、`body` の子孫すべてが CSS 変数を継承するため、これで足りる。

トークンを持たずに各 `css` ブロックへ直接値を書く案も検討したが、同じグレーが 7 箇所に
散らばり、調整のたびに探し回ることになるため採らない。Tailwind 等の導入は
「バンドラを持ち込まない」という既存方針に反するため採らない。

## ファイル構成

```
packages/api/src/routes/
├── web.tsx        # マークアップに専念（スタイル定数を webStyles.ts へ移す）
└── webStyles.ts   # 新規: hono/css のクラス定数とデザイントークン
```

`web.tsx` は現在 280 行あり、スタイルを充実させると 300 行を超える。当初の設計で
「300 行を超えたら分割する」と決めていたため、ここで切り出す。

`webStyles.ts` は `hono/css` の `css` テンプレートで生成したクラス名を名前付きエクスポート
する。エクスポート名は現行のまま（`bodyClass`, `containerClass`, `formClass`,
`dropZoneClass`, `errorBoxClass`, `tableClass`, `badgeClass`, `emptyClass`,
`errorPageClass`）とし、ボタン用に 3 つ（`primaryButtonClass`, `ghostButtonClass`,
`dangerButtonClass`）と、テーブルのラッパー用に `tableWrapClass` を追加する。

## デザイントークン

| 変数 | 値 | 用途 |
|---|---|---|
| `--gray-0` | `#ffffff` | カードの面 |
| `--gray-25` | `#fcfcfd` | 行の hover |
| `--gray-50` | `#f8f9fa` | ページ背景 |
| `--gray-100` | `#f1f3f5` | 内側の罫線 |
| `--gray-200` | `#e9ecef` | カードの枠線・ghost ボタンの枠線 |
| `--gray-300` | `#dee2e6` | ドロップゾーンの破線 |
| `--gray-400` | `#adb5bd` | プレースホルダ・期限切れの日時 |
| `--gray-500` | `#868e96` | 補助テキスト・テーブル見出し |
| `--gray-700` | `#495057` | フォームのラベル |
| `--gray-900` | `#212529` | 本文 |
| `--accent` | `#2563eb` | primary ボタン・リンク・フォーカス |
| `--accent-hover` | `#1d4ed8` | primary ボタンの hover |
| `--accent-soft` | `#eff4ff` | フォーカスリング・ドラッグ中の背景 |
| `--danger` | `#e03131` | 削除ボタン・エラー文字 |
| `--danger-soft` | `#fff5f5` | エラー背景・削除ボタンの hover |
| `--radius-sm` | `6px` | ボタン・入力 |
| `--radius-md` | `10px` | カード |
| `--shadow-sm` | `0 1px 2px rgba(16, 24, 40, 0.05)` | カード |
| `--space-1` 〜 `--space-6` | `4px` `8px` `12px` `16px` `24px` `32px` | 余白 |

## タイポグラフィ

フォントスタックは現行の `system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP",
sans-serif` を据え置く。外部フォントは読み込まない。CSP の制約があり、オフラインでも
崩れないことを優先する。

日時列（有効期限・作成日時）に `font-variant-numeric: tabular-nums` を当てて桁を揃える。
CLI 側でも列揃えを修正した経緯があり（コミット `85da98d`）、そこに合わせる。

共有 URL のセルは `ui-monospace, SFMono-Regular, Menlo, monospace` にする。

## 各パーツの指定

### ページ

背景 `--gray-50`、本文色 `--gray-900`、`line-height: 1.6`。

`h1` はブラウザ既定のままだと過大なので、`font-size: 1.5rem` / `font-weight: 600` /
`letter-spacing: -0.01em` / `margin: 0 0 var(--space-5)` にする。

### カード（アップロードフォーム・テーブル）

背景 `--gray-0`、`border: 1px solid var(--gray-200)`、`border-radius: var(--radius-md)`、
`box-shadow: var(--shadow-sm)`。影は現状より弱くし、枠線で面を分ける。

### ドロップゾーン

`border: 2px dashed var(--gray-300)`、文字色 `--gray-500`。
`[data-dragging="true"]` のとき枠線と文字が `--accent`、背景が `--accent-soft`。
遷移は `transition: border-color .15s, background-color .15s, color .15s`。

### 入力

`height: 2.25rem`、`padding: 0 var(--space-3)`、`border: 1px solid var(--gray-200)`、
`border-radius: var(--radius-sm)`、`font: inherit`。
プレースホルダは `--gray-400`。

フォーカス時は `outline: none` にしたうえで
`border-color: var(--accent)` と `box-shadow: 0 0 0 3px var(--accent-soft)` のリングを出す。

ラベルは `--gray-700` / `font-size: 0.8125rem` / `font-weight: 500`。

`#ttl-input` だけ `max-width: 8rem` に絞る。他のテキスト入力は `max-width: 24rem`。

### ボタン

3 種に整理する。共通で `height: 2.25rem`（テーブル内は `1.75rem`）、
`border-radius: var(--radius-sm)`、`font: inherit`、`cursor: pointer`、
`transition: background-color .15s, border-color .15s`。

| 種類 | 使う場所 | 指定 |
|---|---|---|
| primary | アップロード | 背景 `--accent`、文字 `#fff`、枠線なし。hover で `--accent-hover`。`:disabled` は `opacity: .5` / `cursor: not-allowed` |
| ghost | コピー | 背景透明、`1px solid var(--gray-200)`、文字 `--gray-700`。hover で背景 `--gray-100` |
| danger | 削除 | 背景透明、枠線なし、文字 `--danger`。hover で背景 `--danger-soft` |

いずれも `:focus-visible` で `box-shadow: 0 0 0 3px var(--accent-soft)`。

### テーブル

見出し行（`th`）は背景色を外し、`font-size: 0.75rem` / `font-weight: 500` /
`color: var(--gray-500)` にして、下罫線だけで区切る。

行の罫線は `--gray-100` の 1px。最終行は罫線なし。
`tbody tr:hover` で背景 `--gray-25`。

共有 URL のセルは等幅フォント、`max-width: 22rem`、`overflow: hidden`、
`text-overflow: ellipsis`、`white-space: nowrap`。コピーボタンは常時表示のまま。

### 期限切れの行

現状は行全体を `--gray-400` 相当に落としているが、タイトルは読める必要がある。
日時のセルだけ `--gray-400` にし、タイトルと説明は通常色のままにする。
バッジは下記のとおり danger 系の配色で、淡色化の対象に含めない。

バッジは `--danger-soft` 背景 / `--danger` 文字 / `border-radius: 999px` /
`font-size: 0.6875rem` / `padding: 2px 8px`。

### 空状態

`--gray-500`、`padding: var(--space-6) var(--space-4)`、中央寄せ。

### エラー表示（`#form-error`）

背景 `--danger-soft`、文字 `--danger`、左端に `3px solid var(--danger)` のバー、
`border-radius: 0 var(--radius-sm) var(--radius-sm) 0`。
`[hidden]` のとき `display: none`（現行どおり）。

### 500 エラーページ

`--danger` の見出しと `--gray-500` の説明に整える。カード内に収める。

## マークアップの例外

テーブルを `overflow-x: auto` の `div`（`tableWrapClass`）で包む。列が 6 つあるため、
狭い画面ではページ全体が横スクロールしてしまい、CSS だけでは解決できない。
カードの枠線と角丸はこのラッパーが持ち、`table` 自体からは外す。

既存テストは要素の ID とテキストを検証しており、この変更の影響を受けない。

## テスト

既存の 23 テストはクラス名に依存していないため、そのまま通ることを確認する。

加えて 1 件だけ追加する。スタイルの切り出しが壊れていないことを検出するため、
`GET /` のレスポンスに `<style id="hono-css">` が含まれ、その中にアクセント色
`#2563eb` が現れることを検証する。`webStyles.ts` の import が抜けたり、
`<Style />` が消えたりすると失敗する。

見た目そのものの検証は自動テストでは行わない。Firebase エミュレータで起動した実画面の
スクリーンショットで確認する。

## スコープ外

- ダークテーマ（`prefers-color-scheme`）
- レイアウトの作り替え（カード一覧化、フォームの多カラム化、ヘッダーやナビゲーションの追加）
- インタラクションの追加（トースト、自前の確認ダイアログ、アップロード進捗）
- アイコンの導入
- 共有ページ（`GET /s/:id`）の見た目 — ユーザーがアップロードした HTML をそのまま返す経路なので対象外
