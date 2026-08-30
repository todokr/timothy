import { describe, it, expect, afterAll } from "vitest";

import { db } from "./firebase.js";
import { addSeconds, now } from "./time.js";
import {
  HTML_FILE_CHUNKS_COLLECTION,
  chunkDocId,
  deleteChunks,
  searchVectors,
  writeChunks,
} from "./vectorSearch.js";
import { embed, EMBEDDING_DIM } from "./embeddings.js";

// Requires: firebase emulators:start --only firestore,storage
//
// findNearest は embedding が doc 直下にある場合のみエミュレータで動く
// (firebase-tools#8077 のバグはネストしたベクトルフィールドのみ)。
// このテストはその前提が崩れていないことも兼ねて確かめる。

const FILE_A = "vtest-sales";
const FILE_B = "vtest-dog";

const SALES = "今月の売上は前月比で12%増加した。営業利益も改善している。";
const DOG = "犬が公園で走っている。天気がよく散歩日和だ。";

afterAll(async () => {
  await Promise.all([deleteChunks(FILE_A), deleteChunks(FILE_B)]);
});

describe("embeddings", () => {
  it("produces unit vectors of the configured dimension", async () => {
    const vectors = await embed([SALES]);
    expect(vectors).not.toBeNull();
    expect(vectors![0]).toHaveLength(EMBEDDING_DIM);

    const norm = Math.sqrt(vectors![0].reduce((s, x) => s + x * x, 0));
    // L2 正規化済みなので、コサイン類似度がそのまま内積になる。
    expect(norm).toBeCloseTo(1, 5);
  });
});

describe("findNearest against the emulator", () => {
  it("ranks the semantically closer file first for a paraphrase", async () => {
    const expiresAt = addSeconds(now(), 86_400);
    const vectors = await embed([SALES, DOG]);
    expect(vectors).not.toBeNull();

    await writeChunks(FILE_A, [SALES], [vectors![0]], expiresAt);
    await writeChunks(FILE_B, [DOG], [vectors![1]], expiresAt);

    // 本文に出てこない言い換えで引く。キーワード一致では 0 件になる語。
    const hits = await searchVectors(
      "レベニューの伸び",
      new Set([FILE_A, FILE_B]),
    );

    expect(hits).not.toBeNull();
    expect(hits!.length).toBeGreaterThan(0);
    expect(hits![0].fileId).toBe(FILE_A);
    expect(hits![0].text).toBe(SALES);
    // 近いほど距離が小さい。
    const dog = hits!.find((h) => h.fileId === FILE_B);
    if (dog !== undefined) {
      expect(hits![0].distance).toBeLessThan(dog.distance);
    }
  });

  it("drops chunks whose file is no longer live", async () => {
    const hits = await searchVectors("レベニューの伸び", new Set([FILE_B]));
    expect(hits!.every((h) => h.fileId === FILE_B)).toBe(true);
  });

  it("writes one document per chunk under a deterministic id", async () => {
    const expiresAt = addSeconds(now(), 86_400);
    const chunks = ["ひとつめ", "ふたつめ", "みっつめ"];
    const vectors = await embed(chunks);
    await writeChunks(FILE_A, chunks, vectors!, expiresAt);

    const doc = await db
      .collection(HTML_FILE_CHUNKS_COLLECTION)
      .doc(chunkDocId(FILE_A, 1))
      .get();
    expect(doc.exists).toBe(true);
    expect(doc.data()!.text).toBe("ふたつめ");
    expect(doc.data()!.chunkIndex).toBe(1);
  });

  it("prunes leftover chunks when a re-index produces fewer of them", async () => {
    const expiresAt = addSeconds(now(), 86_400);
    const shorter = ["ひとつだけ"];
    await writeChunks(FILE_A, shorter, (await embed(shorter))!, expiresAt);

    // 前回3件書いたので、余った index 1,2 が消えていること。
    const leftover = await db
      .collection(HTML_FILE_CHUNKS_COLLECTION)
      .doc(chunkDocId(FILE_A, 1))
      .get();
    expect(leftover.exists).toBe(false);
  });

  it("removes every chunk of a file on delete", async () => {
    await deleteChunks(FILE_A);
    const remaining = await db
      .collection(HTML_FILE_CHUNKS_COLLECTION)
      .where("fileId", "==", FILE_A)
      .get();
    expect(remaining.empty).toBe(true);
  });
});
