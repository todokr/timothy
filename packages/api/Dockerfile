FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/api/package.json ./packages/api/
RUN pnpm install --filter @timothy/api --frozen-lockfile
COPY packages/api/ ./packages/api/
RUN pnpm --filter @timothy/api build
RUN pnpm deploy --filter @timothy/api --prod --legacy /app/deploy && \
    rm -rf /app/deploy/src /app/deploy/scripts

# モデルの重みをイメージに焼き込む。コールドスタート時に huggingface.co を
# 取りに行かせない（遅いうえ egress 制限のある環境で壊れる）。
ENV EMBEDDING_CACHE_DIR=/model-cache
RUN cd /app/deploy && node --input-type=module -e "\
import {env,pipeline} from '@huggingface/transformers';\
env.cacheDir='/model-cache';\
await pipeline('feature-extraction','hotchpotch/bekko-embedding-v1-a8m',{dtype:'fp32'});"

# onnxruntime-node のプリビルドは glibc リンクなので alpine (musl) では
# ロードに失敗する。埋め込みをこのプロセスで動かすため slim を使う。
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV EMBEDDING_CACHE_DIR=/model-cache
COPY --from=builder /model-cache /model-cache
COPY --from=builder /app/deploy .
EXPOSE 8080
CMD ["node", "dist/server.js"]
