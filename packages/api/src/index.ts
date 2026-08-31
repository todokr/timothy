import { Hono } from "hono";
import { accessLogMiddleware } from "./lib/accessLog.js";
import { ipAllowlistMiddleware } from "./lib/ipAllowlist.js";
import uploadRoute from "./routes/upload.js";
import listRoute from "./routes/list.js";
import indexingRoute from "./routes/indexing.js";
import searchRoute from "./routes/search.js";
import deleteRoute from "./routes/delete.js";
import headersRoute from "./routes/headers.js";
import serveRoute from "./routes/serve.js";
import webRoute from "./routes/web.js";

const app = new Hono();

app.use("*", accessLogMiddleware);
app.use("/", ipAllowlistMiddleware);
app.use("/upload", ipAllowlistMiddleware);
app.use("/files", ipAllowlistMiddleware);
app.use("/files/*", ipAllowlistMiddleware);
app.use("/search", ipAllowlistMiddleware);
app.use("/s/*", ipAllowlistMiddleware);

app.route("/upload", uploadRoute);
app.route("/files", listRoute);
app.route("/files", deleteRoute);
app.route("/files", headersRoute);
app.route("/files", indexingRoute);
app.route("/search", searchRoute);
app.route("/s", serveRoute);
app.route("/", webRoute);

app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
