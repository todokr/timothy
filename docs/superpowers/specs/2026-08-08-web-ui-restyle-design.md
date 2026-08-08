# Web UI ビジュアルリニューアル設計（サイバーパンク調 → 静かな無彩色）

作成日: 2026-08-08

## 前提

この branch には既にサイバーパンク調のリニューアルが実装されている
（`docs/superpowers/specs/2026-08-08-web-ui-cyberpunk-design.md`、コミット `58df9c8`..`0cc91b5`）。
本設計はそれを**置き換える**。前設計は履歴として残すが、以後は本設計を正とする。

## 目的

管理画面（`GET /`）を、ほぼ黒の背景に赤と黄とシアンを載せた HUD 表現から、
静かな無彩色 + アクセント 1 色のライトテーマに作り替える。毎日使う管理画面として、
装飾より一覧性を優先する。

## スコープ

配色とタイポグラフィの刷新に加え、サイバーパンクの語彙に属する装飾要素と、
それを支えるマークアップを取り除く。DOM の ID と `data-*` 属性、クライアント JavaScript、
API の挙動は変更しない。

### 取り除くもの

| 対象 | 現在の実装 | 理由 |
|---|---|---|
| 画面端のバイナリ列 | `web.tsx` の `DataRails` / `RAIL_TEXT`、`railClass` | 意味のない装飾。静かなトーンに合わない |
| 四隅の L 字ブラケット | `panelClass`、`cx()` での合成 3 箇所 | 同上 |
| 段差の罫線 | `stepRuleClass`、`Header` 内の `div` | 同上 |
| 見出し横の件数表示 | `Header` の `fileCount` prop、`statusClass` | `FILES: 03` という表記自体が HUD の語彙 |
| 行番号列 | `rowNumberClass`、`FileTable` の `index` 利用と `<th></th>` | 列を 1 つ減らして簡素にする |
| 空状態の英字見出し | `emptyTitleClass`、`<p>No files</p>` | 「まだファイルがありません」だけで足りる |
| 共有 URL の文字列表示 | `urlClass`、`<a>` の中身 | 後述のとおりボタン 2 つに置き換える |

`Header` は件数表示を失うと `<h1>Timothy</h1>` を出すだけになるため、コンポーネントを畳んで
`Layout` の呼び出し側に直接書く。`DataRails` も削除する。

### 変更しないもの

- 要素 ID: `#upload-form` `#drop-zone` `#file-input` `#title-input` `#description-input`
  `#ttl-input` `#submit-button` `#form-error`
- 属性: `data-delete-id` `data-copy-url` `data-row-error` `data-dragging` `data-expired`
- `packages/api/src/routes/webScript.ts`
- ルーティング、`listFiles` の呼び出し、500 時のフォールバック

### スコープ外

- ダークテーマ（`prefers-color-scheme`）。ライトのみとする
- レイアウトの作り替え（カード一覧化、フォームの多カラム化）
- インタラクションの追加（トースト、自前の確認ダイアログ、進捗表示）
- アイコンの導入
- 共有ページ（`GET /s/:id`）の見た目。利用者の HTML をそのまま返す経路なので対象外

## 全体方針

現在の `webStyles.ts` は既に `globalStyles` の `:root` にトークンを定義する形になっている。
この構造は維持し、トークンの中身と各クラスの参照先を差し替える。

`hono/css` の `cx()` は `panelClass` の合成にのみ使われている。合成が無くなるので
`web.tsx` から `cx` の import を外す。

## デザイントークン

`globalStyles` の `:root` を次に差し替える。`color-scheme` は `dark` から `light` にする。

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

現行の `--bg` `--panel` `--panel-edge` `--line` `--line-strong` `--cyan` `--yellow`
`--text` `--text-dim` `--gap` `--gap-lg` は廃止する。`--font-mono` も廃止する
（等幅を使う箇所が無くなるため）。`--font-ui` はフォントスタックとして残すが、
名前を `--font-sans` に改める。

## タイポグラフィ

フォントスタックは現行の `system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP",
sans-serif` を据え置く。外部フォントは読み込まない。CSP の制約があり、オフラインでも
崩れないことを優先する。

現在ラベル・テーブル見出し・ボタン・URL に使われている等幅フォントと、
`letter-spacing: 0.16em` 前後の字間拡張、`text-transform: uppercase` はすべて外す。
日本語が混ざる画面で字間を広げると読みにくいうえ、HUD の語彙そのものであるため。

日時列（有効期限・作成日時）には `font-variant-numeric: tabular-nums` を当てて桁を揃える。
CLI 側でも列揃えを修正した経緯があり（コミット `85da98d`）、そこに合わせる。

## 各パーツの指定

### ページ

`html, body` の背景を `--gray-50`、文字色を `--gray-900`、`line-height: 1.6`。
リンクの既定色は `--accent`、`text-decoration` は現行どおり hover でのみ下線。

`h1` は `font-size: 1.5rem` / `font-weight: 600` / `letter-spacing: -0.01em` /
`margin: 0 0 var(--space-5)`。現行の `0.32em` の字間と大文字化は外す。

`@media (prefers-reduced-motion: reduce)` の指定は現行のまま残す。

### カード（アップロードフォーム・テーブル）

背景 `--gray-0`、`border: 1px solid var(--gray-200)`、`border-radius: var(--radius-md)`、
`box-shadow: var(--shadow-sm)`。

### ドロップゾーン

`border: 2px dashed var(--gray-300)`、文字色 `--gray-500`。
`[data-dragging="true"]` のとき枠線と文字が `--accent`、背景が `--accent-soft`。

### 入力

`height: 2.25rem`、`padding: 0 var(--space-3)`、`border: 1px solid var(--gray-200)`、
`border-radius: var(--radius-sm)`、`font: inherit`。現行は下線だけの入力欄だが、
枠で囲む形に改める。

フォーカス時は `outline: none` にしたうえで `border-color: var(--accent)` と
`box-shadow: 0 0 0 3px var(--accent-soft)` のリングを出す。

ラベルは `--gray-700` / `font-size: 0.8125rem` / `font-weight: 500`。

`input[type="number"]` は `max-width: 8rem`、`input[type="text"]` は `max-width: 24rem`。

`input[type="file"]::file-selector-button` は ghost ボタンと同じ見た目に揃える。

### ボタン

現行の 3 つのエクスポート名を維持する。`clip-path` による角落としは外す。

| クラス | 使う場所 | 指定 |
|---|---|---|
| `submitButtonClass` | アップロード | 背景 `--accent`、文字 `#fff`、枠線なし、`height: 2.25rem`。hover で `--accent-hover`。`:disabled` は `opacity: .5` / `cursor: not-allowed` |
| `ghostButtonClass` | 開く・URL をコピー | 背景透明、`1px solid var(--gray-200)`、文字 `--gray-700`、`height: 1.75rem`。hover で背景 `--gray-100` |
| `dangerButtonClass` | 削除 | 背景透明、枠線なし、文字 `--danger`、`height: 1.75rem`。hover で背景 `--danger-soft` |

いずれも `:focus-visible` で `box-shadow: 0 0 0 3px var(--accent-soft)`。

`ghostButtonClass` は現行 `margin-left: 0.5rem` を持つが、共有列で 2 つ並べるため
外側の余白は親の `gap` で作る。この宣言は削除する。

### テーブル

列は タイトル / 説明 / 共有 / 有効期限 / 作成日時 / （削除）の 6 つ。行番号列は削除する。

見出し行（`th`）は背景色を外し、`font-size: 0.75rem` / `font-weight: 500` /
`color: var(--gray-500)` にして下罫線だけで区切る。等幅・大文字化・字間拡張は外す。

行の罫線は `--gray-100` の 1px。最終行は罫線なし。`tbody tr:hover` で背景 `--gray-25`。
現行の hover 時の左端赤ライン（`box-shadow: inset 2px 0 0`）は外す。

日時の 2 列に `font-variant-numeric: tabular-nums`。

説明の列だけ `white-space: normal` を許し、それ以外は `nowrap`。

### 共有列

列見出しは「共有 URL」から **「共有」** に改める。URL 文字列を出さなくなるため。
位置は現行どおり（行番号列を削ったので 3 列目）。削除ボタンは右端の列に残す。

セルの中身は ghost ボタン 2 つを `var(--space-2)` の間隔で横に並べる。

| 要素 | マークアップ | 挙動 |
|---|---|---|
| 開く | `<a href={file.url} target="_blank" rel="noreferrer">開く</a>` | 共有ページを別タブで開く |
| URL をコピー | `<button type="button" data-copy-url={file.url}>URL をコピー</button>` | 既存のクライアント JS がそのまま拾う |

`a` は ghost ボタンと同じ見た目に揃えるため `display: inline-flex` /
`align-items: center` / `text-decoration: none` を足す。hover でも下線を出さない。

URL 文字列を画面に出さなくなっても `href` と `data-copy-url` に残るため、
コピー機能と既存テストの URL 検証はそのまま成立する。

### 期限切れの行

現行は行全体を `--text-dim` に落とし、リンク色も別途下げている。
本設計では日時の 2 セルだけ `--gray-400` にし、タイトルと説明は通常色のまま残す。
リンクは「開く」ボタンになるため個別の色調整は不要。

バッジは `--danger-soft` 背景 / `--danger` 文字 / `border-radius: 999px` /
`font-size: 0.6875rem` / `padding: 2px var(--space-2)`。

### 空状態

`--gray-500`、`padding: var(--space-6) var(--space-4)`、中央寄せ、カードの枠内。
英字見出しは出さず「まだファイルがありません」の 1 行のみ。

### 行内エラー（`[data-row-error]`）

`rowErrorClass` は現行の `display: block` と等幅指定を外し、
`margin-left: var(--space-2)` / `font-size: 0.8125rem` / `color: var(--danger)` にする。

### エラー表示（`#form-error`）

背景 `--danger-soft`、文字 `--danger`、左端に `3px solid var(--danger)` のバー、
`border-radius: 0 var(--radius-sm) var(--radius-sm) 0`。
`[hidden]` のとき `display: none`（現行どおり）。

### 500 エラーページ

`--danger` の文字色を保ちつつ、カードの枠内に収める。

## マークアップの横スクロール対応

テーブルを `overflow-x: auto` の `div`（`tableWrapClass`）で包む。列が 6 つあるため、
狭い画面ではページ全体が横スクロールしてしまい、CSS だけでは解決できない。
カードの枠線・角丸・影はこのラッパーが持ち、`table` 自体からは外す。

## テスト

既存の `packages/api/src/routes/web.test.ts` には、削除する要素を検証しているテストが
3 件ある。実装に合わせて次のとおり扱う。

| テスト | 扱い |
|---|---|
| `declares a dark color scheme` | ライトテーマに変わるため、`color-scheme: light` を検証する内容に書き換える |
| `hides the decorative rails from assistive technology` | 装飾を削除するので、このテストも削除する |
| `numbers the rows` | 行番号列を削除するので、このテストも削除する |

加えて次の 4 件を追加する。

1. スタイルシートが出力され、アクセント色 `#2563eb` を含むこと
2. 共有列に「開く」「URL をコピー」が出て、URL 文字列が本文として出ないこと
3. 共有列の見出しが「共有」であること
4. テーブルが `overflow-x: auto` のラッパーに包まれていること

見た目そのものの検証は自動テストでは行わない。Firebase エミュレータで起動した実画面の
スクリーンショットで確認する。
