import { handle } from "hono/aws-lambda";
import app from "./index.js";
import { assertAuthConfig } from "./lib/authConfig.js";

// 認証の設定漏れはリクエスト時ではなく起動時に気付けるよう、ここで落とす
assertAuthConfig();

export const handler = handle(app);
