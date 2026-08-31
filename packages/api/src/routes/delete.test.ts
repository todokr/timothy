import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/firebase.js", () => ({
  db: { collection: vi.fn() },
}));

// deleteFile だけ差し替え、isNotFoundError は本物の判定を使う。
vi.mock("../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/storage.js")>()),
  deleteFile: vi.fn(),
}));

vi.mock("../lib/vectorSearch.js", () => ({ deleteChunks: vi.fn() }));

import app from "./delete.js";
import { db } from "../lib/firebase.js";
import { deleteFile } from "../lib/storage.js";
import { HTML_FILE_TEXTS_COLLECTION } from "../lib/textIndex.js";
import { deleteChunks } from "../lib/vectorSearch.js";

/**
 * htmlFiles と htmlFileTexts を別々のモックで返す。
 * Firestore はカスケード削除をしないので、どちらも消えることを個別に確かめる。
 */
function mockDoc(exists: boolean, storagePath = "timothy-files/01ABC.html") {
  const deleteMock = vi.fn().mockResolvedValue(undefined);
  const deleteTextMock = vi.fn().mockResolvedValue(undefined);
  const docRef = {
    get: vi.fn().mockResolvedValue({
      exists,
      data: () => ({ storagePath }),
    }),
    delete: deleteMock,
  };
  vi.mocked(db.collection).mockImplementation((name: string) => {
    if (name === HTML_FILE_TEXTS_COLLECTION) {
      return {
        doc: vi.fn().mockReturnValue({ delete: deleteTextMock }),
      } as unknown as ReturnType<typeof db.collection>;
    }
    return {
      doc: vi.fn().mockReturnValue(docRef),
    } as unknown as ReturnType<typeof db.collection>;
  });
  return { docRef, deleteMock, deleteTextMock };
}

function request(id: string) {
  return app.request(`/${id}`, { method: "DELETE" });
}

describe("DELETE /files/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deleteFile).mockResolvedValue(undefined);
  });

  it("returns 404 when the record does not exist", async () => {
    mockDoc(false);
    const res = await request("01MISSING");
    expect(res.status).toBe(404);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("deletes the stored object, the record and the extracted text", async () => {
    const { deleteMock, deleteTextMock } = mockDoc(true);
    const res = await request("01ABC");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "01ABC" });
    expect(deleteFile).toHaveBeenCalledWith("timothy-files/01ABC.html");
    expect(deleteMock).toHaveBeenCalledOnce();
    // 消し忘れると削除済みファイルが検索結果に残り続ける。
    expect(deleteTextMock).toHaveBeenCalledOnce();
    expect(deleteChunks).toHaveBeenCalledWith("01ABC");
  });

  // アップロードは Firestore への書き込みが先で GCS への PUT が後なので、
  // PUT が失敗すると保存先のオブジェクトが無いレコードが残る。
  // それを一覧から削除できないと、ユーザーは手詰まりになる。
  it("removes the record even when the stored object is already gone", async () => {
    const { deleteMock } = mockDoc(true);
    const notFound = Object.assign(new Error("No such object"), { code: 404 });
    vi.mocked(deleteFile).mockRejectedValue(notFound);

    const res = await request("01ORPHAN");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "01ORPHAN" });
    expect(deleteMock).toHaveBeenCalledOnce();
  });

  it("propagates storage failures that are not a missing object", async () => {
    const { deleteMock, deleteTextMock } = mockDoc(true);
    const denied = Object.assign(new Error("Permission denied"), { code: 403 });
    vi.mocked(deleteFile).mockRejectedValue(denied);

    const res = await request("01DENIED");

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(deleteTextMock).not.toHaveBeenCalled();
  });
});
