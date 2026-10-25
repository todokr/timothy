import { describe, it, expect, afterAll } from "vitest";
import { ulid } from "ulid";
import { db } from "./firebase.js";
import { getBucket } from "./storage.js";
import { HTML_FILES_COLLECTION } from "./files.js";
import { now } from "./time.js";
import { TEST_USER } from "../test/auth.js";
import type { SessionUser } from "./session.js";
import type { TextAnchor } from "./anchors.js";
import { addReply, COMMENTS_SUBCOLLECTION, createComment, listComments, setResolved } from "./comments.js";
import { commitRevision, revisionPrefix, revisionStoragePath } from "./versions.js";

// Requires: firebase emulators:start --only firestore,storage

const OTHER_USER: SessionUser = { email: "other@example.com", name: "Other", picture: null };
const TEXT: TextAnchor = { type: "text", quote: "PVC", prefix: "", suffix: "" };

describe("comments (integration)", () => {
  const fileIds: string[] = [];

  afterAll(async () => {
    await Promise.all(
      fileIds.map(async (id) => {
        await db.recursiveDelete(db.collection(HTML_FILES_COLLECTION).doc(id)).catch(() => {});
        await getBucket().deleteFiles({ prefix: revisionPrefix(id) }).catch(() => {});
      })
    );
  });

  async function setup() {
    const fileId = ulid();
    fileIds.push(fileId);
    const parentRef = db.collection(HTML_FILES_COLLECTION).doc(fileId);
    await parentRef.set({
      title: "T",
      description: "D",
      storagePath: `timothy-files/${fileId}.html`,
      createdAt: now(),
      expiresAt: null,
      ownerEmail: TEST_USER.email,
      ownerName: TEST_USER.name,
    });
    return { fileId, parentRef };
  }

  it("creates, lists, replies and resolves a comment", async () => {
    const { fileId } = await setup();
    const c = await createComment(fileId, { version: 1, anchor: TEXT, body: "RWX だと EBS 使えないのでは" }, TEST_USER);
    expect(c).toMatchObject({ version: 1, resolved: false, resolvedBy: null, resolvedAt: null, replies: [] });
    await addReply(fileId, c.id, "v3 で直しました", OTHER_USER, true);
    const resolved = await setResolved(fileId, c.id, true, TEST_USER);
    expect(resolved).toMatchObject({ resolved: true, resolvedBy: { email: TEST_USER.email } });
    const [listed] = await listComments(fileId);
    expect(listed.replies).toEqual([
      expect.objectContaining({
        body: "v3 で直しました",
        viaAgent: true,
        author: { email: OTHER_USER.email, name: OTHER_USER.name },
      }),
    ]);
  });

  it("clears resolvedBy when a comment is reopened", async () => {
    const { fileId } = await setup();
    const c = await createComment(fileId, { version: 1, anchor: TEXT, body: "x" }, TEST_USER);
    await setResolved(fileId, c.id, true, TEST_USER);
    const reopened = await setResolved(fileId, c.id, false, OTHER_USER);
    expect(reopened).toMatchObject({ resolved: false, resolvedBy: null, resolvedAt: null });
  });

  it("returns null when the comment is missing", async () => {
    const { fileId } = await setup();
    expect(await addReply(fileId, ulid(), "x", TEST_USER, false)).toBeNull();
    expect(await setResolved(fileId, ulid(), true, TEST_USER)).toBeNull();
  });

  it("lists comments oldest first", async () => {
    const { fileId } = await setup();
    const bodies = ["one", "two", "three"];
    const wait = () => new Promise((r) => setTimeout(r, 5));
    await createComment(fileId, { version: 1, anchor: TEXT, body: "one" }, TEST_USER);
    await wait();
    await createComment(fileId, { version: 1, anchor: TEXT, body: "two" }, TEST_USER);
    await wait();
    await createComment(fileId, { version: 1, anchor: TEXT, body: "three" }, TEST_USER);
    expect((await listComments(fileId)).map((c) => c.body)).toEqual(bodies);
  });

  it("keeps comments when a revision is committed", async () => {
    const { fileId } = await setup();
    await createComment(fileId, { version: 1, anchor: TEXT, body: "keep me" }, TEST_USER);
    const uploadId = ulid();
    await getBucket().file(revisionStoragePath(fileId, uploadId)).save("<p>rev</p>");
    expect(await commitRevision({ fileId, uploadId, user: TEST_USER })).toEqual({ ok: true, version: 2 });
    expect((await listComments(fileId)).map((c) => c.body)).toEqual(["keep me"]);
  });

  it("removes comments together with the file", async () => {
    const { fileId, parentRef } = await setup();
    await createComment(fileId, { version: 1, anchor: TEXT, body: "x" }, TEST_USER);
    await db.recursiveDelete(parentRef);
    expect((await parentRef.collection(COMMENTS_SUBCOLLECTION).get()).size).toBe(0);
  });
});
