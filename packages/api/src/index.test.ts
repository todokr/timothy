import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./lib/firebase.js", () => ({
  db: { collection: vi.fn() },
  storage: { bucket: vi.fn() },
}));

import app from "./index.js";

const DENIED_IP = "203.0.113.9";

function request(path: string, method = "GET") {
  return app.request(path, {
    method,
    headers: { "x-forwarded-for": DENIED_IP },
  });
}

describe("IP allowlist coverage", () => {
  beforeEach(() => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
  });

  afterEach(() => {
    delete process.env.ALLOWED_IPS;
  });

  it("blocks the web UI", async () => {
    expect((await request("/")).status).toBe(403);
  });

  it("blocks the upload endpoint", async () => {
    expect((await request("/upload", "POST")).status).toBe(403);
  });

  it("blocks the file list endpoint", async () => {
    expect((await request("/files")).status).toBe(403);
  });

  it("blocks the delete endpoint", async () => {
    expect((await request("/files/01ABC", "DELETE")).status).toBe(403);
  });

  it("blocks the share endpoint", async () => {
    expect((await request("/s/01ABC")).status).toBe(403);
  });

  it("does not block the health endpoint", async () => {
    expect((await request("/health")).status).toBe(200);
  });
});

describe("without ALLOWED_IPS", () => {
  it("does not block the file list endpoint", async () => {
    delete process.env.ALLOWED_IPS;
    const res = await request("/files");
    expect(res.status).not.toBe(403);
  });
});
