import { describe, it, expect, afterAll } from "vitest";

import app from "../index.js";
import { db } from "../lib/firebase.js";
import { getBucket, uploadHtml } from "../lib/storage.js";
import { addSeconds, now } from "../lib/time.js";
import { HTML_FILE_TEXTS_COLLECTION, loadTexts } from "../lib/textIndex.js";
import {
  CURRENT_EXTRACTOR_VERSION,
  MAX_TEXT_BYTES,
} from "../lib/htmlText.js";

// Requires: firebase emulators:start --only firestore,storage

const createdIds: string[] = [];

async function seedFile(
  id: string,
  html: string | null,
  ttlSeconds = 86_400,
): Promise<void> {
  createdIds.push(id);
  const storagePath = `timothy-files/${id}.html`;
  await db.collection("htmlFiles").doc(id).set({
    title: id,
    description: "",
    storagePath,
    createdAt: now(),
    expiresAt: addSeconds(now(), ttlSeconds),
  });
  if (html !== null) await uploadHtml(storagePath, html);
}

function indexRequest(id: string) {
  return app.fetch(
    new Request(`http://localhost/files/${id}/index`, { method: "POST" }),
  );
}

describe("POST /files/:id/index (integration)", () => {
  afterAll(async () => {
    await Promise.all(
      createdIds.map(async (id) => {
        await db.collection("htmlFiles").doc(id).delete().catch(() => {});
        await db
          .collection(HTML_FILE_TEXTS_COLLECTION)
          .doc(id)
          .delete()
          .catch(() => {});
        await getBucket()
          .file(`timothy-files/${id}.html`)
          .delete()
          .catch(() => {});
      }),
    );
  });

  it("extracts the body text and stores it under the same id", async () => {
    const id = "itest-basic";
    await seedFile(
      id,
      "<html><head><title>統合テスト</title></head>" +
        "<body><p>売上は前月比で増加した</p><script>var hidden=1</script></body></html>",
    );

    const res = await indexRequest(id);
    expect(res.status).toBe(200);

    const stored = await db
      .collection(HTML_FILE_TEXTS_COLLECTION)
      .doc(id)
      .get();
    expect(stored.exists).toBe(true);
    const data = stored.data()!;
    expect(data.text).toBe("売上は前月比で増加した");
    expect(data.text).not.toContain("hidden");
    // TTL ポリシーで自動削除させるため親から複製している。
    expect(data.expiresAt.toDate()).toBeInstanceOf(Date);

    // 取り込みの状態は一覧から見えるよう親ドキュメントに立てる。
    const file = (await db.collection("htmlFiles").doc(id).get()).data()!;
    expect(file.extractorVersion).toBe(CURRENT_EXTRACTOR_VERSION);
    expect(file.textLength).toBe("売上は前月比で増加した".length);
    expect(file.chunkCount).toBeGreaterThan(0);
  });

  it("is idempotent — re-indexing overwrites in place", async () => {
    const id = "itest-idempotent";
    await seedFile(id, "<p>first</p>");
    await indexRequest(id);

    await uploadHtml(`timothy-files/${id}.html`, "<p>second</p>");
    const res = await indexRequest(id);
    expect(res.status).toBe(200);

    const stored = await db
      .collection(HTML_FILE_TEXTS_COLLECTION)
      .doc(id)
      .get();
    expect(stored.data()!.text).toBe("second");
  });

  // 注意: エミュレータはインデックスエントリのサイズ上限を検証しないため
  // （fieldOverrides を外しても通る）、このテストは
  // firestore.indexes.json の除外設定が効いていることの証明にはならない。
  // 確認できるのは書き込み経路と切り詰めの挙動まで。
  it("writes a text right up against the byte cap", async () => {
    const id = "itest-large";
    // 日本語は UTF-8 で 3 バイト/文字なので、10 万文字は上限を超えて切られる。
    await seedFile(id, `<p>${"あ".repeat(100_000)}</p>`);

    const res = await indexRequest(id);
    expect(res.status).toBe(200);

    const stored = await db
      .collection(HTML_FILE_TEXTS_COLLECTION)
      .doc(id)
      .get();
    const bytes = new TextEncoder().encode(stored.data()!.text).length;
    expect(bytes).toBeLessThanOrEqual(MAX_TEXT_BYTES);
    // 上限ぎりぎりまで詰まっている＝大きな文字列を実際に書けている。
    expect(bytes).toBeGreaterThan(MAX_TEXT_BYTES - 4);
  });

  it("returns 409 for an orphan record whose object was never uploaded", async () => {
    const id = "itest-orphan";
    await seedFile(id, null);

    const res = await indexRequest(id);
    expect(res.status).toBe(409);
  });

  it("returns 410 for an expired file", async () => {
    const id = "itest-expired";
    await seedFile(id, "<p>body</p>", -60);

    const res = await indexRequest(id);
    expect(res.status).toBe(410);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await indexRequest("itest-nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("loadTexts (integration)", () => {
  // 先行する describe の afterAll が走った後なので、自分でシードする。
  it("returns the stored text and skips ids that have none", async () => {
    const id = "itest-load";
    await seedFile(id, "<p>読み込み確認</p>");
    await indexRequest(id);

    const texts = await loadTexts([id, "itest-never-indexed"]);
    expect(texts.get(id)).toBe("読み込み確認");
    expect(texts.has("itest-never-indexed")).toBe(false);
  });
});

describe("DELETE /files/:id (integration)", () => {
  it("removes the extracted text along with the record", async () => {
    const id = "itest-delete";
    await seedFile(id, "<p>body</p>");
    await indexRequest(id);
    expect(
      (await db.collection(HTML_FILE_TEXTS_COLLECTION).doc(id).get()).exists,
    ).toBe(true);

    const res = await app.fetch(
      new Request(`http://localhost/files/${id}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(200);

    // Firestore はカスケード削除しないので、明示的に消せているかを見る。
    expect(
      (await db.collection(HTML_FILE_TEXTS_COLLECTION).doc(id).get()).exists,
    ).toBe(false);
  });
});
