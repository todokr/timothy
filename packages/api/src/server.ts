import { serve } from "@hono/node-server";
import app from "./index.js";
import { logger } from "./lib/logger.js";
import { assertAuthConfig } from "./lib/authConfig.js";

// 認証の設定漏れはリクエスト時ではなく起動時に気付けるよう、ここで落とす
assertAuthConfig();

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  logger.info(`Server running on http://localhost:${port}`);
});
