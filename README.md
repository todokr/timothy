<img width="1502" height="940" alt="image" src="https://github.com/user-attachments/assets/84aacaa9-aed6-4088-bfeb-e888cdf033e3" />

# Timothy

A self-hosted CLI tool to upload LLM-generated HTML and share it via time-limited URLs. Only people who know the URL can view the file — no login required for viewers.

[日本語版はこちら](./README.ja.md)

## Features

- Upload HTML from a file or stdin
- Share via a time-limited URL (default: 7 days)
- List and delete your uploaded files from the CLI
- Browse and upload files from a web UI served by the API
- Self-hosted: you control the storage and access

## How It Works

```
tim upload report.html  →  https://your-api/s/<id>
```

The URL is served through your Cloud Run API, which fetches the file from private Cloud Storage and proxies it. Files are never publicly accessible directly; access expires after the specified TTL.

## Requirements

- A deployed instance of `@timothy/api` (see [Self-Hosting](#self-hosting))
- Network access to it (if the admin set `ALLOWED_IPS`, you must connect from an allowed address)

## Installation

### Homebrew (macOS / Linux)

```bash
brew tap todokr/homebrew-tap
brew install timothy
```

### npm

```bash
npm install -g timothy-cli
```

Or run without installing:

```bash
npx timothy-cli <command>
```

## Usage

### Setup

Save your API endpoint:

```bash
tim setup
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

### Web UI

Open your API endpoint in a browser to get a management page:

```
https://your-api.example.com/
```

From there you can browse your uploaded files (title, description, share
URL, expiry, and creation date), upload a new HTML file by picking it or
dragging it onto the page, copy share URLs, and delete files. Expired files
stay listed with an "expired" badge so you can still delete them.

The web UI uploads through the same signed-URL flow as the CLI, so it
requires CORS to be configured on your storage bucket. See
[Self-Hosting](#self-hosting).

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

Note: `--allow-unauthenticated` is required so that share URLs (`/s/<id>`) are accessible to anyone who knows the link. It also exposes the web UI and the management endpoints — read step 7 before you use this deployment for anything real.

After deploying, note the service URL printed by the command — you'll need it in step 9.

### 7. Understand who can reach the management endpoints

**There is no application-level authentication. With `ALLOWED_IPS` unset, anyone
who knows the URL can list, upload, and delete files** — the web UI at `/`, and
the `/upload`, `/files` and `/files/<id>` endpoints behind it, are open to the
whole internet. The `DELETE /files/<id>` endpoint is a single unauthenticated
HTTP request away from wiping every file you have stored.

`ALLOWED_IPS` (step 8) is the only in-app control, and it comes with a tension
the rest of this guide used to hide:

- `ALLOWED_IPS` applies to **share URLs too**, not just the admin UI. There is no
  way to allowlist the admin surface while leaving `/s/<id>` open.
- So if you share links with people outside your network — which is the point of
  this tool — you cannot use `ALLOWED_IPS` to protect the admin UI.

If that describes you, restrict access at the infrastructure layer instead of at
the application layer. Options, roughly in order of effort:

- Drop `--allow-unauthenticated` and put an authenticating proxy
  (Identity-Aware Proxy, a load balancer with IAP, or Cloud Run IAM plus
  `gcloud run services proxy`) in front of the service, and serve share URLs from
  a separate deployment or a signed-URL front door.
- Deploy two Cloud Run services from the same image: a public one used only for
  `/s/*`, and a private, IAM-protected or IP-restricted one for the admin UI and
  the management endpoints.
- Accept the exposure only for a throwaway or personal instance, and treat the
  service URL itself as the secret.

### 8. (Optional) Restrict access by IP

To restrict access to the API, set the `ALLOWED_IPS` environment variable on Cloud Run (comma-separated IPs or CIDR ranges):

```bash
gcloud run services update timothy-api \
  --region ${REGION} \
  --set-env-vars ALLOWED_IPS="203.0.113.0/24,198.51.100.42"
```

`ALLOWED_IPS` applies to the web UI (`/`), the management endpoints
(`/upload`, `/files`, `/files/<id>`) and the share endpoint (`/s/*`).
**When it is unset, all requests are allowed — anyone who knows the URL can
list, upload, and delete files.** Note that setting it also restricts the CLI
and every share-URL recipient to the listed addresses; see step 7.

The client IP is taken from `X-Forwarded-For`, using the second-to-last entry —
the value Cloud Run / Google Cloud Load Balancer appends. Do not put a proxy in
front that rewrites or collapses that header, or the allowlist will match the
wrong address.

### 9. Configure the CLI

Users can now configure the CLI with the Cloud Run service URL:

```bash
tim setup
# API endpoint [https://api.timothy.example.com]: https://timothy-api-xxxx-an.a.run.app
```

### Storage bucket CORS

The web UI uploads directly from the browser to Cloud Storage using a signed
URL. Without CORS configured on the bucket, those uploads fail (the CLI is
unaffected).

Create `cors.json`, replacing the origin with your API endpoint:

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

Apply it:

```bash
gcloud storage buckets update gs://YOUR_BUCKET --cors-file=cors.json
```

### Infrastructure Overview

| Component | Config |
|---|---|
| Cloud Run | min-instances: 0, max-instances: 2, allow-unauthenticated |
| Cloud Storage | Public access disabled; proxied through Cloud Run API |
| Firestore | Write access via Admin SDK only; rules and indexes managed via Firebase CLI |
| Auth | **None at the application level.** Optional `ALLOWED_IPS` allowlist covering the web UI, management endpoints, and share URLs alike; unset means anyone with the URL can list, upload, and delete |

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

### 7. Understand who can reach the management endpoints

Same as the Cloud Run setup, and it matters more here because
`--auth-type NONE` puts the Function URL on the public internet.

**There is no application-level authentication. With `ALLOWED_IPS` unset, anyone
who knows the URL can list, upload, and delete files** — the web UI at `/`, and
the `/upload`, `/files` and `/files/<id>` endpoints behind it.

`ALLOWED_IPS` (step 8) is the only in-app control, and it also applies to share
URLs (`/s/<id>`). There is no way to allowlist the admin surface while leaving
share URLs open, so if you send links to people outside your network you cannot
use `ALLOWED_IPS` to protect the admin UI. Restrict access at the infrastructure
layer instead — for example switch the Function URL to
`--auth-type AWS_IAM` and front the share path with a separate, public
deployment or a CloudFront distribution, or put the function behind an
API Gateway / ALB that authenticates `/`, `/upload` and `/files*` while leaving
`/s/*` open.

### 8. (Optional) Restrict access by IP

Set the `ALLOWED_IPS` environment variable on the Lambda function:

```bash
aws lambda update-function-configuration \
  --function-name timothy-api \
  --environment "Variables={...,ALLOWED_IPS=203.0.113.0/24,198.51.100.42}" \
  --region ${AWS_REGION}
```

`ALLOWED_IPS` covers the web UI (`/`), the management endpoints (`/upload`,
`/files`, `/files/<id>`) and the share endpoint (`/s/*`) alike.
**When it is unset, all requests are allowed.** The client IP is read from the
second-to-last `X-Forwarded-For` entry, which is the value Lambda Function URLs
append.

### 9. Configure the CLI

```bash
tim setup
# API endpoint [https://api.timothy.example.com]: https://xxxxxxxxxxxx.lambda-url.ap-northeast-1.on.aws
```

The web UI needs CORS configured on the storage bucket here too, same as the
Cloud Run setup — this is independent of the compute layer. See
[Storage bucket CORS](#storage-bucket-cors) above.

### Infrastructure Overview

| Component | Config |
|---|---|
| Lambda | Container image (`Dockerfile.lambda`), Function URL (no auth) |
| Cloud Storage | Firebase Cloud Storage; proxied through Lambda |
| Firestore | Firebase Firestore; shared with Cloud Run setup |
| Auth | **None at the application level.** Optional `ALLOWED_IPS` allowlist covering the web UI, management endpoints, and share URLs alike; unset means anyone with the URL can list, upload, and delete |

## License

EPL-2.0
