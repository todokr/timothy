# 管理画面のページ名変更と期限切れファイルの非表示 設計

作成日: 2026-08-08

## 目的（1）ページ名を `Tim` に改める

管理画面の表示名を `Timothy` から `Tim` に変える。CLI のコマンド名が `tim` なので、
そちらに揃える。

対象は `packages/api/src/routes/web.tsx` の 3 箇所。

| 箇所 | 現在 |
|---|---|
| `<title>`（ブラウザのタブ） | `Timothy` |
| 成功時の `<h1>` | `Timothy` |
| 500 ページの `<h1>` | `Timothy` |

3 箇所とも `Tim` にする。タブだけ `Timothy` のまま残すと不揃いになるため。

リポジトリ名、npm パッケージ名（`timothy-cli`）、README の製品名は変更しない。
変えるのは管理画面の表示のみ。

## 目的（2）期限切れファイルを一覧から除く

管理画面（`GET /`）の一覧から、有効期限を過ぎたファイルを除外する。

`serve.ts` は期限切れに 410 を返すが、Firestore のドキュメントも Cloud Storage の
オブジェクトも残り続ける。既定 TTL は 7 日なので、運用するほど一覧が
「開けない行」で埋まっていく。

## スコープ

**表示の変更に限る。** レコードもオブジェクトも削除しない。定期実行の仕組みも作らない。

`GET /files` の JSON レスポンスは変更しない。CLI の `tim list` は従来どおり全件を返し、
`tim delete <id>` で期限切れを消せる状態を保つ。管理画面から見えなくなる代わりに、
CLI が期限切れを見る・消す唯一の手段として残る。

### スコープ外

- 期限切れレコードと Cloud Storage オブジェクトの自動削除
- 一覧のページネーション・件数上限
- 期限切れを表示するトグル
- `listFiles` や Firestore クエリでの絞り込み（CLI の挙動を変えないため）

## 変更内容

### 1. ルートで絞る

`packages/api/src/routes/web.tsx` の `app.get("/")` で、`listFiles` の結果を
描画前にフィルタする。

```tsx
const nowMs = Date.now();
const live = files.filter((file) => !isExpired(file.expiresAt, nowMs));
```

フィルタの責務をルート側に集約し、`FileTable` は受け取ったものをそのまま描画する
純粋な描画コンポーネントに戻す。`FileTable` の props から `nowMs` を落とす。

`isExpired(iso: string, nowMs: number): boolean` は現行のまま残す。ここで使い、
単体テストも既にある。

### 2. 期限切れの表示のためだけにあるコードを削除する

期限切れの行が描画されなくなるので、次を削除する。

| 対象 | 場所 |
|---|---|
| `data-expired` 属性 | `packages/api/src/routes/web.tsx` の `<tr>` |
| 「期限切れ」バッジの `<span>` | `packages/api/src/routes/web.tsx` |
| `badgeClass` のエクスポートと定義 | `packages/api/src/routes/webStyles.ts` |
| `tr[data-expired="true"] td:nth-child(4), td:nth-child(5)` の淡色指定 | `packages/api/src/routes/webStyles.ts` の `tableClass` |

`packages/api/src/routes/webScript.ts` は `data-expired` を参照していないため、
属性の削除でクライアント JavaScript は壊れない（確認済み）。

`webStyles.ts` のエクスポートは 16 個から 15 個になる。

### 3. 空状態の文言を状況で分ける

全ファイルが期限切れのとき、現行の実装では「まだファイルがありません」が出る。
TTL 1 日でアップロードした利用者が翌日これを見ると、データが消えたと誤解する。

取得件数で分岐する。

| 状況 | 文言 |
|---|---|
| `listFiles` が 0 件 | まだファイルがありません |
| 取得はできたが、有効期限内が 0 件 | 有効期限内のファイルがありません |

`FileTable` は空状態のときに表示する文言を props で受け取る形にし、判断はルート側に置く。
フィルタと同じ場所で決めることで、`FileTable` の責務を描画に限定したままにできる。

## 変更しないもの

- 要素 ID: `#upload-form` `#drop-zone` `#file-input` `#title-input` `#description-input`
  `#ttl-input` `#submit-button` `#form-error`
- 属性: `data-delete-id` `data-copy-url` `data-row-error` `data-dragging`
- `packages/api/src/routes/webScript.ts`
- `packages/api/src/lib/files.ts`、`packages/api/src/routes/list.ts`
- 500 時のフォールバック

## テスト

`packages/api/src/routes/web.test.ts` の 2 件を差し替える。

| 現行のテスト | 扱い |
|---|---|
| `marks expired files with a badge` | 期限切れが描画されないことの検証に置き換える |
| `does not mark live files as expired` | 有効なファイルが描画されることの検証に統合する |

追加する検証は次の 3 点。

1. 期限切れのファイルはタイトルも共有ボタンも描画されない
2. 有効なファイルと期限切れが混在するとき、有効なものだけが描画される
3. 全件が期限切れのとき「有効期限内のファイルがありません」が出て、
   「まだファイルがありません」は出ない

`listFiles` が 0 件のときに「まだファイルがありません」が出る既存のテストは残す。
`isExpired` と `formatJst` の単体テストも変更しない。

ページ名についても 1 件追加する。`<title>` と `<h1>` が `Tim` であり、
`Timothy` がページのどこにも出ないことを検証する。500 ページの `<h1>` も同様に確認する。

期限切れの判定は `Date.now()` に依存する。テストのフィクスチャは
`expiresAt` に十分過去（`2000-01-01`）と十分未来（`2099-01-01`）の値を使い、
時刻をモックしない。
