<img width="1258" height="926" alt="image" src="https://github.com/user-attachments/assets/9c665922-1eaf-4642-80a2-ddade3b8b689" />

# Timothy

LLMが生成したHTMLをターミナルからアップロードし、有効期限付きURLで共有するセルフホスト型CLIツールです。URLを知っている人だけが閲覧でき、閲覧者のログインは不要です。

[English README](./README.md)

## 特徴

- HTMLをファイルまたは標準入力からアップロード
- 有効期限付きURLで共有（デフォルト: 7日間）
- アップロード済みファイルの一覧表示・削除をCLIで操作
- セルフホスト: ストレージとアクセスを自分で管理

## 仕組み

```
tim upload report.html  →  https://your-api/s/<id>
```

URLはCloud Run上のAPIを経由して配信されます。APIがプライベートなCloud StorageからHTMLを取得してプロキシするため、ファイルに直接アクセスすることはできません。アクセスは指定したTTL経過後に無効になります。

## 必要なもの

- デプロイ済みの `@timothy/api`（[セルフホスティング](#セルフホスティング) を参照）
- サーバー管理者から発行されたAPIキー

## インストール

```bash
npm install -g timothy-cli
```

インストールせずに実行する場合:

```bash
npx timothy-cli <command>
```

## 使い方

### セットアップ

APIキーとエンドポイントを保存します:

```bash
tim setup
# API key: xxxxxxxxxxxxxxxxxxxx
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
Firebaseに認証します。この方式ではキーファイルは不要です。ローカルでのエミュレータ外テストや
GCP以外へのホスティングなど、明示的にエクスポートしたキーが必要な場合のみ、下記の
`gcloud iam service-accounts keys create` を実行してください。

```bash
# ADCではなく、サービスアカウントキーを明示的に使って認証したい場合のみ実行
gcloud iam service-accounts keys create serviceAccount.json \
  --iam-account ${SA}
```

### 4. Artifact Registryリポジトリの作成

```bash
gcloud artifacts repositories create timothy \
  --repository-format docker \
  --location ${REGION}
```

### 5. Secret Managerへのシークレット登録

`FIREBASE_PROJECT_ID` と `FIREBASE_STORAGE_BUCKET` は機密情報ではないため、通常の環境変数で
問題ありません。サービスアカウントキーを使う場合のみ、シークレットとして登録してください:

```bash
# 手順3でserviceAccount.jsonを作成した場合のみ実行
printf '%s' "$(cat serviceAccount.json | jq -r .private_key)" \
  | gcloud secrets create FIREBASE_PRIVATE_KEY --data-file=-
echo -n "$(cat serviceAccount.json | jq -r .client_email)" \
  | gcloud secrets create FIREBASE_CLIENT_EMAIL --data-file=-

PROJECT_NUMBER=$(gcloud projects describe ${PROJECT} --format='value(projectNumber)')
CLOUD_RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for SECRET in FIREBASE_CLIENT_EMAIL FIREBASE_PRIVATE_KEY; do
  gcloud secrets add-iam-policy-binding ${SECRET} \
    --member "serviceAccount:${CLOUD_RUN_SA}" \
    --role "roles/secretmanager.secretAccessor"
done
```

### 6. APIのビルドとデプロイ

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

手順5でサービスアカウントキーをシークレット登録した場合は、上記に加えて
`--set-secrets FIREBASE_CLIENT_EMAIL=FIREBASE_CLIENT_EMAIL:latest --set-secrets FIREBASE_PRIVATE_KEY=FIREBASE_PRIVATE_KEY:latest`
を指定してください。

注: `--allow-unauthenticated` は共有URL（`/s/<id>`）をリンクを知っている人が誰でも開けるようにするために必要です。アップロード・一覧・削除エンドポイントはアプリケーションレベルのAPIキーで保護されています。

デプロイ後に表示されるサービスURLをメモしてください（ステップ8で使用します）。

### 7. APIキーの発行

seedスクリプトを使ってFirestoreの `apiKeys` コレクションにエントリを追加します。
`gcloud auth application-default login` でローカル認証済みならキーファイルは不要です:

```bash
FIREBASE_PROJECT_ID=${PROJECT} \
API_KEY=$(openssl rand -hex 32) \
USER_ID=user@example.com \
npx tsx packages/api/scripts/seed-api-key.ts
```

それ以外の場合は、手順3で作成したサービスアカウントキーを使用します:

```bash
FIREBASE_PROJECT_ID=${PROJECT} \
FIREBASE_CLIENT_EMAIL=$(cat serviceAccount.json | jq -r .client_email) \
FIREBASE_PRIVATE_KEY=$(cat serviceAccount.json | jq -r .private_key) \
API_KEY=$(openssl rand -hex 32) \
USER_ID=user@example.com \
npx tsx packages/api/scripts/seed-api-key.ts
```

表示されたAPIキーをメモし、Cloud RunサービスのURLとともにユーザーに共有してください。

または、Firebaseコンソールから Firestore > `apiKeys` コレクションに手動で追加することもできます:

```json
{
  "key": "xxxxxxxxxxxxxxxxxxxx",
  "userId": "user@example.com",
  "createdAt": "<Timestamp>"
}
```

### 8. （オプション）IPアドレス制限の設定

共有ファイルの閲覧者をIPアドレスで制限する場合、Cloud Runの `ALLOWED_IPS` 環境変数にカンマ区切りでIPまたはCIDRを設定します:

```bash
gcloud run services update timothy-api \
  --region ${REGION} \
  --set-env-vars ALLOWED_IPS="203.0.113.0/24,198.51.100.42"
```

`ALLOWED_IPS` を設定しない場合、共有URLは任意のIPからアクセス可能です。

### 9. CLIの設定

ユーザーはAPIキーとCloud RunサービスのURLを使ってCLIを設定します:

```bash
tim setup
# API key: xxxxxxxxxxxxxxxxxxxx
# API endpoint [https://api.timothy.example.com]: https://timothy-api-xxxx-an.a.run.app
```

### インフラ構成

| コンポーネント | 設定 |
|---|---|
| Cloud Run | 最小インスタンス: 0、最大インスタンス: 2、認証なし（allow-unauthenticated） |
| Cloud Storage | パブリックアクセス禁止・Cloud Run APIを経由してプロキシ配信 |
| Firestore | Admin SDK経由のみ書き込み可・Firebase CLIでルール・インデックスを管理 |
| 認証 | アップロード・一覧・削除はAPIキー（Bearerトークン）、共有URLはオプションのIPアドレス制限 |

## AWSでのセルフホスティング（Lambda）

APIはAWS Lambda上でも動作します。Firebaseバックエンド（Firestore + Cloud Storage）はそのまま使用し、コンピュート層のみをAWSに置き換えます。Cloud Run版との**コードの差異はありません**。

### 前提条件

- AWSアカウントとAWS CLIのインストール・設定（`aws configure`）
- Dockerのインストール
- Firebaseプロジェクトのセットアップ済み（[Cloud Runガイド](#セルフホスティング) のステップ1〜3でFirestoreデータベース作成・ルール/インデックスのデプロイ・サービスアカウント作成を完了してください）

### 1. ECRリポジトリの作成

```bash
AWS_REGION=ap-northeast-1
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

aws ecr create-repository --repository-name timothy-api --region ${AWS_REGION}
```

### 2. LambdaイメージのビルドとECRへのプッシュ

```bash
IMAGE=${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/timothy-api:latest

aws ecr get-login-password --region ${AWS_REGION} \
  | docker login --username AWS --password-stdin ${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com

docker build -f packages/api/Dockerfile.lambda -t ${IMAGE} .
docker push ${IMAGE}
```

### 3. AWS Secrets Managerへのシークレット登録

```bash
aws secretsmanager create-secret --name FIREBASE_PROJECT_ID \
  --secret-string "your-project-id"
aws secretsmanager create-secret --name FIREBASE_CLIENT_EMAIL \
  --secret-string "timothy-api@your-project.iam.gserviceaccount.com"
aws secretsmanager create-secret --name FIREBASE_STORAGE_BUCKET \
  --secret-string "your-project.appspot.com"
aws secretsmanager create-secret --name FIREBASE_PRIVATE_KEY \
  --secret-string "$(cat serviceAccount.json | jq -r .private_key)"
```

### 4. Lambda用IAMロールの作成

```bash
aws iam create-role --role-name timothy-lambda \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }'

aws iam attach-role-policy --role-name timothy-lambda \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam put-role-policy --role-name timothy-lambda \
  --policy-name SecretsManagerAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:'"${AWS_REGION}"':'"${AWS_ACCOUNT}"':secret:FIREBASE_*"
    }]
  }'
```

### 5. Lambda関数の作成

```bash
ROLE_ARN=$(aws iam get-role --role-name timothy-lambda --query Role.Arn --output text)

aws lambda create-function \
  --function-name timothy-api \
  --package-type Image \
  --code ImageUri=${IMAGE} \
  --role ${ROLE_ARN} \
  --region ${AWS_REGION} \
  --environment "Variables={
    FIREBASE_PROJECT_ID=$(aws secretsmanager get-secret-value --secret-id FIREBASE_PROJECT_ID --query SecretString --output text),
    FIREBASE_CLIENT_EMAIL=$(aws secretsmanager get-secret-value --secret-id FIREBASE_CLIENT_EMAIL --query SecretString --output text),
    FIREBASE_STORAGE_BUCKET=$(aws secretsmanager get-secret-value --secret-id FIREBASE_STORAGE_BUCKET --query SecretString --output text),
    FIREBASE_PRIVATE_KEY=$(aws secretsmanager get-secret-value --secret-id FIREBASE_PRIVATE_KEY --query SecretString --output text)
  }"
```

### 6. Lambda Function URLの作成

```bash
aws lambda add-permission \
  --function-name timothy-api \
  --statement-id FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl \
  --principal "*" \
  --function-url-auth-type NONE \
  --region ${AWS_REGION}

aws lambda create-function-url-config \
  --function-name timothy-api \
  --auth-type NONE \
  --region ${AWS_REGION}
```

出力の `FunctionUrl` をメモしてください。これがAPIエンドポイントになります。

### 7. APIキーの発行

Cloud Run版と同じ手順です。FirebaseサービスアカウントのJSONを使ってseedスクリプトを実行します:

```bash
FIREBASE_PROJECT_ID=your-project-id \
FIREBASE_CLIENT_EMAIL=$(cat serviceAccount.json | jq -r .client_email) \
FIREBASE_PRIVATE_KEY=$(cat serviceAccount.json | jq -r .private_key) \
API_KEY=$(openssl rand -hex 32) \
USER_ID=user@example.com \
npx tsx packages/api/scripts/seed-api-key.ts
```

### 8. （オプション）IPアドレス制限の設定

`ALLOWED_IPS` 環境変数でLambda関数を更新します:

```bash
aws lambda update-function-configuration \
  --function-name timothy-api \
  --environment "Variables={...,ALLOWED_IPS=203.0.113.0/24,198.51.100.42}" \
  --region ${AWS_REGION}
```

### 9. CLIの設定

```bash
tim setup
# API key: xxxxxxxxxxxxxxxxxxxx
# API endpoint [https://api.timothy.example.com]: https://xxxxxxxxxxxx.lambda-url.ap-northeast-1.on.aws
```

### インフラ構成

| コンポーネント | 設定 |
|---|---|
| Lambda | コンテナイメージ（`Dockerfile.lambda`）、Function URL（認証なし） |
| Cloud Storage | Firebase Cloud Storage・Lambdaを経由してプロキシ配信 |
| Firestore | Firebase Firestore・Cloud Run版と共用可 |
| 認証 | アップロード・一覧・削除はAPIキー（Bearerトークン）、共有URLはオプションのIPアドレス制限 |

## ライセンス

EPL-2.0
