import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { EMBEDDING_MODEL, embedOne } from "./embeddings.js";

/** チャンクとベクトル。doc ID は `${fileId}_${4桁のチャンク番号}` で決定的。 */
export const HTML_FILE_CHUNKS_COLLECTION = "htmlFileChunks";

/**
 * findNearest は不等式を事前フィルタに使えないので、期限切れと削除済みは
 * 多めに取ってからアプリ側で落とす。TTL ポリシーが実際の掃除を担当し、
 * こちらはその削除ラグに対する保険になる。
 */
const OVER_FETCH = 60;

export type VectorHit = { fileId: string; text: string; distance: number };

export function chunkDocId(fileId: string, index: number): string {
  return `${fileId}_${String(index).padStart(4, "0")}`;
}

export async function writeChunks(
  fileId: string,
  chunks: string[],
  vectors: number[][],
  expiresAt: Date | null,
): Promise<void> {
  const collection = db.collection(HTML_FILE_CHUNKS_COLLECTION);
  const batch = db.batch();

  chunks.forEach((text, index) => {
    batch.set(collection.doc(chunkDocId(fileId, index)), {
      fileId,
      chunkIndex: index,
      text,
      embedding: FieldValue.vector(vectors[index]),
      // モデルを変えるとベクトルの意味が変わる。混在を検出できるようにしておく。
      model: EMBEDDING_MODEL,
      expiresAt,
    });
  });

  await batch.commit();
  // 再インデックスでチャンク数が減ったときに余りを掃除する。
  await deleteChunks(fileId, chunks.length);
}

/**
 * fileId の等価比較だけで引く（単一フィールドなので自動インデックスで足りる）。
 * chunkIndex との複合条件にすると複合インデックスが要るため、絞り込みは
 * 取得後にメモリ上で行う。1ファイルあたり最大 MAX_CHUNKS_PER_FILE 件しかない。
 */
export async function deleteChunks(
  fileId: string,
  fromIndex = 0,
): Promise<void> {
  const owned = await db
    .collection(HTML_FILE_CHUNKS_COLLECTION)
    .where("fileId", "==", fileId)
    .get();

  const stale = owned.docs.filter((doc) => doc.data().chunkIndex >= fromIndex);
  if (stale.length === 0) return;

  const batch = db.batch();
  stale.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

/** 意味の近いチャンクを引く。モデルが使えなければ null を返す。 */
export async function searchVectors(
  query: string,
  liveIds: Set<string>,
): Promise<VectorHit[] | null> {
  const vector = await embedOne(query);
  if (vector === null) return null;

  const snapshot = await db
    .collection(HTML_FILE_CHUNKS_COLLECTION)
    .findNearest({
      vectorField: "embedding",
      queryVector: FieldValue.vector(vector),
      limit: OVER_FETCH,
      distanceMeasure: "COSINE",
      distanceResultField: "vectorDistance",
    })
    .get();

  const hits: VectorHit[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!liveIds.has(data.fileId)) continue;
    // 別モデルで作られたベクトルは意味が違うので混ぜない。
    if (data.model !== EMBEDDING_MODEL) continue;
    hits.push({
      fileId: data.fileId,
      text: data.text,
      distance: data.vectorDistance,
    });
  }
  return hits;
}
