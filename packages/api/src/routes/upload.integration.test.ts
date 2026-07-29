import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// V4 signed URL generation requires real GCP credentials even against the Storage emulator.
// Stub it out; upload happens via the returned URL which we don't exercise here.
vi.mock("../lib/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/storage.js")>();
  return {
    ...actual,
    generateSignedUploadUrl: vi.fn().mockResolvedValue("http://localhost:9199/stub-signed-url"),
  };
});

import app from "../index.js";
import { db } from "../lib/firebase.js";
import { getBucket } from "../lib/storage.js";
import { epochMills } from "../lib/time.js";

// Requires: firebase emulators:start --only firestore,storage
const TEST_API_KEY = "integration-test-key";
const TEST_USER_ID = "integration-test-user";

function makeRequest(body: unknown) {
  return new Request("http://localhost/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TEST_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const validBody = {
  title: "Integration Test",
  description: "Test description",
  ttlDays: 7,
};

describe("POST /upload (integration)", () => {
  let keyDocId: string;
  const createdDocIds: string[] = [];

  beforeAll(async () => {
    const ref = await db.collection("apiKeys").add({
      key: TEST_API_KEY,
      userId: TEST_USER_ID,
    });
    keyDocId = ref.id;
  });

  afterAll(async () => {
    await db.collection("apiKeys").doc(keyDocId).delete();
    await Promise.all(
      createdDocIds.map(async (id) => {
        await db.collection("htmlFiles").doc(id).delete().catch(() => {});
        const file = getBucket().file(`timothy-files/${TEST_USER_ID}/${id}.html`);
        await file.delete().catch(() => {});
      })
    );
  });

  it("returns 401 without Authorization header", async () => {
    const res = await app.fetch(
      new Request("http://localhost/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid API key", async () => {
    const res = await app.fetch(
      new Request("http://localhost/upload", {
        method: "POST",
        headers: {
          Authorization: "Bearer wrong-key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validBody),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing required fields", async () => {
    const res = await app.fetch(makeRequest({ title: "T" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toHaveProperty("error");
  });

  it("returns 400 for invalid JSON", async () => {
    const res = await app.fetch(
      new Request("http://localhost/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: "not-json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns signed upload URL and saves metadata to Firestore", async () => {
    const before = epochMills();
    const res = await app.fetch(makeRequest(validBody));

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      id: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
      url: string;
      expiresAt: string;
    };

    expect(json.id).toBeTruthy();
    expect(json.uploadUrl).toBe("http://localhost:9199/stub-signed-url");
    expect(json.uploadHeaders["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(json.url).toBeTruthy();
    expect(new Date(json.expiresAt).getTime()).toBeGreaterThan(before);
    createdDocIds.push(json.id);

    const doc = await db.collection("htmlFiles").doc(json.id).get();
    expect(doc.exists).toBe(true);
    const data = doc.data()!;
    expect(data.userId).toBe(TEST_USER_ID);
    expect(data.title).toBe(validBody.title);
    expect(data.description).toBe(validBody.description);
    expect(data.storagePath).toBe(
      `timothy-files/${TEST_USER_ID}/${json.id}.html`
    );
    expect(data.expiresAt.toDate()).toBeInstanceOf(Date);
    expect(data.createdAt.toDate()).toBeInstanceOf(Date);
  });

  it("expiresAt is ttlDays from now", async () => {
    const ttlDays = 3;
    const before = epochMills();
    const res = await app.fetch(
      makeRequest({ ...validBody, ttlDays })
    );

    expect(res.status).toBe(200);
    const { id, expiresAt } = (await res.json()) as {
      id: string;
      expiresAt: string;
    };
    createdDocIds.push(id);

    const diffDays =
      (new Date(expiresAt).getTime() - before) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(ttlDays, 0);
  });

  it("each upload gets a unique id", async () => {
    const [res1, res2] = await Promise.all([
      app.fetch(makeRequest(validBody)),
      app.fetch(makeRequest(validBody)),
    ]);
    const [json1, json2] = (await Promise.all([
      res1.json(),
      res2.json(),
    ])) as [{ id: string }, { id: string }];

    expect(json1.id).not.toBe(json2.id);
    createdDocIds.push(json1.id, json2.id);
  });
});
