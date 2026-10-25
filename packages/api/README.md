# @timothy/api

HTMLファイルのアップロード・配信を行うAPIサーバー。Hono で書かれており、Cloud Run と AWS Lambda（`lambda.ts`）で動作する。

## ローカル開発

Firebase エミュレータを起動してから開発サーバーを立ち上げる。

```bash
# Firebase エミュレータ起動（Firestore + Storage）
firebase emulators:start --only firestore,storage

# 別ターミナルで開発サーバー起動
pnpm dev
```

> **注意:** `/health` とログイン用の `/auth/*` を除き、共有 URL (`/s/<id>`) を含むすべてで Google ログインが必要で、ブラウザはセッション、
> CLI は `Authorization: Bearer <token>`（`tim login` で発行）で認証する。ファイルの削除と
> ヘッダ設定は所有者に限る。下の認証用の必須環境変数が欠けていると API は起動時にエラーになる。
> `ALLOWED_IPS` は認証とは別の IP 制限で、共有 URL にも同じように効くため、
> 管理画面だけを保護することはできない。詳細はリポジトリルートの README を参照。
>
> 共有 URL は 2 つに分かれる。`/s/<id>`（`?v=<版>` で版を指定）は版セレクタ付きの外枠ページ、
> `/s/<id>/v/<n>` は HTML 本体で、外枠の iframe が読み込む。同じ URL に修正版を上げる API は
> `POST /files/:id/versions`（アップロード用 URL の発行）と `POST /files/:id/versions/:uploadId/commit`（確定）。
> 外枠の iframe は `sandbox` 付き（`allow-same-origin` なし）で、本体の中のブリッジ（配信時に差し込む
> スクリプト）と親画面は `postMessage` だけでやり取りする。コメントの保存は親画面だけが行う。

### 環境変数（ローカル）

エミュレータ使用時は `FIRESTORE_EMULATOR_HOST` が設定されていれば、Firestore の読み書きに Firebase の認証情報は要らない。

```env
FIRESTORE_EMULATOR_HOST=localhost:8080
FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199
FIREBASE_PROJECT_ID=demo-test
FIREBASE_STORAGE_BUCKET=demo-test.example.com
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
SESSION_SECRET=...
ALLOWED_EMAIL_DOMAINS=example.com
```

OAuth クライアントは開発用のものを作り、承認済みリダイレクト URI に
`http://localhost:3000/auth/callback`（`PORT` に合わせる）を登録する。

> **アップロードはエミュレータでは最後まで通らない。** `POST /upload` は HTML 本体の書き込み先として
> 署名付き URL を発行するが、エミュレータ構成では署名に使う鍵が無いため 500 になる
> （`Cannot sign data without client_email`）。`GOOGLE_APPLICATION_CREDENTIALS` にサービスアカウントの
> 鍵（ダミーで可）を指定すれば URL は発行されるが、Storage エミュレータが署名付き URL への PUT に
> 対応していないため、CLI の `tim upload` は `Storage upload failed 501` で失敗する
> （Firestore のメタデータだけが残る）。手元で表示まで確かめたいときは、
> 本体をエミュレータの REST API で直接書き込む:
>
> ```bash
> curl -X POST -H "Content-Type: text/html; charset=utf-8" --data-binary @page.html \
>   "http://localhost:9199/upload/storage/v1/b/demo-test.example.com/o?uploadType=media&name=timothy-files%2F<id>.html"
> ```

---

## コメント API

共有ページのコメントの API。すべて `/files/:id/comments` 配下で、ログイン済み（セッションまたは CLI トークン）なら
所有者でなくても使える。親ファイルが無ければ `404`、期限切れなら `410`。JSON を送るエンドポイントは
`Content-Type: application/json` が必須（違えば `415`）。

| メソッド・パス | 内容 |
|---|---|
| `GET /files/:id/comments` | コメントを作成日時の昇順で返す（`{ comments: [...] }`、解決済みを含む） |
| `POST /files/:id/comments` | コメントを作る。body は `{ version, anchor, body }`。`version` は 1 以上最新版以下の整数。`body` は前後の空白を除いて 1〜10000 文字。成功は `201` と `{ comment }` |
| `POST /files/:id/comments/:commentId/replies` | 返信を付ける。body は `{ body }`。成功は `201` と更新後の `{ comment }`。コメントが無ければ `404` |
| `POST /files/:id/comments/:commentId/resolve` | 解決・取り消し。body は `{ resolved: boolean }`。成功は `200` と `{ comment }` |

body に余計なフィールドがある・形が不正なときは `400`。

**CLI トークンの制限:** `Authorization: Bearer` で認証した CLI トークンからは、新規コメントと解決はできず
`403`（`Comments can only be created from the browser` / `Comments can only be resolved from the browser`）になる。
返信だけは許され、`viaAgent: true` の「agent 経由」の返信として記録される（画面では「（agent 経由）」と表示）。

---

## ファイル情報・本文 API

ファイルの情報と保存された本文を JSON で返す API。`tim mcp` が使う。ログイン済み（セッションまたは CLI トークン）なら
所有者でなくても使える。親ファイルが無ければ `404`、期限切れなら `410`（期限切れの判定は版の検証より先）。

| メソッド・パス | 内容 |
|---|---|
| `GET /files/:id` | ファイルの情報を返す。`id`・`title`・`description`・`url`（共有 URL）・`owner`（`{ email, name }`、所有者がいなければ `null`）・`expiresAt`（無期限なら `null`）・`latestVersion`・`versions`（`[{ version, createdAt, uploadedBy }]`） |
| `GET /files/:id/content` | 保存された HTML を `{ id, version, html }` で返す。`?v=<版>` で版を指定し、省くと最新版。存在しない版・不正な `v` は `404`。`Cache-Control: no-store` |

`/files/:id/content` の `html` は Cloud Storage に保存されたままの本文で、配信時に差し込まれるブリッジは含まない
（`/s/:id/v/:n` が返す HTML とは異なる）。

---

## Cloud Run デプロイ

### 前提条件

- Google Cloud SDK (`gcloud`) インストール済み
- Artifact Registry リポジトリ作成済み
- Cloud Run サービスアカウントに Firestore / Cloud Storage へのアクセス権限付与済み

### 認証方式

デフォルトでは Cloud Run の実行サービスアカウント（ADC: Application Default Credentials）で
Firebase Admin SDK を初期化する。`FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` を
デプロイ時に設定しなければ、Workload Identity 等で紐づいたサービスアカウントの権限がそのまま使われる。
サービスアカウントキー（JSON）を明示的に使いたい場合のみ、この2つの環境変数を設定する
（値は Secret Manager 等で秘匿すること）。

### イメージビルド & プッシュ

```bash
PROJECT=your-gcp-project-id
REGION=asia-northeast1
IMAGE=${REGION}-docker.pkg.dev/${PROJECT}/timothy/api:latest

docker build -f packages/api/Dockerfile -t ${IMAGE} .
docker push ${IMAGE}
```

### デプロイ

```bash
gcloud run deploy timothy-api \
  --image ${IMAGE} \
  --region ${REGION} \
  --min-instances 0 \
  --max-instances 2 \
  --service-account your-runtime-sa@${PROJECT}.iam.gserviceaccount.com \
  --set-env-vars FIREBASE_PROJECT_ID=${PROJECT} \
  --set-env-vars FIREBASE_STORAGE_BUCKET=your-bucket-name.appspot.com \
  --no-allow-unauthenticated
```

サービスアカウントキーを明示的に使う場合は、上記に加えて
`--set-secrets FIREBASE_CLIENT_EMAIL=...`・`--set-secrets FIREBASE_PRIVATE_KEY=...` を指定する。

---

## 環境変数リファレンス

| 変数名 | 説明 | 本番での管理方法 |
|---|---|---|
| `FIREBASE_PROJECT_ID` | GCP プロジェクト ID | 環境変数（非シークレット） |
| `FIREBASE_CLIENT_EMAIL` | （任意）サービスアカウントキーで明示認証する場合のみ設定 | Secret Manager |
| `FIREBASE_PRIVATE_KEY` | （任意）サービスアカウントキーで明示認証する場合のみ設定（`\n` を含む） | Secret Manager |
| `FIREBASE_STORAGE_BUCKET` | Cloud Storage バケット名 | 環境変数（非シークレット） |
| `FIRESTORE_DATABASE_ID` | （任意）`(default)` 以外の名前付きFirestoreデータベースを使う場合のみ設定 | 環境変数（非シークレット） |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth クライアント ID（必須） | 環境変数（非シークレット） |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth クライアントシークレット（必須） | Secret Manager |
| `SESSION_SECRET` | セッション署名用のランダム文字列（必須） | Secret Manager |
| `ALLOWED_EMAIL_DOMAINS` | ログインを許可するメールドメイン、カンマ区切り（必須） | 環境変数（非シークレット） |
| `PUBLIC_BASE_URL` | （任意）API の公開 URL。コールバック URL の基準を固定する。承認済みリダイレクト URI は `<公開 URL>/auth/callback` | 環境変数（非シークレット） |
| `PORT` | サーバーのリッスンポート（デフォルト: 3000） | Cloud Run が 8080 を自動注入 |

---

## インフラ要件

| 項目 | 設定値 |
|---|---|
| 最小インスタンス数 | 0（コスト抑制） |
| 最大インスタンス数 | 2 |
| Cloud Storage | パブリックアクセス禁止、署名付きURL経由のみ配信 |
| Firestore | Admin SDK 経由のみ書き込み可 |

---

## ローカルで Docker イメージを確認する

```bash
# ビルド（リポジトリルートから実行）
docker build -f packages/api/Dockerfile -t timothy-api .

# 起動（.env にFirebase認証情報を記載）
docker run -p 8080:8080 --env-file .env timothy-api
```
