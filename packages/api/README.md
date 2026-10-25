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

> **注意:** 共有 URL (`/s/<id>`) 以外はすべて Google ログインが必要で、ブラウザはセッション、
> CLI は `Authorization: Bearer <token>`（`tim login` で発行）で認証する。ファイルの削除と
> ヘッダ設定は所有者に限る。下の認証用の必須環境変数が欠けていると API は起動時にエラーになる。
> `ALLOWED_IPS` は認証とは別の IP 制限で、共有 URL にも同じように効くため、
> 管理画面だけを保護することはできない。詳細はリポジトリルートの README を参照。

### 環境変数（ローカル）

エミュレータ使用時は `FIRESTORE_EMULATOR_HOST` が設定されていれば Firebase への認証情報は不要。

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
