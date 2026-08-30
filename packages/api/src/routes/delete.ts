import { Hono } from "hono";
import { db } from "../lib/firebase.js";
import { deleteFile, isNotFoundError } from "../lib/storage.js";
import { deleteFileText } from "../lib/textIndex.js";
import { deleteChunks } from "../lib/vectorSearch.js";

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

  // Firestore はカスケード削除しない。消し忘れると削除済みファイルが
  // 検索結果に残り続ける。
  await deleteFileText(id);
  await deleteChunks(id);

  return c.json({ id });
});

export default app;
