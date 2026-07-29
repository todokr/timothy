import { Hono } from "hono";
import { db } from "../lib/firebase.js";
import { deleteFile } from "../lib/storage.js";

const HTML_FILES_COLLECTION = "htmlFiles";

const app = new Hono();

app.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const docRef = db.collection(HTML_FILES_COLLECTION).doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    return c.json({ error: "Not Found" }, 404);
  }

  const data = doc.data()!;
  await deleteFile(data.storagePath);
  await docRef.delete();

  return c.json({ id });
});

export default app;
