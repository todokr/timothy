import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/firebase.js", () => ({
  db: { collection: vi.fn(), getAll: vi.fn() },
}));
vi.mock("../lib/storage.js", () => ({
  getFileContent: vi.fn(),
  isNotFoundError: (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === 404,
}));
// 埋め込みはモデルのロードを伴うので、抽出の検証には持ち込まない。
vi.mock("../lib/embeddings.js", () => ({ embed: vi.fn() }));
vi.mock("../lib/vectorSearch.js", () => ({ writeChunks: vi.fn() }));
vi.mock("../lib/files.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/files.js")>()),
  listFiles: vi.fn(),
}));

import app from "./indexing.js";
import { db } from "../lib/firebase.js";
import { getFileContent } from "../lib/storage.js";
import { listFiles } from "../lib/files.js";
import { embed } from "../lib/embeddings.js";
import { writeChunks } from "../lib/vectorSearch.js";
import { HTML_FILE_TEXTS_COLLECTION } from "../lib/textIndex.js";
import { CURRENT_EXTRACTOR_VERSION } from "../lib/htmlText.js";

/** @google-cloud/storage が投げるのは code 付きの Error なので、それに合わせる。 */
function storageError(code: number): Error {
  return Object.assign(new Error(`storage ${code}`), { code });
}

function future(): Date {
  return new Date(Date.now() + 86_400_000);
}
function past(): Date {
  return new Date(Date.now() - 86_400_000);
}

/** htmlFiles / htmlFileTexts の両方に応える collection モックを組む。 */
function mockCollections(options: {
  file?: { storagePath: string; expiresAt: Date } | null;
}) {
  const setMock = vi.fn().mockResolvedValue(undefined);
  const fileGet = vi.fn().mockResolvedValue(
    options.file
      ? {
          exists: true,
          data: () => ({
            storagePath: options.file.storagePath,
            expiresAt: { toDate: () => options.file!.expiresAt },
          }),
        }
      : { exists: false },
  );

  vi.mocked(db.collection).mockImplementation((name: string) => {
    if (name === HTML_FILE_TEXTS_COLLECTION) {
      return {
        doc: vi.fn().mockReturnValue({ set: setMock, delete: vi.fn() }),
      } as unknown as ReturnType<typeof db.collection>;
    }
    return {
      doc: vi.fn().mockReturnValue({ get: fileGet }),
    } as unknown as ReturnType<typeof db.collection>;
  });

  return { setMock };
}

describe("POST /:id/index", () => {
  beforeEach(() => {
    vi.mocked(db.collection).mockReset();
    vi.mocked(getFileContent).mockReset();
    vi.mocked(embed).mockReset();
    vi.mocked(writeChunks).mockReset();
    vi.mocked(embed).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts the body text and writes it to htmlFileTexts", async () => {
    const { setMock } = mockCollections({
      file: { storagePath: "timothy-files/01ABC.html", expiresAt: future() },
    });
    vi.mocked(getFileContent).mockResolvedValue(
      "<html><head><title>月次レポート</title></head><body><p>売上は増加</p><script>var x=1</script></body></html>",
    );

    const res = await app.request("/01ABC/index", { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "01ABC" });

    const saved = setMock.mock.calls[0][0];
    expect(saved.text).toBe("売上は増加");
    expect(saved.text).not.toContain("var x");
    expect(saved.extractorVersion).toBe(CURRENT_EXTRACTOR_VERSION);
    // TTL ポリシーで自動削除させるため親から複製している。
    expect(saved.expiresAt).toBeInstanceOf(Date);
    // 読まれないフィールドは書かない。
    expect(Object.keys(saved).sort()).toEqual([
      "expiresAt",
      "extractorVersion",
      "text",
    ]);
  });

<<<<<<< HEAD
  // 無期限ファイルは expiresAt が null で保存される。Firestore の data は any なので
  // 型検査では捕まらず、toDate() を無条件に呼ぶと 500 になる。
  it("indexes a file stored with no expiry", async () => {
    const setMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.collection).mockImplementation((name: string) => {
      if (name === HTML_FILE_TEXTS_COLLECTION) {
        return {
          doc: vi.fn().mockReturnValue({ set: setMock, delete: vi.fn() }),
        } as unknown as ReturnType<typeof db.collection>;
      }
      return {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              storagePath: "timothy-files/01ABC.html",
              expiresAt: null,
            }),
          }),
        }),
      } as unknown as ReturnType<typeof db.collection>;
    });
    vi.mocked(getFileContent).mockResolvedValue("<p>無期限の本文</p>");

    const res = await app.request("/01ABC/index", { method: "POST" });

    expect(res.status).toBe(200);
    // TTL ポリシーの対象外にするため null のまま複製する。
    expect(setMock.mock.calls[0][0].expiresAt).toBeNull();
=======
  it("stores a vector per chunk when the model is available", async () => {
    mockCollections({
      file: { storagePath: "timothy-files/01ABC.html", expiresAt: future() },
    });
    vi.mocked(getFileContent).mockResolvedValue("<p>本文</p>");
    vi.mocked(embed).mockResolvedValue([[0.1, 0.2]]);

    await app.request("/01ABC/index", { method: "POST" });

    expect(writeChunks).toHaveBeenCalledWith(
      "01ABC",
      ["本文"],
      [[0.1, 0.2]],
      expect.any(Date),
    );
  });

  it("still reports success when the model is unavailable", async () => {
    mockCollections({
      file: { storagePath: "timothy-files/01ABC.html", expiresAt: future() },
    });
    vi.mocked(getFileContent).mockResolvedValue("<p>本文</p>");
    vi.mocked(embed).mockResolvedValue(null);

    const res = await app.request("/01ABC/index", { method: "POST" });

    // キーワード検索は成立するので、埋め込み失敗で取り込みを失敗扱いにしない。
    expect(res.status).toBe(200);
    expect(writeChunks).not.toHaveBeenCalled();
>>>>>>> 9f54ab0 (feat(api): add semantic search and fuse it with keyword hits)
  });

  it("returns 404 when the file record does not exist", async () => {
    mockCollections({ file: null });
    const res = await app.request("/missing/index", { method: "POST" });
    expect(res.status).toBe(404);
    expect(getFileContent).not.toHaveBeenCalled();
  });

  it("returns 410 for an expired file", async () => {
    mockCollections({
      file: { storagePath: "timothy-files/01ABC.html", expiresAt: past() },
    });
    const res = await app.request("/01ABC/index", { method: "POST" });
    expect(res.status).toBe(410);
    expect(getFileContent).not.toHaveBeenCalled();
  });

  it("returns 409, not 500, for an orphan record whose object was never uploaded", async () => {
    mockCollections({
      file: { storagePath: "timothy-files/01ABC.html", expiresAt: future() },
    });
    vi.mocked(getFileContent).mockRejectedValue(storageError(404));

    const res = await app.request("/01ABC/index", { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("propagates unexpected storage errors", async () => {
    mockCollections({
      file: { storagePath: "timothy-files/01ABC.html", expiresAt: future() },
    });
    vi.mocked(getFileContent).mockRejectedValue(storageError(500));

    const res = await app.request("/01ABC/index", { method: "POST" });
    expect(res.status).toBe(500);
  });
});

describe("POST /reindex", () => {
  beforeEach(() => {
    vi.mocked(db.collection).mockReset();
    vi.mocked(db.getAll).mockReset();
    vi.mocked(getFileContent).mockReset();
    vi.mocked(listFiles).mockReset();
    vi.mocked(embed).mockReset();
    vi.mocked(embed).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function entry(id: string, expiresAt: Date) {
    return {
      id,
      title: id,
      description: "",
      url: `http://localhost/s/${id}`,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    };
  }

  it("indexes only the files that have no text yet", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry("indexed", future()),
      entry("pending", future()),
    ]);
    vi.mocked(db.getAll).mockResolvedValue([
      {
        id: "indexed",
        exists: true,
        data: () => ({ extractorVersion: CURRENT_EXTRACTOR_VERSION }),
      },
      { id: "pending", exists: false },
    ] as never);
    mockCollections({
      file: { storagePath: "timothy-files/pending.html", expiresAt: future() },
    });
    vi.mocked(getFileContent).mockResolvedValue("<p>body</p>");

    const res = await app.request("/reindex", { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ indexed: 1, failed: 0, remaining: 0 });
    expect(getFileContent).toHaveBeenCalledTimes(1);
  });

  it("skips expired files entirely", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry("old", past())]);
    vi.mocked(db.getAll).mockResolvedValue([] as never);
    mockCollections({ file: null });

    const res = await app.request("/reindex", { method: "POST" });

    expect(await res.json()).toEqual({ indexed: 0, failed: 0, remaining: 0 });
    expect(db.getAll).not.toHaveBeenCalled();
  });

  it("treats a stale extractorVersion as pending", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry("stale", future())]);
    vi.mocked(db.getAll).mockResolvedValue([
      {
        id: "stale",
        exists: true,
        data: () => ({ extractorVersion: CURRENT_EXTRACTOR_VERSION - 1 }),
      },
    ] as never);
    mockCollections({
      file: { storagePath: "timothy-files/stale.html", expiresAt: future() },
    });
    vi.mocked(getFileContent).mockResolvedValue("<p>body</p>");

    const res = await app.request("/reindex", { method: "POST" });

    expect(await res.json()).toEqual({ indexed: 1, failed: 0, remaining: 0 });
  });

  it("caps a batch at 10 and reports the remainder", async () => {
    const ids = Array.from({ length: 13 }, (_, i) => `f${i}`);
    vi.mocked(listFiles).mockResolvedValue(ids.map((id) => entry(id, future())));
    vi.mocked(db.getAll).mockResolvedValue(
      ids.map((id) => ({ id, exists: false })) as never,
    );
    mockCollections({
      file: { storagePath: "timothy-files/f.html", expiresAt: future() },
    });
    vi.mocked(getFileContent).mockResolvedValue("<p>body</p>");

    const res = await app.request("/reindex", { method: "POST" });

    expect(await res.json()).toEqual({ indexed: 10, failed: 0, remaining: 3 });
  });

  it("counts a broken file as failed without aborting the batch", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry("broken", future()),
      entry("good", future()),
    ]);
    vi.mocked(db.getAll).mockResolvedValue([
      { id: "broken", exists: false },
      { id: "good", exists: false },
    ] as never);
    mockCollections({
      file: { storagePath: "timothy-files/x.html", expiresAt: future() },
    });
    vi.mocked(getFileContent)
      .mockRejectedValueOnce(storageError(404))
      .mockResolvedValueOnce("<p>body</p>");

    const res = await app.request("/reindex", { method: "POST" });

    expect(await res.json()).toEqual({ indexed: 1, failed: 1, remaining: 0 });
  });
});
