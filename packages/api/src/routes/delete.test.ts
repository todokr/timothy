import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/firebase.js", () => ({
  db: { collection: vi.fn(), recursiveDelete: vi.fn() },
}));

// deleteFile だけ差し替え、isNotFoundError は本物の判定を使う。
vi.mock("../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/storage.js")>()),
  deleteFile: vi.fn(),
  deleteFilesWithPrefix: vi.fn(),
}));

import deleteApp from "./delete.js";
import { TEST_USER, withUser } from "../test/auth.js";

const app = withUser(deleteApp);
import { db } from "../lib/firebase.js";
import { deleteFile, deleteFilesWithPrefix } from "../lib/storage.js";

function mockDoc(
  exists: boolean,
  storagePath = "timothy-files/01ABC.html",
  extra: Record<string, unknown> = {}
) {
  const docRef = {
    get: vi.fn().mockResolvedValue({
      exists,
      data: () => ({ storagePath, ...extra }),
    }),
  };
  vi.mocked(db.collection).mockReturnValue({
    doc: vi.fn().mockReturnValue(docRef),
  } as unknown as ReturnType<typeof db.collection>);
  return { docRef };
}

function request(id: string) {
  return app.request(`/${id}`, { method: "DELETE" });
}

describe("DELETE /files/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deleteFile).mockResolvedValue(undefined);
    vi.mocked(deleteFilesWithPrefix).mockResolvedValue(undefined);
    vi.mocked(db.recursiveDelete).mockResolvedValue(undefined);
  });

  it("returns 404 when the record does not exist", async () => {
    mockDoc(false);
    const res = await request("01MISSING");
    expect(res.status).toBe(404);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("refuses to delete someone else's file and touches nothing", async () => {
    mockDoc(true, "timothy-files/01ABC.html", { ownerEmail: "other@example.com" });
    const res = await request("01ABC");

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(deleteFile).not.toHaveBeenCalled();
    expect(deleteFilesWithPrefix).not.toHaveBeenCalled();
    expect(db.recursiveDelete).not.toHaveBeenCalled();
  });

  it("deletes your own file", async () => {
    const { docRef } = mockDoc(true, "timothy-files/01ABC.html", { ownerEmail: TEST_USER.email });
    const res = await request("01ABC");

    expect(res.status).toBe(200);
    expect(deleteFile).toHaveBeenCalledOnce();
    expect(db.recursiveDelete).toHaveBeenCalledWith(docRef);
  });

  it("deletes a legacy file without an owner", async () => {
    const { docRef } = mockDoc(true);
    const res = await request("01ABC");

    expect(res.status).toBe(200);
    expect(db.recursiveDelete).toHaveBeenCalledWith(docRef);
  });

  it("deletes every version's object and the versions subcollection", async () => {
    const { docRef } = mockDoc(true, "timothy-files/01ABC.html", { ownerEmail: TEST_USER.email, latestVersion: 3 });
    const res = await request("01ABC");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "01ABC" });
    expect(deleteFile).toHaveBeenCalledWith("timothy-files/01ABC.html");
    expect(deleteFilesWithPrefix).toHaveBeenCalledWith("timothy-files/01ABC/");
    expect(db.recursiveDelete).toHaveBeenCalledWith(docRef);
  });

  // アップロードは Firestore への書き込みが先で GCS への PUT が後なので、
  // PUT が失敗すると保存先のオブジェクトが無いレコードが残る。
  // それを一覧から削除できないと、ユーザーは手詰まりになる。
  it("removes the record even when the stored object is already gone", async () => {
    const { docRef } = mockDoc(true);
    const notFound = Object.assign(new Error("No such object"), { code: 404 });
    vi.mocked(deleteFile).mockRejectedValue(notFound);

    const res = await request("01ORPHAN");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "01ORPHAN" });
    expect(db.recursiveDelete).toHaveBeenCalledWith(docRef);
  });

  it("propagates storage failures that are not a missing object", async () => {
    mockDoc(true);
    const denied = Object.assign(new Error("Permission denied"), { code: 403 });
    vi.mocked(deleteFile).mockRejectedValue(denied);

    const res = await request("01DENIED");

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(db.recursiveDelete).not.toHaveBeenCalled();
  });
});
