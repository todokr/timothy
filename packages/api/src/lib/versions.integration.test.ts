import { describe, it, expect, afterAll } from "vitest";
import { ulid } from "ulid";
import { db } from "./firebase.js";
import { getBucket } from "./storage.js";
import { HTML_FILES_COLLECTION } from "./files.js";
import { now } from "./time.js";
import { TEST_USER } from "../test/auth.js";
import {
  commitRevision,
  getVersion,
  listVersions,
  revisionPrefix,
  revisionStoragePath,
} from "./versions.js";

// Requires: firebase emulators:start --only firestore,storage

describe("commitRevision (integration)", () => {
  const fileIds: string[] = [];

  afterAll(async () => {
    await Promise.all(
      fileIds.map(async (id) => {
        const ref = db.collection(HTML_FILES_COLLECTION).doc(id);
        await db.recursiveDelete(ref).catch(() => {});
        await getBucket().deleteFiles({ prefix: revisionPrefix(id) }).catch(() => {});
      })
    );
  });

  async function setup(ownerEmail: string = TEST_USER.email) {
    const fileId = ulid();
    fileIds.push(fileId);
    const parentRef = db.collection(HTML_FILES_COLLECTION).doc(fileId);
    await parentRef.set({
      title: "T",
      description: "D",
      storagePath: `timothy-files/${fileId}.html`,
      createdAt: now(),
      expiresAt: null,
      ownerEmail,
      ownerName: "Owner",
    });
    return { fileId, parentRef };
  }

  async function putRevision(fileId: string, uploadId = ulid()) {
    await getBucket().file(revisionStoragePath(fileId, uploadId)).save("<p>rev</p>");
    return uploadId;
  }

  it("assigns v2 to the first revision and updates latestVersion", async () => {
    const { fileId, parentRef } = await setup();
    const uploadId = await putRevision(fileId);

    expect(await commitRevision({ fileId, uploadId, user: TEST_USER })).toEqual({ ok: true, version: 2 });
    expect((await parentRef.get()).data()!.latestVersion).toBe(2);
    const v2 = await getVersion(fileId, (await parentRef.get()).data()!, 2);
    expect(v2!.storagePath).toBe(revisionStoragePath(fileId, uploadId));
    expect(v2!.uploader).toEqual({ email: TEST_USER.email, name: TEST_USER.name });
  });

  it("refuses to commit when the content was never uploaded", async () => {
    const { fileId, parentRef } = await setup();

    expect(await commitRevision({ fileId, uploadId: ulid(), user: TEST_USER })).toEqual({
      ok: false,
      reason: "content_missing",
    });
    expect((await parentRef.get()).data()!.latestVersion).toBeUndefined();
  });

  it("returns the same version when the same upload is committed twice", async () => {
    const { fileId, parentRef } = await setup();
    const uploadId = await putRevision(fileId);

    const first = await commitRevision({ fileId, uploadId, user: TEST_USER });
    const second = await commitRevision({ fileId, uploadId, user: TEST_USER });
    expect(second).toEqual(first);
    expect((await parentRef.collection("versions").get()).size).toBe(1);
  });

  it("gives concurrent revisions distinct sequential numbers", async () => {
    const { fileId, parentRef } = await setup();
    const ids = await Promise.all([putRevision(fileId), putRevision(fileId), putRevision(fileId)]);

    const results = await Promise.all(
      ids.map((id) => commitRevision({ fileId, uploadId: id, user: TEST_USER }))
    );
    expect(results.map((r) => (r.ok ? r.version : 0)).sort()).toEqual([2, 3, 4]);
    expect((await parentRef.get()).data()!.latestVersion).toBe(4);
  });

  it("lists v1 from the parent followed by revisions in order", async () => {
    const { fileId, parentRef } = await setup();
    await commitRevision({ fileId, uploadId: await putRevision(fileId), user: TEST_USER });
    await commitRevision({ fileId, uploadId: await putRevision(fileId), user: TEST_USER });

    const data = (await parentRef.get()).data()!;
    expect((await listVersions(fileId, data)).map((v) => v.number)).toEqual([1, 2, 3]);
  });

  it("refuses someone else's file without writing anything", async () => {
    const { fileId, parentRef } = await setup("other@example.com");
    const uploadId = await putRevision(fileId);

    expect(await commitRevision({ fileId, uploadId, user: TEST_USER })).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect((await parentRef.collection("versions").get()).size).toBe(0);
  });
});
