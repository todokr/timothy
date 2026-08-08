# Web UI（ファイル一覧 & アップロード）設計

作成日: 2026-08-07

## 目的

Timothy の API に、ブラウザから使える管理画面を追加する。CLI をインストールしていない環境や、
手元の HTML をさっと共有したい場面で、ファイルの一覧・アップロード・削除を Web から行えるようにする。

## 全体方針

`hono/jsx` によるサーバーサイドレンダリング + 最小のインライン JavaScript で実装する。
一覧はサーバーで描画し、アップロードと削除だけ既存の JSON API を `fetch` で叩く。

`packages/api/tsconfig.json` にはすでに `jsx: react-jsx` / `jsxImportSource: hono/jsx` が
設定済みのため、ビルドパイプラインや npm 依存の追加は発生しない。

React + Vite の SPA を別パッケージに切る案も検討したが、機能が一覧・アップロード・削除の 3 つで
あることに対してビルドと配信の手順が増えすぎるため採らない。

## ファイル構成

```
packages/api/src/
├── index.ts              # app.route("/", webRoute) を追加、IP allowlist の適用範囲を拡大
├── lib/
│   └── files.ts          # 新規: Firestore → 一覧 DTO の組み立てを共通化
└── routes/
    ├── web.tsx           # 新規（作業中の web-upload.tsx をリネーム）: 管理画面の SSR
    ├── list.ts           # lib/files.ts を使うよう修正
    ├── upload.ts         # 変更なし
    └── delete.ts         # 変更なし
```

### `lib/files.ts`

現在 `routes/list.ts` と作業中の `routes/web-upload.tsx` に同じ整形処理が重複している。
これを 1 箇所に集約する。

```ts
export type FileEntry = {
  id: string;
  title: string;
  description: string;
  url: string;
  expiresAt: string;  // ISO 8601
  createdAt: string;  // ISO 8601
};

export function resolveBaseUrl(c: Context): string;
export function listFiles(baseUrl: string): Promise<FileEntry[]>;
```

`listFiles` は Hono の `Context` ではなく `baseUrl` 文字列を受け取る。ヘッダー解決の責務を
`resolveBaseUrl` に分離することで、それぞれを独立にテストできる。

`resolveBaseUrl` は既存実装と同じく `x-forwarded-proto`（既定 `http`）と `host`（既定 `localhost`）
から組み立てる。

### `routes/web.tsx`

`Layout`（HTML の外枠と `hono/css` によるスタイル）、`UploadForm`、`FileTable` の 3 コンポーネントで
構成する。1 ファイルに収めるが、300 行を超えるようなら `routes/web/` ディレクトリに分割する。

ファイル名は機能実態（一覧 + アップロード）に合わせて `web-upload.tsx` から `web.tsx` に改める。

## アクセス制御

Web UI は `ipAllowlistMiddleware` で保護する。あわせて、これまで allowlist の対象外だった
`/upload` と `/files` にも適用範囲を広げる。管理画面から叩ける API が無防備なままでは
画面だけ守っても意味がないため。

```ts
app.use("*", accessLogMiddleware);
app.use("/", ipAllowlistMiddleware);        // 管理画面
app.use("/upload", ipAllowlistMiddleware);  // 追加
app.use("/files/*", ipAllowlistMiddleware); // 追加
app.use("/s/*", ipAllowlistMiddleware);     // 既存
```

`ALLOWED_IPS` が未設定なら全リクエストを通すという既存の挙動は維持する。したがってローカル開発と
`ALLOWED_IPS` 未設定のデプロイでは動作が変わらない。

**CLI への影響**: `ALLOWED_IPS` を設定している環境では、CLI の `upload` / `list` / `delete` も
allowlist 内の IP からしか実行できなくなる。これは意図した引き締めである。README の
セルフホスティング手順にこの点を明記する。

## マウントパス

`app.route("/", webRoute)` としてルートに置く。現在ルートパスは未使用のため衝突しない。
デプロイ先の URL をそのまま開けば管理画面が表示される。

## アップロードのデータフロー

CLI の `upload` コマンドと同一の経路を使う。サーバー側に新規エンドポイントは追加しない。

```
ブラウザ                          API                     GCS
  │ ① ファイル選択 / ドラッグ&ドロップ
  │ ② POST /upload {title, description, ttlDays}
  │──────────────────────────────>│
  │                               │ Firestore に doc 作成
  │                               │ 署名付き URL 発行（有効期限 15 分）
  │ <──────────────────────────────│ {id, uploadUrl, uploadHeaders, url, expiresAt}
  │ ③ PUT uploadUrl
  │    body: HTML 文字列
  │    Content-Type: text/html; charset=utf-8
  │──────────────────────────────────────────────────────>│
  │ ④ 成功したらページをリロードして一覧を更新
```

サーバー経由でファイル本文を送る方式は採らない。Cloud Armor の WAF が HTML 本文を
ブロックする問題があり、それを回避するために署名付き URL 方式へ移行した経緯があるため
（コミット `870b5cc`）。

### 前提条件: GCS バケットの CORS 設定

手順 ③ はブラウザから GCS への別オリジンリクエストになるため、バケットに CORS 設定が必要になる。
これが無いと Web からのアップロードだけが失敗する（CLI は影響を受けない）。

許可すべき内容:

- `method`: `PUT`
- `responseHeader`: `Content-Type`
- `origin`: 管理画面のオリジン

設定用の `cors.json` と `gcloud storage buckets update --cors-file` コマンドを README の
セルフホスティング手順に追記する。

## 削除のフロー

一覧の各行の削除ボタンから `DELETE /files/:id` を呼ぶ。実行前に `confirm()` で確認する。
成功したらページをリロードする。

## 一覧の表示仕様

- 並び順は `createdAt` 降順（既存の `list.ts` と同じ）
- 列: タイトル / 説明 / 共有 URL / 有効期限 / 作成日時 / 削除ボタン
- 日時は `Asia/Tokyo` の `YYYY-MM-DD HH:mm` 形式で表示
- 期限切れのファイルも一覧に表示し、「期限切れ」バッジを付けて淡色で描画する。
  `/s/:id` は期限切れなら 410 を返すがレコード自体は残るため、一覧から見えないと削除できなくなる
- 0 件のときは「まだファイルがありません」という空状態を表示する
- 共有 URL はリンク（`target="_blank"`）とコピーボタンの両方を置く

## アップロードフォームの仕様

- 入力項目: ファイル（必須）、タイトル（必須）、説明（任意）、TTL 日数（既定 7）
- ドラッグ&ドロップに対応する。ドロップ領域にファイルを落とすとファイル入力にセットされ、
  タイトルが空ならファイル名（拡張子を除く）で埋める
- `accept=".html,.htm"` を設定し、送信前の JS 検証でも拡張子を確認する

`POST /upload` の既存バリデーション（`parseUploadRequest`）は `title` / `description` / `ttlDays` の
3 つをすべて必須フィールドとして扱う。`description` は空文字を許容するため、説明が未入力のときは
空文字列を送る。`ttlDays` は正の整数のみ受け付けるので、入力欄は `type="number" min="1" step="1"` とし、
送信時に `Number()` で数値へ変換する。

## エラー処理

### クライアント側

| 事象 | 挙動 |
|---|---|
| ファイル未選択で送信 | `required` 属性でブラウザが弾く |
| HTML 以外のファイル | 送信前に警告して中断する |
| `POST /upload` が 4xx/5xx | レスポンスの `error` フィールドをフォーム上部のエラー領域に表示。入力内容は保持する |
| GCS への `PUT` が失敗 | 「アップロードに失敗しました」と表示。Firestore にレコードだけが残ることと、一覧から削除できることを併記する |
| 削除が失敗 | 該当行の近くにエラーを表示し、一覧はリロードしない |

GCS への PUT が失敗するとレコードだけが残る問題は既存の CLI にも同じ構造で存在する。
今回は掃除の仕組みまでは作らず、ユーザーに見える形で伝えるに留める。

### サーバー側

`web.tsx` の一覧取得で Firestore がエラーを返した場合は、HTTP 500 と
「一覧を取得できませんでした」という HTML を返す。JSON エラーをそのまま返すと画面が壊れるため。

## テスト方針

既存の 2 層構成（純粋関数の単体テスト + Firestore エミュレータによる結合テスト）に合わせる。

- `lib/files.test.ts` — `resolveBaseUrl()` のヘッダー解決（`x-forwarded-proto` の有無）と、
  Firestore ドキュメントから `FileEntry` への変換を検証する
- `routes/web.test.ts` — `app.request("/")` のレスポンス HTML に想定の要素
  （アップロードフォーム、ファイル行、空状態、期限切れバッジ）が含まれるかを検証する。
  Firestore は `vi.mock` でスタブする
- インライン JavaScript のロジックはテストしない。ブラウザ環境が必要で費用対効果が合わないため、
  手動確認とする

## ドキュメント更新

- `README.md` / `README.ja.md` に Web UI の節を追加する
- セルフホスティング手順に GCS バケットの CORS 設定を追記する
- `ALLOWED_IPS` の適用範囲が `/upload` と `/files` に広がったことを追記する

## スコープ外

- 一覧のページネーション（件数が問題になってから検討する）
- ファイル内容のプレビューと編集
- HTML 以外のファイル形式への対応
- GCS への PUT 失敗で残ったレコードの自動掃除
