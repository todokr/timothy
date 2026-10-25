import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./firebase.js", () => ({
  db: { collection: vi.fn() },
}));

import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import {
  CLI_TOKENS_COLLECTION,
  CLI_TOKEN_TTL_DAYS,
  findCliTokenUser,
  issueCliToken,
  readBearerToken,
  revokeCliToken,
} from "./cliTokens.js";
import { db } from "./firebase.js";
import { TEST_USER } from "../test/auth.js";

const NOW = new Date("2026-10-25T00:00:00.000Z");

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function mockCollection(snapshot: { exists: boolean; data?: () => unknown } = { exists: false }) {
  const docRef = {
    set: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(snapshot),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const doc = vi.fn().mockReturnValue(docRef);
  vi.mocked(db.collection).mockReturnValue({ doc } as unknown as ReturnType<typeof db.collection>);
  return { doc, docRef };
}

function storedDoc(data: Record<string, unknown>) {
  return { exists: true, data: () => data };
}

beforeEach(() => {
  vi.mocked(db.collection).mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("issueCliToken", () => {
  it("stores only the hash", async () => {
    const { doc, docRef } = mockCollection();
    const token = await issueCliToken(TEST_USER);

    // 32 バイトの base64url は 43 文字
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(db.collection).toHaveBeenCalledWith(CLI_TOKENS_COLLECTION);
    const id = doc.mock.calls[0][0] as string;
    expect(id).not.toBe(token);
    expect(id).toBe(sha256(token));
    const data = docRef.set.mock.calls[0][0] as Record<string, unknown>;
    expect(JSON.stringify(data)).not.toContain(token);
    expect(data).toEqual({
      email: TEST_USER.email,
      name: TEST_USER.name,
      picture: TEST_USER.picture,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + CLI_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    });
  });

  it("issues a different token each time", async () => {
    mockCollection();
    expect(await issueCliToken(TEST_USER)).not.toBe(await issueCliToken(TEST_USER));
  });
});

describe("findCliTokenUser", () => {
  const future = Timestamp.fromDate(new Date(NOW.getTime() + 60_000));

  it("returns the user for a stored, unexpired token", async () => {
    const { doc } = mockCollection(
      storedDoc({ email: "a@example.com", name: "A", picture: "https://example.com/a.png", expiresAt: future }),
    );
    expect(await findCliTokenUser("tok")).toEqual({
      email: "a@example.com",
      name: "A",
      picture: "https://example.com/a.png",
    });
    expect(doc).toHaveBeenCalledWith(sha256("tok"));
  });

  it("returns null when no document exists", async () => {
    mockCollection({ exists: false });
    expect(await findCliTokenUser("tok")).toBeNull();
  });

  it("treats an expired token as missing", async () => {
    const past = Timestamp.fromDate(new Date(NOW.getTime() - 1));
    mockCollection(storedDoc({ ...TEST_USER, expiresAt: past }));
    expect(await findCliTokenUser("tok")).toBeNull();
  });

  it("treats a token expiring exactly now as missing", async () => {
    mockCollection(storedDoc({ ...TEST_USER, expiresAt: Timestamp.fromDate(NOW) }));
    expect(await findCliTokenUser("tok")).toBeNull();
  });

  it.each([
    { email: 1, name: "n", picture: null, expiresAt: "future" },
    { email: "", name: "n", picture: null, expiresAt: "future" },
    { email: "a@example.com", name: 2, picture: null, expiresAt: "future" },
    { email: "a@example.com", name: "n", picture: 3, expiresAt: "future" },
    { email: "a@example.com", name: "n", expiresAt: "future" },
    { email: "a@example.com", name: "n", picture: null },
    { email: "a@example.com", name: "n", picture: null, expiresAt: "2099-01-01" },
    { email: "a@example.com", name: "n", picture: null, expiresAt: { toDate: () => new Date("2099-01-01") } },
  ])("rejects a stored document with the wrong shape %j", async (data) => {
    const resolved = { ...data } as Record<string, unknown>;
    if (resolved.expiresAt === "future") resolved.expiresAt = future;
    mockCollection(storedDoc(resolved));
    expect(await findCliTokenUser("tok")).toBeNull();
  });

  it("rejects a document whose data is undefined", async () => {
    mockCollection({ exists: true, data: () => undefined });
    expect(await findCliTokenUser("tok")).toBeNull();
  });
});

describe("revokeCliToken", () => {
  it("deletes the document keyed by the hash", async () => {
    const { doc, docRef } = mockCollection();
    await revokeCliToken("tok");
    expect(db.collection).toHaveBeenCalledWith(CLI_TOKENS_COLLECTION);
    expect(doc).toHaveBeenCalledWith(sha256("tok"));
    expect(docRef.delete).toHaveBeenCalledOnce();
  });
});

describe("readBearerToken", () => {
  it("returns the token after Bearer", () => {
    expect(readBearerToken("Bearer abc_DEF-123")).toBe("abc_DEF-123");
  });

  it.each([
    undefined,
    "",
    "abc",
    "Basic abc",
    "bearer abc",
    "Bearer ",
    "Bearer",
    "Bearer a b",
    "Bearer abc=",
    `Bearer ${"a".repeat(513)}`,
  ])("returns null for %j", (header) => {
    expect(readBearerToken(header)).toBeNull();
  });

  it("accepts a token of exactly 512 characters", () => {
    expect(readBearerToken(`Bearer ${"a".repeat(512)}`)).toBe("a".repeat(512));
  });
});
