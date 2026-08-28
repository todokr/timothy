import { describe, it, expect, vi, beforeEach } from "vitest";
import app, { parseUploadRequest } from "./upload.js";

vi.mock("../lib/firebase.js", () => ({
  db: {
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({
        set: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

vi.mock("../lib/storage.js", () => ({
  UPLOAD_CONTENT_TYPE: "text/html; charset=utf-8",
  generateSignedUploadUrl: vi.fn().mockResolvedValue("https://storage.googleapis.com/mock-signed-url"),
}));

import { db } from "../lib/firebase.js";
import { generateSignedUploadUrl } from "../lib/storage.js";
import { now } from "../lib/time.js";

function makeRequest(body: unknown) {
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fetchDirect(req: Request) {
  return app.fetch(req);
}

describe("parseUploadRequest", () => {
  it("returns ok:true for valid input", () => {
    const result = parseUploadRequest({ title: "T", description: "D", ttlDays: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ title: "T", description: "D", ttlDays: 1 });
    }
  });

  it("accepts ttlDays: null as the indefinite expiry", () => {
    const result = parseUploadRequest({ title: "T", description: "D", ttlDays: null });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ title: "T", description: "D", ttlDays: null });
    }
  });

  it("returns ok:false when required fields are missing", () => {
    const result = parseUploadRequest({ title: "T" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Missing required fields/);
    }
  });

  it("returns ok:false when title is empty", () => {
    const result = parseUploadRequest({ title: "", description: "D", ttlDays: 1 });
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when description is not a string", () => {
    const result = parseUploadRequest({ title: "T", description: 123, ttlDays: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/description/);
    }
  });

  it("returns ok:false when ttlDays is not a positive integer", () => {
    const result = parseUploadRequest({ title: "T", description: "D", ttlDays: -1 });
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when ttlDays is a float", () => {
    const result = parseUploadRequest({ title: "T", description: "D", ttlDays: 1.5 });
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when body is null", () => {
    const result = parseUploadRequest(null);
    expect(result.ok).toBe(false);
  });
});

describe("POST /upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(generateSignedUploadUrl).mockResolvedValue("https://storage.googleapis.com/mock-signed-url");
    const docMock = { set: vi.fn().mockResolvedValue(undefined) };
    const collectionMock = { doc: vi.fn().mockReturnValue(docMock) };
    vi.mocked(db.collection).mockReturnValue(collectionMock as unknown as ReturnType<typeof db.collection>);
  });

  it("returns 400 when body is missing required fields", async () => {
    const res = await fetchDirect(makeRequest({ title: "T" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toHaveProperty("error");
  });

  it("returns 400 when title is empty string", async () => {
    const res = await fetchDirect(makeRequest({ title: "", description: "desc", ttlDays: 7 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when description is not a string", async () => {
    const res = await fetchDirect(makeRequest({ title: "Test", description: 123, ttlDays: 7 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when ttlDays is not a positive integer", async () => {
    const res = await fetchDirect(makeRequest({ title: "Test", description: "desc", ttlDays: -1 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when ttlDays is a float", async () => {
    const res = await fetchDirect(makeRequest({ title: "Test", description: "desc", ttlDays: 1.5 }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is invalid JSON", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await fetchDirect(req);
    expect(res.status).toBe(400);
  });

  it("returns 415 when Content-Type is not application/json", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ title: "T", description: "D", ttlDays: 1 }),
    });
    const res = await fetchDirect(req);
    expect(res.status).toBe(415);
    expect(generateSignedUploadUrl).not.toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("returns 415 when Content-Type is absent", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: JSON.stringify({ title: "T", description: "D", ttlDays: 1 }),
      headers: {},
    });
    // fetch() infers text/plain for a string body; strip it to simulate no header.
    req.headers.delete("content-type");
    const res = await fetchDirect(req);
    expect(res.status).toBe(415);
  });

  it("generates signed upload URL and returns metadata on success", async () => {
    const validBody = { title: "Monthly Report", description: "Details", ttlDays: 7 };

    const res = await fetchDirect(makeRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json() as {
      id: string;
      uploadUrl: string;
      uploadHeaders: Record<string, string>;
      url: string;
      expiresAt: string;
    };

    expect(json).toHaveProperty("id");
    expect(json.uploadUrl).toBe("https://storage.googleapis.com/mock-signed-url");
    expect(json.uploadHeaders["Content-Type"]).toBe("text/html; charset=utf-8");
    expect(json.url).toMatch(/^https?:\/\/[^/]+\/s\//);
    expect(json).toHaveProperty("expiresAt");

    const expectedPath = `timothy-files/${json.id}.html`;
    expect(generateSignedUploadUrl).toHaveBeenCalledWith(expectedPath);
    expect(db.collection).toHaveBeenCalledWith("htmlFiles");
  });

  it("saves correct metadata to Firestore (without userId)", async () => {
    const validBody = { title: "Title", description: "Desc", ttlDays: 3 };

    const setMock = vi.fn().mockResolvedValue(undefined);
    const collectionMock = { doc: vi.fn().mockReturnValue({ set: setMock }) };
    vi.mocked(db.collection).mockReturnValue(collectionMock as unknown as ReturnType<typeof db.collection>);

    const before = now();
    const res = await fetchDirect(makeRequest(validBody));

    expect(res.status).toBe(200);
    expect(setMock).toHaveBeenCalledOnce();

    const savedData = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(savedData).not.toHaveProperty("userId");
    expect(savedData.title).toBe(validBody.title);
    expect(savedData.description).toBe(validBody.description);
    expect(savedData.expiresAt).toBeInstanceOf(Date);
    expect(savedData.createdAt).toBeInstanceOf(Date);

    const expiresAt = savedData.expiresAt as Date;
    const diffDays = Math.round((expiresAt.getTime() - before.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(validBody.ttlDays);
  });

  it("stores expiresAt: null and returns it when ttlDays is null", async () => {
    const setMock = vi.fn().mockResolvedValue(undefined);
    const collectionMock = { doc: vi.fn().mockReturnValue({ set: setMock }) };
    vi.mocked(db.collection).mockReturnValue(collectionMock as unknown as ReturnType<typeof db.collection>);

    const res = await fetchDirect(makeRequest({ title: "T", description: "D", ttlDays: null }));

    expect(res.status).toBe(200);
    const json = (await res.json()) as { expiresAt: string | null };
    expect(json.expiresAt).toBeNull();

    const savedData = setMock.mock.calls[0][0] as Record<string, unknown>;
    expect(savedData.expiresAt).toBeNull();
    expect(savedData.createdAt).toBeInstanceOf(Date);
  });

  it("returns 5xx when generateSignedUploadUrl throws", async () => {
    vi.mocked(generateSignedUploadUrl).mockRejectedValue(new Error("Storage error"));
    const res = await fetchDirect(
      makeRequest({ title: "T", description: "D", ttlDays: 1 })
    );
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it("returns 5xx when Firestore set throws", async () => {
    const setMock = vi.fn().mockRejectedValue(new Error("Firestore error"));
    const collectionMock = { doc: vi.fn().mockReturnValue({ set: setMock }) };
    vi.mocked(db.collection).mockReturnValue(collectionMock as unknown as ReturnType<typeof db.collection>);

    const res = await fetchDirect(
      makeRequest({ title: "T", description: "D", ttlDays: 1 })
    );
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
