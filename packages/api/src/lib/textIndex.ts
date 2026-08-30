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
  const snapshot = await db.collection(HTML_FILES_COLLECTION).doc(id).get();
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
      extractorVersion: CURRENT_EXTRACTOR_VERSION,
      // TTL ポリシーで期限切れを自動削除させるため、親からコピーする。
      expiresAt,
    });

  // 埋め込みに失敗してもキーワード検索は成立するので、取り込み自体は成功扱いにする。
  const chunks = chunkText(text);
  const vectors = chunks.length === 0 ? [] : await embed(chunks);
  if (vectors !== null && vectors.length === chunks.length) {
    await writeChunks(id, chunks, vectors, expiresAt);
  }

  return { status: "indexed" };
}

export async function deleteFileText(id: string): Promise<void> {
  await db.collection(HTML_FILE_TEXTS_COLLECTION).doc(id).delete();
}

/**
 * getAll は存在しないドキュメントも exists: false で返すので、1回の呼び出しで
 * コーパスと未インデックスの ID が両方手に入る。古い extractorVersion も
 * 作り直し対象として pending に入れる。
 */
export async function loadTexts(
  ids: string[],
): Promise<{ texts: Map<string, string>; pending: string[] }> {
  const texts = new Map<string, string>();
  const pending: string[] = [];
  if (ids.length === 0) return { texts, pending };

  const refs = ids.map((id) =>
    db.collection(HTML_FILE_TEXTS_COLLECTION).doc(id),
  );

  for (const snapshot of await db.getAll(...refs)) {
    const data = snapshot.exists ? snapshot.data()! : null;
    if (data === null || (data.extractorVersion ?? 0) < CURRENT_EXTRACTOR_VERSION) {
      pending.push(snapshot.id);
      continue;
    }
    texts.set(snapshot.id, data.text ?? "");
  }

  return { texts, pending };
}
