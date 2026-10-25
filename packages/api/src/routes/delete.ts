import { Hono } from "hono";
import { getUser, type AppEnv } from "../lib/auth.js";
import { canManage } from "../lib/ownership.js";
import { db } from "../lib/firebase.js";
import { deleteFile, isNotFoundError } from "../lib/storage.js";

const HTML_FILES_COLLECTION = "htmlFiles";

const app = new Hono<AppEnv>();

app.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const docRef = db.collection(HTML_FILES_COLLECTION).doc(id);
  const doc = await docRef.get();

  if (!doc.exists) {
    return c.json({ error: "Not Found" }, 404);
  }

  const data = doc.data()!;

  // Storage を消してからでは取り消せないので、権限の確認は最初の削除より前に置く
  if (!canManage(getUser(c), data)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  // アップロードは Firestore への書き込みが先で GCS への PUT が後なので、
  // PUT が失敗すると保存先のオブジェクトが無いレコードが残る。
  // それを削除できないとユーザーが手詰まりになるため、404 は無視して
  // レコードの削除まで進める。
  try {
    await deleteFile(data.storagePath);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  await docRef.delete();

  return c.json({ id });
});

export default app;
