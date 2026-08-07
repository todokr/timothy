<img width="1258" height="926" alt="image" src="https://github.com/user-attachments/assets/9c665922-1eaf-4642-80a2-ddade3b8b689" />

# Timothy

LLMが生成したHTMLをターミナルからアップロードし、有効期限付きURLで共有するセルフホスト型CLIツールです。URLを知っている人だけが閲覧でき、閲覧者のログインは不要です。

[English README](./README.md)

## 特徴

- HTMLをファイルまたは標準入力からアップロード
- 有効期限付きURLで共有（デフォルト: 7日間）
- アップロード済みファイルの一覧表示・削除をCLIで操作
- APIが配信するWeb UIからファイルの一覧表示とアップロードができる
- セルフホスト: ストレージとアクセスを自分で管理

## 仕組み

```
tim upload report.html  →  https://your-api/s/<id>
```

URLはCloud Run上のAPIを経由して配信されます。APIがプライベートなCloud StorageからHTMLを取得してプロキシするため、ファイルに直接アクセスすることはできません。アクセスは指定したTTL経過後に無効になります。

## 必要なもの

- デプロイ済みの `@timothy/api`（[セルフホスティング](#セルフホスティング) を参照）
- そのインスタンスへのネットワーク到達性（管理者が `ALLOWED_IPS` を設定している場合、許可されたアドレスから接続する必要があります）

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

### Web UI

ブラウザでAPIエンドポイントを開くと、管理画面が表示されます:

```
https://your-api.example.com/
```

ここから、アップロード済みファイル（タイトル・説明・共有URL・有効期限・作成日時）の一覧表示、
ファイルを選択またはドラッグ＆ドロップしてのHTMLファイルのアップロード、共有URLのコピー、
ファイルの削除ができます。期限切れのファイルも「期限切れ」バッジ付きで一覧に残るため、
削除操作は引き続き行えます。

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

注: `--allow-unauthenticated` は共有URL（`/s/<id>`）をリンクを知っている人が誰でも開けるようにするために必要です。同時にWeb UIと管理系エンドポイントも公開されるため、実運用に使う前に必ずステップ7を読んでください。

デプロイ後に表示されるサービスURLをメモしてください（ステップ9で使用します）。

### 7. 管理系エンドポイントに誰がアクセスできるかを理解する

**アプリケーションレベルの認証はありません。`ALLOWED_IPS` を設定しない限り、URLを知っている人は誰でもファイルの一覧取得・アップロード・削除ができます。** Web UI（`/`）とその裏側の `/upload`・`/files`・`/files/<id>` は、インターネット全体に対して開いた状態です。`DELETE /files/<id>` は認証なしのHTTPリクエスト1本で、保存済みのファイルをすべて消せてしまいます。

アプリ側の対策は `ALLOWED_IPS`（ステップ8）だけですが、これまでのドキュメントが伏せていたトレードオフがあります。

- `ALLOWED_IPS` は**共有URLにも適用されます**。管理画面だけを許可リストで守り、`/s/<id>` は開いたままにする、という設定はできません。
- つまり、社外・ネットワーク外の相手にリンクを共有する用途（本ツールの本来の使い方）では、`ALLOWED_IPS` で管理画面を保護することはできません。

その場合は、アプリケーション層ではなくインフラ層でアクセスを制限してください。手間の少ない順に挙げると:

- `--allow-unauthenticated` をやめ、認証プロキシ（Identity-Aware Proxy、IAP付きロードバランサ、あるいはCloud Run IAM + `gcloud run services proxy`）をサービスの前段に置き、共有URLは別デプロイまたは署名付きURLの入口から配信する。
- 同じイメージからCloud Runサービスを2つデプロイし、片方は `/s/*` 専用の公開サービス、もう片方は管理画面と管理系エンドポイント用のIAM保護／IP制限付きサービスにする。
- 使い捨てや個人用インスタンスと割り切って公開を受け入れ、サービスURL自体を秘密として扱う。

### 8. （オプション）IPアドレス制限の設定

APIへのアクセスを制限する場合、Cloud Runの `ALLOWED_IPS` 環境変数にカンマ区切りでIPまたはCIDRを設定します:

```bash
gcloud run services update timothy-api \
  --region ${REGION} \
  --set-env-vars ALLOWED_IPS="203.0.113.0/24,198.51.100.42"
```

`ALLOWED_IPS` はWeb UI（`/`）、管理系エンドポイント（`/upload`、`/files`、`/files/<id>`）、
共有エンドポイント（`/s/*`）に適用されます。**未設定の場合はすべてのリクエストが許可され、
URLを知っている人は誰でもファイルの一覧取得・アップロード・削除ができます。** 設定すると
CLIからのアクセスも、共有URLを開く相手も、このIPアドレスに制限される点に注意してください
（ステップ7を参照）。

クライアントIPは `X-Forwarded-For` の**末尾から** `XFF_TRUSTED_HOPS` 個目のエントリから
判定します。前段のプロキシは自分が実際に観測した接続元アドレスを末尾に追記していくため、
信頼できるのは自分で用意したプロキシが追記した範囲だけで、それより前のエントリは
攻撃者が自由に詐称できます。

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

この値は正確に設定してください。**小さすぎると、呼び出し側が自分で `X-Forwarded-For` を
付けて許可リストを詐称できてしまいます**（詐称した値が、信頼している位置に入り込むため）。
逆に大きすぎるとエントリ数が足りず、すべてのリクエストが拒否されます。エントリ数が
`XFF_TRUSTED_HOPS` に満たないヘッダーは、設定したプロキシを経由していないものとして拒否します。

### 9. CLIの設定

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

### インフラ構成

| コンポーネント | 設定 |
|---|---|
| Cloud Run | 最小インスタンス: 0、最大インスタンス: 2、認証なし（allow-unauthenticated） |
| Cloud Storage | パブリックアクセス禁止・Cloud Run APIを経由してプロキシ配信 |
| Firestore | Admin SDK経由のみ書き込み可・Firebase CLIでルール・インデックスを管理 |
| 認証 | **アプリケーションレベルの認証はなし。** オプションの `ALLOWED_IPS` がWeb UI・管理系エンドポイント・共有URLに一律で適用される。未設定ならURLを知っている人は誰でも一覧取得・アップロード・削除が可能 |

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

### 7. 管理系エンドポイントに誰がアクセスできるかを理解する

Cloud Run版と同じ話ですが、`--auth-type NONE` のFunction URLはインターネットに直接公開されるため、こちらの方がより重要です。

**アプリケーションレベルの認証はありません。`ALLOWED_IPS` を設定しない限り、URLを知っている人は誰でもファイルの一覧取得・アップロード・削除ができます。** Web UI（`/`）とその裏側の `/upload`・`/files`・`/files/<id>` がすべて対象です。

アプリ側の対策は `ALLOWED_IPS`（ステップ8）だけで、これは共有URL（`/s/<id>`）にも同じように適用されます。管理画面だけを許可リストで守り共有URLは開いたままにする、という設定はできないため、ネットワーク外の相手にリンクを送る運用では `ALLOWED_IPS` で管理画面を保護できません。その場合はインフラ層で制限してください。たとえばFunction URLを `--auth-type AWS_IAM` に変更し、共有URL用に別の公開デプロイやCloudFrontディストリビューションを用意する、あるいはAPI Gateway / ALB を前段に置いて `/`・`/upload`・`/files*` だけ認証し `/s/*` は開けておく、といった構成が考えられます。

### 8. （オプション）IPアドレス制限の設定

`ALLOWED_IPS` 環境変数でLambda関数を更新します:

```bash
aws lambda update-function-configuration \
  --function-name timothy-api \
  --environment "Variables={...,ALLOWED_IPS=203.0.113.0/24,198.51.100.42}" \
  --region ${AWS_REGION}
```

`ALLOWED_IPS` はWeb UI（`/`）、管理系エンドポイント（`/upload`、`/files`、`/files/<id>`）、
共有エンドポイント（`/s/*`）に一律で適用されます。**未設定の場合はすべてのリクエストが
許可されます。** クライアントIPは `X-Forwarded-For` の**末尾から** `XFF_TRUSTED_HOPS`
個目のエントリから判定します。

| 環境変数 | 既定値 | 意味 |
|---|---|---|
| `ALLOWED_IPS` | 未設定（全リクエスト許可） | `/`、`/upload`、`/files`、`/files/<id>`、`/s/*` へのアクセスを許可するIP・CIDRのカンマ区切り |
| `XFF_TRUSTED_HOPS` | `1` | 関数の前段で `X-Forwarded-For` に追記するプロキシの段数。末尾からこの数だけ遡ったエントリをクライアントIPとして採用する |

既定値の `1` は、Lambda Function URL（および素のCloud Runサービス）のように1エントリだけが
追記される構成に対応します。CloudFront・ALB・API Gateway を前段に置く場合や、Cloud Run側で
Google Cloud Load Balancer / Cloud Armor を挟む場合は、追記するプロキシの段数を数えて
`XFF_TRUSTED_HOPS` に設定してください（例: `2`）。

この値は正確に設定してください。**小さすぎると、呼び出し側が自分で `X-Forwarded-For` を
付けて許可リストを詐称できてしまいます。** 逆に大きすぎるとすべてのリクエストが拒否されます。
エントリ数が `XFF_TRUSTED_HOPS` に満たないヘッダーは、設定したプロキシを経由していないものとして
拒否されるためです。

### 9. CLIの設定

```bash
tim setup
# API endpoint [https://api.timothy.example.com]: https://xxxxxxxxxxxx.lambda-url.ap-northeast-1.on.aws
```

Web UIを使う場合、ここでもCloud Run版と同様にストレージバケットへのCORS設定が必要です。
これはコンピュート層とは無関係です。上記の
[バケットのCORS設定](#バケットのcors設定) を参照してください。

### インフラ構成

| コンポーネント | 設定 |
|---|---|
| Lambda | コンテナイメージ（`Dockerfile.lambda`）、Function URL（認証なし） |
| Cloud Storage | Firebase Cloud Storage・Lambdaを経由してプロキシ配信 |
| Firestore | Firebase Firestore・Cloud Run版と共用可 |
| 認証 | **アプリケーションレベルの認証はなし。** オプションの `ALLOWED_IPS` がWeb UI・管理系エンドポイント・共有URLに一律で適用される。未設定ならURLを知っている人は誰でも一覧取得・アップロード・削除が可能 |

## ライセンス

EPL-2.0
