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

FROM node:22-alpine AS runner
# base image 同梱の zlib は脆弱性のある版 (1.3.2-r0) で止まっているため上げる。
# base image が r1 以上を同梱したらこの行は不要になるので削除してよい
RUN apk upgrade --no-cache zlib
# 実行には node しか使わないので、脆弱性の検出元になるパッケージマネージャを削除する
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/lib/node_modules/corepack /usr/local/bin/corepack \
    /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/deploy .
EXPOSE 8080
CMD ["node", "dist/server.js"]
