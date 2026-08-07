import { Hono } from "hono";
import { accessLogMiddleware } from "./lib/accessLog.js";
import { ipAllowlistMiddleware } from "./lib/ipAllowlist.js";
import uploadRoute from "./routes/upload.js";
import listRoute from "./routes/list.js";
import deleteRoute from "./routes/delete.js";
import serveRoute from "./routes/serve.js";
import webRoute from "./routes/web.js";

const app = new Hono();

app.use("*", accessLogMiddleware);
app.use("/", ipAllowlistMiddleware);
app.use("/upload", ipAllowlistMiddleware);
app.use("/files", ipAllowlistMiddleware);
app.use("/files/*", ipAllowlistMiddleware);
app.use("/s/*", ipAllowlistMiddleware);

app.route("/upload", uploadRoute);
app.route("/files", listRoute);
app.route("/files", deleteRoute);
app.route("/s", serveRoute);
app.route("/", webRoute);

app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
