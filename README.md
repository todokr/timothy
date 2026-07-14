<img width="1502" height="940" alt="image" src="https://github.com/user-attachments/assets/84aacaa9-aed6-4088-bfeb-e888cdf033e3" />

# Timothy

A self-hosted CLI tool to upload LLM-generated HTML and share it via time-limited URLs. Only people who know the URL can view the file — no login required for viewers.

[日本語版はこちら](./README.ja.md)

## Features

- Upload HTML from a file or stdin
- Share via a time-limited URL (default: 7 days)
- List and delete your uploaded files from the CLI
- Self-hosted: you control the storage and access

## How It Works

```
tim upload report.html  →  https://your-api/s/<id>
```

The URL is served through your Cloud Run API, which fetches the file from private Cloud Storage and proxies it. Files are never publicly accessible directly; access expires after the specified TTL.

## Requirements

- A deployed instance of `@timothy/api` (see [Self-Hosting](#self-hosting))
- An API key issued by the server admin

## Installation

```bash
npm install -g timothy-cli
```

Or run without installing:

```bash
npx timothy-cli <command>
```

## Usage

### Setup

Save your API key and endpoint:

```bash
tim setup
# API key: xxxxxxxxxxxxxxxxxxxx
# API endpoint [https://api.timothy.example.com]: https://your-api.example.com
```

Configuration is stored in `~/.config/timothy/config.json`.

### Upload

```bash
# Upload a file
tim upload report.html

# Upload with a custom title and TTL
tim upload report.html --title "Monthly Report" --ttl 30

# Pipe from stdin
llm generate report | tim upload --stdin --title "Generated Report"
```

### List

```bash
tim list
```

```
ID                          TITLE             CREATED       EXPIRES
01JWXYZ...                  Monthly Report    2026-05-20    2026-05-27
01JWABC...                  Analysis          2026-05-18    2026-05-25
```

### Delete

```bash
tim delete <id>
# Delete 01JWXYZ...? [y/N] y
# Deleted 01JWXYZ...

# Skip confirmation
tim delete <id> --force
```

## Self-Hosting

Timothy's backend (`@timothy/api`) runs on Cloud Run with Firestore and Cloud Storage.

### Prerequisites

- Google Cloud project with billing enabled
- [`gcloud` CLI](https://cloud.google.com/sdk/docs/install) installed and authenticated
- [`firebase` CLI](https://firebase.google.com/docs/cli) installed and authenticated (`firebase login`)
- Docker installed

### 1. Enable required GCP APIs

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

### 2. Set up Firestore and Storage

Create the Firestore database:

```bash
gcloud firestore databases create --location=${REGION}
```

Deploy Firestore rules and indexes from the repository root:

```bash
firebase use ${PROJECT}
firebase deploy --only firestore
```

This applies:
- `firestore.rules` — blocks all direct client access
- `firestore.indexes.json` — composite index on `htmlFiles` (userId + createdAt) used by `tim list`

**Create the Cloud Storage bucket:**

```bash
BUCKET=${PROJECT}-timothy
gsutil mb -l ${REGION} gs://${BUCKET}
gsutil uniformbucketlevelaccess set on gs://${BUCKET}
```

Use this bucket name as the value for `FIREBASE_STORAGE_BUCKET` in the next step.

### 3. Create a service account

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

By default the API authenticates to Firebase using Application Default Credentials (ADC) —
i.e. whichever service account Cloud Run runs as. No key file is required for this path;
skip the `gcloud iam service-accounts keys create` step below unless you specifically need
an exported key (e.g. for local testing outside an emulator, or non-GCP hosting).

```bash
# Only needed if you want to authenticate with an explicit service account key
# instead of ADC:
gcloud iam service-accounts keys create serviceAccount.json \
  --iam-account ${SA}
```

### 4. Create an Artifact Registry repository

```bash
gcloud artifacts repositories create timothy \
  --repository-format docker \
  --location ${REGION}
```

### 5. Register secrets in Secret Manager

`FIREBASE_PROJECT_ID` and `FIREBASE_STORAGE_BUCKET` are not sensitive, so plain environment
variables are enough. Only register a secret if you're using an explicit service account key:

```bash
# Only needed if you created serviceAccount.json in step 3
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

### 6. Build and deploy the API

Build and push the Docker image from the repository root:

```bash
IMAGE=${REGION}-docker.pkg.dev/${PROJECT}/timothy/api:latest

docker build -f packages/api/Dockerfile -t ${IMAGE} .
docker push ${IMAGE}
```

Deploy to Cloud Run, running as the service account created in step 3 (ADC path):

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

If you registered `FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` secrets in step 5 instead,
add `--set-secrets FIREBASE_CLIENT_EMAIL=FIREBASE_CLIENT_EMAIL:latest --set-secrets FIREBASE_PRIVATE_KEY=FIREBASE_PRIVATE_KEY:latest`.

Note: `--allow-unauthenticated` is required so that share URLs (`/s/<id>`) are accessible to anyone who knows the link. Upload and list/delete endpoints are protected by the API key at the application level.

After deploying, note the service URL printed by the command — you'll need it in step 8.

### 7. Issue an API key

Add an entry to Firestore's `apiKeys` collection using the seed script. If you're
authenticated locally via `gcloud auth application-default login` with access to the
project, no key file is needed:

```bash
FIREBASE_PROJECT_ID=${PROJECT} \
API_KEY=$(openssl rand -hex 32) \
USER_ID=user@example.com \
npx tsx packages/api/scripts/seed-api-key.ts
```

Otherwise, use the service account key from step 3:

```bash
FIREBASE_PROJECT_ID=${PROJECT} \
FIREBASE_CLIENT_EMAIL=$(cat serviceAccount.json | jq -r .client_email) \
FIREBASE_PRIVATE_KEY=$(cat serviceAccount.json | jq -r .private_key) \
API_KEY=$(openssl rand -hex 32) \
USER_ID=user@example.com \
npx tsx packages/api/scripts/seed-api-key.ts
```

Note the printed API key — share it along with the Cloud Run service URL with each user.

Alternatively, add the entry manually via the Firebase console under Firestore > `apiKeys` collection:

```json
{
  "key": "xxxxxxxxxxxxxxxxxxxx",
  "userId": "user@example.com",
  "createdAt": "<Timestamp>"
}
```

### 8. (Optional) Restrict access by IP

To limit who can view shared files, set the `ALLOWED_IPS` environment variable on Cloud Run (comma-separated IPs or CIDR ranges):

```bash
gcloud run services update timothy-api \
  --region ${REGION} \
  --set-env-vars ALLOWED_IPS="203.0.113.0/24,198.51.100.42"
```

If `ALLOWED_IPS` is not set, share URLs are accessible from any IP.

### 9. Configure the CLI

Users can now configure the CLI with their API key and the Cloud Run service URL:

```bash
tim setup
# API key: xxxxxxxxxxxxxxxxxxxx
# API endpoint [https://api.timothy.example.com]: https://timothy-api-xxxx-an.a.run.app
```

### Infrastructure Overview

| Component | Config |
|---|---|
| Cloud Run | min-instances: 0, max-instances: 2, allow-unauthenticated |
| Cloud Storage | Public access disabled; proxied through Cloud Run API |
| Firestore | Write access via Admin SDK only; rules and indexes managed via Firebase CLI |
| Auth | API key (Bearer token) for upload/list/delete; optional IP allowlist for share URLs |

## Self-Hosting on AWS (Lambda)

The API also runs on AWS Lambda using the same Firebase backend (Firestore + Cloud Storage). Only the compute layer changes — no code differences from the Cloud Run setup.

### Prerequisites

- AWS account with the AWS CLI installed and configured (`aws configure`)
- Docker installed
- Firebase project already set up (follow steps 1–3 of the [Cloud Run guide](#self-hosting) to create the Firestore database, deploy rules/indexes, and create a service account)

### 1. Create an ECR repository

```bash
AWS_REGION=ap-northeast-1
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

aws ecr create-repository --repository-name timothy-api --region ${AWS_REGION}
```

### 2. Build and push the Lambda image

```bash
IMAGE=${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/timothy-api:latest

aws ecr get-login-password --region ${AWS_REGION} \
  | docker login --username AWS --password-stdin ${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com

docker build -f packages/api/Dockerfile.lambda -t ${IMAGE} .
docker push ${IMAGE}
```

### 3. Register secrets in AWS Secrets Manager

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

### 4. Create an IAM role for Lambda

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

### 5. Create the Lambda function

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

### 6. Create a Lambda Function URL

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

Note the `FunctionUrl` in the output — this is your API endpoint.

### 7. Issue an API key

Same as the Cloud Run setup — use the seed script with the Firebase service account credentials:

```bash
FIREBASE_PROJECT_ID=your-project-id \
FIREBASE_CLIENT_EMAIL=$(cat serviceAccount.json | jq -r .client_email) \
FIREBASE_PRIVATE_KEY=$(cat serviceAccount.json | jq -r .private_key) \
API_KEY=$(openssl rand -hex 32) \
USER_ID=user@example.com \
npx tsx packages/api/scripts/seed-api-key.ts
```

### 8. (Optional) Restrict access by IP

Set the `ALLOWED_IPS` environment variable on the Lambda function:

```bash
aws lambda update-function-configuration \
  --function-name timothy-api \
  --environment "Variables={...,ALLOWED_IPS=203.0.113.0/24,198.51.100.42}" \
  --region ${AWS_REGION}
```

### 9. Configure the CLI

```bash
tim setup
# API key: xxxxxxxxxxxxxxxxxxxx
# API endpoint [https://api.timothy.example.com]: https://xxxxxxxxxxxx.lambda-url.ap-northeast-1.on.aws
```

### Infrastructure Overview

| Component | Config |
|---|---|
| Lambda | Container image (`Dockerfile.lambda`), Function URL (no auth) |
| Cloud Storage | Firebase Cloud Storage; proxied through Lambda |
| Firestore | Firebase Firestore; shared with Cloud Run setup |
| Auth | API key (Bearer token) for upload/list/delete; optional IP allowlist for share URLs |

## License

EPL-2.0
