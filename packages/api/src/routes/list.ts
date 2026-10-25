import { Hono } from "hono";
import { getUser, type AppEnv } from "../lib/auth.js";
import { listFiles, resolveBaseUrl } from "../lib/files.js";

const app = new Hono<AppEnv>();

app.get("/", async (c) => {
  const owner = c.req.query("owner");
  // "me" 以外を黙って無視すると、他人のメールアドレスで絞ったつもりが全件が返ってしまう。
  // 任意のアドレスでの絞り込みは用意していないので、はっきり拒否する。
  if (owner !== undefined && owner !== "me") {
    return c.json({ error: 'owner must be "me"' }, 400);
  }
  const files = await listFiles(
    resolveBaseUrl(c),
    owner === "me" ? { ownerEmail: getUser(c).email } : undefined
  );
  return c.json({ files });
});

export default app;
