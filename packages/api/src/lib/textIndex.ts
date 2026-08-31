import { db } from "./firebase.js";
import { HTML_FILES_COLLECTION } from "./files.js";
import { CURRENT_EXTRACTOR_VERSION, extractText } from "./htmlText.js";
import { getFileContent, isNotFoundError } from "./storage.js";
import { now } from "./time.js";
import { chunkText } from "./chunk.js";
import { embed } from "./embeddings.js";
import { writeChunks } from "./vectorSearch.js";

/**
 * 抽出済みテキストの置き場。サブコレクションにはしない。
 * listFiles() が htmlFiles を全件読むので、同じドキュメントに本文を置くと
 * 一覧表示のたびに全本文を転送することになる。
 */
export const HTML_FILE_TEXTS_COLLECTION = "htmlFileTexts";

export type IndexResult =
  | { status: "indexed" }
  | { status: "notFound" }
  | { status: "expired" }
  | { status: "objectMissing" };

/** ドキュメント ID がファイル ID と同じなので、何度呼んでも上書きになる。 */
export async function indexFile(id: string): Promise<IndexResult> {
  const fileRef = db.collection(HTML_FILES_COLLECTION).doc(id);
  const snapshot = await fileRef.get();
  if (!snapshot.exists) return { status: "notFound" };

  const data = snapshot.data()!;
  // null は無期限。TTL ポリシーの対象にもしないので、そのまま複製する。
  const expiresAt: Date | null = data.expiresAt ? data.expiresAt.toDate() : null;
  if (expiresAt !== null && expiresAt < now()) return { status: "expired" };

  let html: string;
  try {
    html = await getFileContent(data.storagePath);
  } catch (error) {
    // アップロードは Firestore への書き込みが先で GCS への PUT が後なので、
    // PUT が失敗するとオブジェクトの無いレコードが残る。リトライしても
    // 直らないので 500 にはしない。
    if (isNotFoundError(error)) return { status: "objectMissing" };
    throw error;
  }

  const text = extractText(html).text;

  await db
    .collection(HTML_FILE_TEXTS_COLLECTION)
    .doc(id)
    .set({
      text,
      // TTL ポリシーで期限切れを自動削除させるため、親からコピーする。
      expiresAt,
    });

  // 埋め込みに失敗してもキーワード検索は成立するので、取り込み自体は成功扱いにする。
  const chunks = chunkText(text);
  const vectors = chunks.length === 0 ? [] : await embed(chunks);
  const embedded = vectors !== null && vectors.length === chunks.length;
  if (embedded) {
    await writeChunks(id, chunks, vectors!, expiresAt);
  }

  // 状態は派生データを書き終えてから最後に立てる。途中で落ちても
  // 「未取り込み」と表示されるだけで、取り込み直せば直る。
  await fileRef.update({
    extractorVersion: CURRENT_EXTRACTOR_VERSION,
    textLength: text.length,
    chunkCount: embedded ? chunks.length : 0,
  });

  return { status: "indexed" };
}

export async function deleteFileText(id: string): Promise<void> {
  await db.collection(HTML_FILE_TEXTS_COLLECTION).doc(id).delete();
}

/** 取り込み済みファイルの本文をまとめて引く。状態の判定は listFiles 側が持つ。 */
export async function loadTexts(ids: string[]): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  if (ids.length === 0) return texts;

  const refs = ids.map((id) =>
    db.collection(HTML_FILE_TEXTS_COLLECTION).doc(id),
  );

  for (const snapshot of await db.getAll(...refs)) {
    if (snapshot.exists) texts.set(snapshot.id, snapshot.data()!.text ?? "");
  }

  return texts;
}
