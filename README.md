# Timothy

LLMが生成したHTMLをターミナルからアップロードし、有効期限付きURLで共有するセルフホスト型ツールです。

## 特徴

- HTMLをCLIまたはWeb画面からアップロード & 閲覧
- 有効期限付きURLで共有（デフォルト: 7日間、無期限も選択可）
- アップロード済みファイルの一覧表示・削除をCLIで操作
- セルフホスト: ストレージとアクセスを自分で管理

## 仕組み

```
tim upload report.html  →  https://your-api/s/<id>
```

URLはCloud Run / AWS Lambda上のAPIを経由して配信されます。APIがプライベートなCloud StorageからHTMLを取得してプロキシするため、ファイルに直接アクセスすることはできません。アクセスは指定したTTL経過後に無効になります（`--ttl never` を指定した場合は、削除するまで有効なままです）。

アップロードするHTMLは自己完結している必要があります。インラインの`<script>`・`<style>`と
`data:`/`blob:`の画像は動作しますが、外部URLからの読み込み、`fetch`などの外部通信、
`<iframe>`埋め込みはブロックされます。

共有ページ（`/s/<id>`）は timothy の画面で、本体の HTML は同じオリジンの iframe
（`/s/<id>/v/<版>`）で表示します。どちらも他サイトからの`<iframe>`埋め込みは拒否します
（`X-Frame-Options: DENY`）。

同じ URL に修正版を上げられます（所有者のみ）。版は 1 から順に番号が付き、
`/s/<id>?v=<版>` で過去の版を開けます。版の指定がなければ最新版を表示します。

> **アップグレード時の注意:** CDNからライブラリを読み込んでいるレポートは動作しなくなります。
> エラーではなくグラフが空になるなど**無言で壊れる**点に注意してください。
> 影響は有効期限内の既存ファイルのみで、TTL経過後に解消します。
> 無期限でアップロードしたファイルは期限切れによる解消が起きないため、
> 必要なら手動で削除するか、アップロードし直してください。

> **アップグレード時の注意（認証の導入）:**
>
> - 必須の4変数（`GOOGLE_OAUTH_CLIENT_ID`・`GOOGLE_OAUTH_CLIENT_SECRET`・`SESSION_SECRET`・`ALLOWED_EMAIL_DOMAINS`）が
>   設定され、OAuthクライアントが作成されるまで、APIは起動しません。手順は [セルフホスティング](#セルフホスティング) の手順4・5を参照してください。
> - 既存の共有リンクを開くにも、許可ドメインのGoogleログインが必要になります。リンクを受け取る相手が許可ドメインのアカウントを持っているか確認してください。
> - 古いCLIは認証付きのリクエストを送れず、素の `401` が返ります。CLIを更新して `tim login` を実行してください。
> - 以前 `Cache-Control: public` で配信されたレスポンスは、`max-age` が切れるまで共有キャッシュ（CDNなど）から配信され続けることがあります。
> - ロードバランサやCloud Armorの背後で動かす場合は `PUBLIC_BASE_URL` を設定してください（リダイレクトURIの基準になります）。

## 必要なもの

- デプロイ済みの `@timothy/api`（[セルフホスティング](#セルフホスティング) を参照）
- 許可されたドメインの Google アカウント（管理者が `ALLOWED_EMAIL_DOMAINS` で指定します）
- CLIを使う場合は `tim login` でのログイン。Web UIだけを使う人は Google ログイン以外に用意するものはありません
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

### ログイン

APIはログインが必要です。`tim login` を実行するとブラウザが開き、Googleでログインして
確認すると、CLI用のトークンが `~/.config/timothy/credentials.json`（ファイルモード 0600）に
保存されます。ブラウザが開かない環境では、表示されるURLを手動で開いてください。

```bash
tim login
# ✓ Logged in

tim logout   # サーバー側でトークンを失効させ、保存済みの資格情報を削除
```

未ログインのまま他のコマンドを実行すると `Not logged in. Run \`tim login\`.` と表示されます。

### アップロード

```bash
# ファイルをアップロード
tim upload report.html

# タイトルと有効期限を指定
tim upload report.html --title "月次レポート" --ttl 30

# 有効期限を設けない
tim upload report.html --ttl never

# 標準入力から渡す
llm generate report | tim upload --stdin --title "生成レポート"
```

### 一覧表示

```bash
tim list

# 自分がアップロードしたファイルだけを表示
tim list --mine
```

```
URL                         TITLE             OWNER              CREATED       EXPIRES
https://.../s/01JWXYZ...    月次レポート        alice@example.com  2026-05-20    2026-05-27
https://.../s/01JWABC...    分析結果            -                  2026-05-18    2026-05-25
```

OWNER は所有者のメールアドレスです。所有者が記録されていないファイル（認証導入前のもの）は `-` です。

## Web UI

ブラウザでAPIエンドポイントを開くと、管理画面が表示されます:

```
https://your-api.example.com/
```

ここから、アップロード済みファイル（タイトル・説明・共有URL・有効期限・作成日時）の一覧表示、
ファイルを選択またはドラッグ＆ドロップしてのHTMLファイルのアップロード、共有URLのコピー、
ファイルの削除ができます。

### ヘッダ設定

一覧の「ヘッダ設定」から、コンテンツごとに配信時の制限を緩められます。
既定より**緩める方向にのみ**働くため、設定によってインラインの`<script>`が
止まることはありません。

- CDNなど、読み込みを許可するオリジン（`https://` のみ）
- `sandbox` の各トークン
- `Cache-Control` / `Referrer-Policy`

危険度は各項目に表示されます。変更内容は構造化ログ（`event: "headers.updated"`）に
記録されます。ヘッダ設定を変更できるのはファイルの所有者だけで、ログには日時・IPアドレス・
変更内容に加えて変更したユーザーも残ります。

Web UIのアップロードはCLIと同じ署名付きURLのフローを使うため、ストレージバケットに
CORSの設定が必要です。[セルフホスティング](#セルフホスティング) を参照してください。

### 削除

ファイルを削除できるのは所有者だけです。他の人のファイルを削除しようとすると
`Forbidden: you are not the owner of this file` で失敗します。

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

Cloud Runにデプロイします（手順3で作成したサービスアカウントで実行、ADC方式）。
APIは次の4つが揃っていないと起動時にエラーで終了するため、デプロイ時に一緒に指定します
（各変数の意味は手順5の表を参照）。`GOOGLE_OAUTH_CLIENT_SECRET` と `SESSION_SECRET` は
事前にSecret Managerへ登録しておいてください（`SESSION_SECRET` は `openssl rand -base64 32` などで生成した値）。

```bash
gcloud run deploy timothy-api \
  --image ${IMAGE} \
  --region ${REGION} \
  --min-instances 0 \
  --max-instances 2 \
  --service-account ${SA} \
  --set-env-vars "^@^FIREBASE_PROJECT_ID=${PROJECT}@FIREBASE_STORAGE_BUCKET=${BUCKET}@ALLOWED_EMAIL_DOMAINS=a.com,b.com@GOOGLE_OAUTH_CLIENT_ID=<クライアントID>" \
  --set-secrets GOOGLE_OAUTH_CLIENT_SECRET=google-oauth-client-secret:latest,SESSION_SECRET=session-secret:latest \
  --allow-unauthenticated
```

`ALLOWED_EMAIL_DOMAINS` はカンマ区切りで複数指定できます。gcloudの `--set-env-vars` もカンマを
区切りに使うため、`^@^` で区切り文字を `@` に変えています（値に `@` を含めない限り、この形で書けます）。

OAuthクライアントのIDとシークレットは手順5で作成します。リダイレクトURI（`<公開URL>/auth/callback`）は
サービスURLが決まってから登録すれば足り、ログインするときまでに間に合えばデプロイ自体は進められます。
クライアントを先に作る場合は、仮のリダイレクトURIで作成しておき、デプロイ後に差し替えてください。

デプロイ後に表示されるサービスURLをメモしてください。


### 5. Googleログイン（OAuthクライアント）の設定

APIはGoogleアカウントでのログインを必須とします。クライアントを作る前に、同じプロジェクトでOAuth同意画面
（Google Auth Platform のブランディング・対象）を作成してください。Google Workspace の組織内で使うなら、
ユーザーの種類は **「内部」** を選びます。組織外のアカウントはGoogle側でも拒否され、Googleの審査も不要です
（timothyが要求するスコープは `openid`・`email`・`profile` だけです）。

続いてGoogle Cloud ConsoleのAPIとサービス →
認証情報で「OAuthクライアントID」（アプリケーションの種類: ウェブアプリケーション）を作成し、
**承認済みのリダイレクトURI** に `<公開URL>/auth/callback` を登録してください
（例: `https://timothy-api-xxxx-an.a.run.app/auth/callback`）。

APIには次の環境変数を設定します（手順4のデプロイで指定済みのものを含みます）。必須の変数が欠けていると、APIは起動時にエラーになります。

| 環境変数 | 必須 | 意味 |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | 必須 | OAuthクライアントのID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | 必須 | OAuthクライアントのシークレット（Secret Managerでの管理を推奨） |
| `SESSION_SECRET` | 必須 | ログインセッションの署名に使うランダムな文字列（Secret Managerでの管理を推奨） |
| `ALLOWED_EMAIL_DOMAINS` | 必須 | ログインを許可するメールアドレスのドメイン（カンマ区切り。例: `example.com`） |
| `PUBLIC_BASE_URL` | 任意 | APIの公開URL（例: `https://timothy-api-xxxx-an.a.run.app`）。プロキシ越しでHostが揺れる場合に、コールバックURLの基準として固定する |

後から値を変える場合は `gcloud run services update` を使います（カンマを含む値は手順4と同じく `^@^` 形式で指定します）:

```bash
gcloud run services update timothy-api \
  --region ${REGION} \
  --update-env-vars "^@^ALLOWED_EMAIL_DOMAINS=a.com,b.com"
```

### 6. （オプション）IPアドレス制限の設定

APIへのアクセスを制限する場合、Cloud Runの `ALLOWED_IPS` 環境変数にカンマ区切りでIPまたはCIDRを設定します:

```bash
gcloud run services update timothy-api \
  --region ${REGION} \
  --set-env-vars ALLOWED_IPS="203.0.113.0/24,198.51.100.42"
```

`ALLOWED_IPS` はWeb UI（`/`）、管理系エンドポイント（`/upload`、`/files`、`/files/<id>`）、
共有エンドポイント（`/s/*`）に適用されます。**未設定の場合はIPアドレスによる制限はかかりません**（ログインは別途必要です）。設定すると
CLIからのアクセスも、共有URLを開く相手も、このIPアドレスに制限される点に注意してください。

※ クライアントIPは `X-Forwarded-For` の**末尾から** `XFF_TRUSTED_HOPS` 個目のエントリから
判定します。前段のプロキシは自分が実際に観測した接続元アドレスを末尾に追記していくため、
信頼できるのは自分で用意したプロキシが追記した範囲だけで、それより前のエントリは
攻撃者が自由に詐称できる点に注意してください。

| 環境変数 | 既定値 | 意味 |
|---|---|---|
| `ALLOWED_IPS` | 未設定（IP 制限なし。ログインは必須） | `/`、`/upload`、`/files`、`/files/<id>`、`/s/*` へのアクセスを許可するIP・CIDRのカンマ区切り |
| `XFF_TRUSTED_HOPS` | `1` | サービスの前段で `X-Forwarded-For` に追記するプロキシの段数。末尾からこの数だけ遡ったエントリをクライアントIPとして採用する |

既定値の `1` は、`*.run.app` の素のCloud Runサービス（およびLambda Function URL）のように
1エントリだけが追記される構成に対応します。Google Cloud Load Balancer や Cloud Armor を
前段に置く場合は2エントリ追記されるため、`XFF_TRUSTED_HOPS=2` を設定してください:

```bash
gcloud run services update timothy-api \
  --region ${REGION} \
  --set-env-vars XFF_TRUSTED_HOPS=2
```

### 7. CLIの設定

ユーザーはCloud RunサービスのURLを使ってCLIを設定し、ログインします:

```bash
tim setup
# API endpoint [https://api.timothy.example.com]: https://timothy-api-xxxx-an.a.run.app

tim login
```

### 運用

- 画面の「ログアウト」はブラウザのCookieを消すだけです。Cookieを盗まれた場合、セッションは最長7日間有効なままです。
- CLIのトークンは90日間有効です。`tim logout` で失効するほか、Firestoreの `cliTokens` コレクションのドキュメントを削除しても失効します。
- `ALLOWED_EMAIL_DOMAINS` からドメインを外すと、そのドメインの既存セッションとCLIトークンはすぐに使えなくなります（リクエストごとにドメインを再確認します）。
- `SESSION_SECRET` を変更すると、全員のセッションが無効になり再ログインが必要になります。

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

Lambdaでも認証の設定は必須です。環境変数（手順5の表）をLambdaの環境変数に設定し、OAuthクライアントの承認済みリダイレクトURIに `<公開URL>/auth/callback`（Function URLなど）を登録してください。ログイン時にだけ必要なので、URLが決まってから登録できます。

## ライセンス

EPL-2.0
