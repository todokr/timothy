import { Hono } from "hono";
import { accessLogMiddleware } from "./lib/accessLog.js";
import { ipAllowlistMiddleware } from "./lib/ipAllowlist.js";
import { requireUser, type AppEnv } from "./lib/auth.js";
import authRoute from "./routes/auth.js";
import uploadRoute from "./routes/upload.js";
import listRoute from "./routes/list.js";
import deleteRoute from "./routes/delete.js";
import versionsRoute from "./routes/versions.js";
import commentsRoute from "./routes/comments.js";
import headersRoute from "./routes/headers.js";
import serveRoute from "./routes/serve.js";
import viewerRoute from "./routes/viewer.js";
import webRoute from "./routes/web.js";

const app = new Hono<AppEnv>();

app.use("*", accessLogMiddleware);
app.use("/", ipAllowlistMiddleware);
app.use("/upload", ipAllowlistMiddleware);
app.use("/files", ipAllowlistMiddleware);
app.use("/files/*", ipAllowlistMiddleware);
app.use("/s/*", ipAllowlistMiddleware);
app.use("/auth/*", ipAllowlistMiddleware);

// 認証。ルートより先に登録しないとハンドラが先に応答してしまう。
// /files/:id/headers/edit はブラウザで開くページなので、/files/* の JSON 401 より先にリダイレクト側を置く
// （requireUser は user が決まっていれば何もしないので、両方に当たっても問題ない）。
// /auth/* と /health には掛けない（ログイン前に到達できる必要がある）。
app.use("/", requireUser("redirect"));
// 本体（iframe の中身）はリダイレクトできないので、/s/* の redirect より前に frame を置く
app.use("/s/:id/v/*", requireUser("frame"));
app.use("/s/*", requireUser("redirect"));
app.use("/files/:id/headers/edit", requireUser("redirect"));
app.use("/upload", requireUser("json"));
app.use("/files", requireUser("json"));
app.use("/files/*", requireUser("json"));

app.route("/auth", authRoute);

app.route("/upload", uploadRoute);
app.route("/files", listRoute);
app.route("/files", deleteRoute);
app.route("/files", versionsRoute);
app.route("/files", commentsRoute);
app.route("/files", headersRoute);
app.route("/s", serveRoute);
app.route("/s", viewerRoute);
app.route("/", webRoute);

app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
