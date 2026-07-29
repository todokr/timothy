import { Hono } from "hono";
import { db } from "../lib/firebase.js";

const HTML_FILES_COLLECTION = "htmlFiles";

const app = new Hono();

app.get("/", async (c) => {
  const snapshot = await db
    .collection(HTML_FILES_COLLECTION)
    .orderBy("createdAt", "desc")
    .get();

  const proto = c.req.header("x-forwarded-proto") ?? "http";
  const host = c.req.header("host") ?? "localhost";

  const files = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      title: data.title,
      description: data.description,
      url: `${proto}://${host}/s/${doc.id}`,
      expiresAt: data.expiresAt.toDate().toISOString(),
      createdAt: data.createdAt.toDate().toISOString(),
    };
  });

  return c.json({ files });
});

export default app;
