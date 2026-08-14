# Timothy

LLMが生成したHTMLをターミナルからアップロードし、有効期限付きURLで共有するセルフホスト型ツールです。

[English README](./README.md)

## 特徴

- HTMLをCLIまたはWeb画面からアップロード & 閲覧
- 有効期限付きURLで共有（デフォルト: 7日間）
- アップロード済みファイルの一覧表示・削除をCLIで操作
- セルフホスト: ストレージとアクセスを自分で管理

## 仕組み

```
tim upload report.html  →  https://your-api/s/<id>
```

URLはCloud Run / AWS Lambda上のAPIを経由して配信されます。APIがプライベートなCloud StorageからHTMLを取得してプロキシするため、ファイルに直接アクセスすることはできません。アクセスは指定したTTL経過後に無効になります。

## 必要なもの

- デプロイ済みの `@timothy/api`（[セルフホスティング](#セルフホスティング) を参照）
- そのインスタンスへのネットワーク到達性（管理者が `ALLOWED_IPS` を設定している場合、許可されたアドレスから接続する必要があります）

## CLIツールの使い方

### インストール

```bash
npm install -g timothy-cli
```

インストールせずに実行する場合:

```bash
npx timothy-cli <command>
```

### セットアップ

APIエンドポイントを保存します:

```bash
tim setup
# API endpoint [https://api.timothy.example.com]: https://your-api.example.com
```

設定は `~/.config/timothy/config.json` に保存されます。

### アップロード

```bash
# ファイルをアップロード
tim upload report.html

# タイトルと有効期限を指定
tim upload report.html --title "月次レポート" --ttl 30

# 標準入力から渡す
llm generate report | tim upload --stdin --title "生成レポート"
```

### 一覧表示

```bash
tim list
```

```
ID                          TITLE             CREATED       EXPIRES
01JWXYZ...                  月次レポート        2026-05-20    2026-05-27
01JWABC...                  分析結果            2026-05-18    2026-05-25
```

## Web UI

ブラウザでAPIエンドポイントを開くと、管理画面が表示されます:

```
https://your-api.example.com/
```

ここから、アップロード済みファイル（タイトル・説明・共有URL・有効期限・作成日時）の一覧表示、
ファイルを選択またはドラッグ＆ドロップしてのHTMLファイルのアップロード、共有URLのコピー、
ファイルの削除ができます。

Web UIのアップロードはCLIと同じ署名付きURLのフローを使うため、ストレージバケットに
CORSの設定が必要です。[セルフホスティング](#セルフホスティング) を参照してください。

### 削除

```bash
tim delete <id>
# Delete 01JWXYZ...? [y/N] y
# Deleted 01JWXYZ...

# 確認プロンプトをスキップ
tim delete <id> --force
```

## セルフホスティング

Timothyのバックエンド（`@timothy/api`）は、FirestoreとCloud StorageをバックエンドにCloud Run上で動作します。

### 前提条件

- 課金が有効なGoogle Cloudプロジェクト
- [`gcloud` CLI](https://cloud.google.com/sdk/docs/install) のインストールと認証
- [`firebase` CLI](https://firebase.google.com/docs/cli) のインストールと認証（`firebase login`）
- Dockerのインストール

### 1. 必要なGCP APIの有効化

```bash
PROJECT=your-gcp-project-id
REGION=asia-northeast1

gcloud config set project ${PROJECT}

gcloud services enable \
  firestore.googleapis.com \
  storage.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com
```

### 2. FirestoreとStorageのセットアップ

Firestoreデータベースを作成します:

```bash
gcloud firestore databases create --location=${REGION}
```

リポジトリルートからFirestoreルールとインデックスをデプロイします:

```bash
firebase use ${PROJECT}
firebase deploy --only firestore
```

これにより以下が適用されます:
- `firestore.rules` — クライアントからの直接アクセスを禁止
- `firestore.indexes.json` — `tim list` で使用する `htmlFiles` の複合インデックス（userId + createdAt）

**Cloud Storageバケットの作成:**

```bash
BUCKET=${PROJECT}-timothy
gsutil mb -l ${REGION} gs://${BUCKET}
gsutil uniformbucketlevelaccess set on gs://${BUCKET}
```

次のステップの `FIREBASE_STORAGE_BUCKET` にはここで作成したバケット名を指定してください。

### 3. サービスアカウントの作成

```bash
gcloud iam service-accounts create timothy-api \
  --display-name "Timothy API"

SA=timothy-api@${PROJECT}.iam.gserviceaccount.com

gcloud projects add-iam-policy-binding ${PROJECT} \
  --member "serviceAccount:${SA}" \
  --role "roles/datastore.user"

gcloud projects add-iam-policy-binding ${PROJECT} \
  --member "serviceAccount:${SA}" \
  --role "roles/storage.objectAdmin"

デフォルトではCloud Runの実行サービスアカウント（ADC: Application Default Credentials）で
Firebaseに認証します。
```

### 4. APIのビルドとデプロイ

リポジトリルートからDockerイメージをビルド・プッシュします:

```bash
IMAGE=${REGION}-docker.pkg.dev/${PROJECT}/timothy/api:latest

docker build -f packages/api/Dockerfile -t ${IMAGE} .
docker push ${IMAGE}
```

Cloud Runにデプロイします（手順3で作成したサービスアカウントで実行、ADC方式）:

```bash
gcloud run deploy timothy-api \
  --image ${IMAGE} \
  --region ${REGION} \
  --min-instances 0 \
  --max-instances 2 \
  --service-account ${SA} \
  --set-env-vars FIREBASE_PROJECT_ID=${PROJECT} \
  --set-env-vars FIREBASE_STORAGE_BUCKET=${PROJECT}-timothy \
  --allow-unauthenticated
```

デプロイ後に表示されるサービスURLをメモしてください。


### 5. （オプション）IPアドレス制限の設定

APIへのアクセスを制限する場合、Cloud Runの `ALLOWED_IPS` 環境変数にカンマ区切りでIPまたはCIDRを設定します:

```bash
gcloud run services update timothy-api \
  --region ${REGION} \
  --set-env-vars ALLOWED_IPS="203.0.113.0/24,198.51.100.42"
```

`ALLOWED_IPS` はWeb UI（`/`）、管理系エンドポイント（`/upload`、`/files`、`/files/<id>`）、
共有エンドポイント（`/s/*`）に適用されます。**未設定の場合はすべてのリクエストが許可され、
URLを知っている人は誰でもファイルの一覧取得・アップロード・削除ができます。** 設定すると
CLIからのアクセスも、共有URLを開く相手も、このIPアドレスに制限される点に注意してください。

※ クライアントIPは `X-Forwarded-For` の**末尾から** `XFF_TRUSTED_HOPS` 個目のエントリから
判定します。前段のプロキシは自分が実際に観測した接続元アドレスを末尾に追記していくため、
信頼できるのは自分で用意したプロキシが追記した範囲だけで、それより前のエントリは
攻撃者が自由に詐称できる点に注意してください。

| 環境変数 | 既定値 | 意味 |
|---|---|---|
| `ALLOWED_IPS` | 未設定（全リクエスト許可） | `/`、`/upload`、`/files`、`/files/<id>`、`/s/*` へのアクセスを許可するIP・CIDRのカンマ区切り |
| `XFF_TRUSTED_HOPS` | `1` | サービスの前段で `X-Forwarded-For` に追記するプロキシの段数。末尾からこの数だけ遡ったエントリをクライアントIPとして採用する |

既定値の `1` は、`*.run.app` の素のCloud Runサービス（およびLambda Function URL）のように
1エントリだけが追記される構成に対応します。Google Cloud Load Balancer や Cloud Armor を
前段に置く場合は2エントリ追記されるため、`XFF_TRUSTED_HOPS=2` を設定してください:

```bash
gcloud run services update timothy-api \
  --region ${REGION} \
  --set-env-vars XFF_TRUSTED_HOPS=2
```

### 6. CLIの設定

ユーザーはCloud RunサービスのURLを使ってCLIを設定します:

```bash
tim setup
# API endpoint [https://api.timothy.example.com]: https://timothy-api-xxxx-an.a.run.app
```

### バケットのCORS設定

Web UIはブラウザから署名付きURLを使って直接Cloud Storageにアップロードします。
バケットにCORSを設定していないと、このアップロードは失敗します（CLIは影響を受けません）。

`cors.json` を作成し、オリジンをご自身のAPIエンドポイントに置き換えてください:

```json
[
  {
    "origin": ["https://your-api.example.com"],
    "method": ["PUT"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
```

適用します:

```bash
gcloud storage buckets update gs://YOUR_BUCKET --cors-file=cors.json
```

## AWSでのセルフホスティング（Lambda）

APIはAWS Lambda上でも動作します。Firebaseバックエンド（Firestore + Cloud Storage）はそのまま使用し、コンピュート層のみをAWSに置き換えます。Cloud Run版との**コードの差異はありません**。

## ライセンス

EPL-2.0
