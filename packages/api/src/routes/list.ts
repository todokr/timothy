import { Hono } from "hono";
import { listFiles, resolveBaseUrl } from "../lib/files.js";

const app = new Hono();

app.get("/", async (c) => {
  const files = await listFiles(resolveBaseUrl(c));
  return c.json({ files });
});

export default app;
