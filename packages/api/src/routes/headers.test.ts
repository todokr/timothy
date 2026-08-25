import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/firebase.js", () => ({
  db: { collection: vi.fn() },
}));

import { FieldValue } from "firebase-admin/firestore";
import app from "./headers.js";
import { db } from "../lib/firebase.js";

function mockDoc(exists: boolean, responseHeaders?: unknown) {
  const updateMock = vi.fn().mockResolvedValue(undefined);
  const docRef = {
    get: vi.fn().mockResolvedValue({ exists, data: () => ({ responseHeaders }) }),
    update: updateMock,
  };
  vi.mocked(db.collection).mockReturnValue({
    doc: vi.fn().mockReturnValue(docRef),
  } as unknown as ReturnType<typeof db.collection>);
  return { updateMock };
}

/** 管理画面のブラウザから来たリクエストを模す。 */
function put(id: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`/${id}/headers`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PUT /files/:id/headers", () => {
  it("stores a valid setting", async () => {
    const { updateMock } = mockDoc(true);
    const res = await put("01ABC", { allowedSources: { script: ["https://cdn.example.com"] } });

    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith({
      responseHeaders: { allowedSources: { script: ["https://cdn.example.com"] } },
    });
  });

  it("returns 404 for an unknown id", async () => {
    mockDoc(false);
    expect((await put("01MISSING", {})).status).toBe(404);
  });

  it("rejects an unparsable body", async () => {
    mockDoc(true);
    expect((await put("01ABC", "not-json")).status).toBe(400);
  });

  it("rejects settings the allowlist does not cover", async () => {
    mockDoc(true);
    const res = await put("01ABC", { sandbox: ["allow-scripts", "allow-same-origin"] });
    expect(res.status).toBe(400);
  });

  // upload.ts と同じ理由。c.req.json() は Content-Type を見ずに本文を解釈するため、
  // application/json を必須にしないと <form enctype="text/plain"> による
  // クロスオリジン投稿がプリフライトなしで到達する。
  it("requires application/json", async () => {
    mockDoc(true);
    const res = await put("01ABC", {}, { "Content-Type": "text/plain" });
    expect(res.status).toBe(415);
  });

  // セキュリティ制御ではなく摩擦。Sec-Fetch-* を送らない curl / node-fetch を
  // 弾くことで、内容を理解しないままスクリプトに変更されるのを防ぐ。
  it("rejects requests without Sec-Fetch-Site: same-origin", async () => {
    mockDoc(true);
    const res = await app.request("/01ABC/headers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  // 全項目を既定に戻した状態は「未設定」と同じであるべきで、
  // 空オブジェクトを保存すると後方互換の判定が二通りになってしまう。
  it("removes the field when the setting is empty", async () => {
    const { updateMock } = mockDoc(true, { cacheControl: "no-store" });
    const res = await put("01ABC", {});

    expect(res.status).toBe(200);
    // 空オブジェクトの保存ではなくフィールドそのものの削除であること。
    // toHaveBeenCalledWith は toEqual 相当で DeleteTransform と {} を区別
    // できないため、センチネルのプロトタイプで判定する。
    const written = updateMock.mock.calls[0][0].responseHeaders;
    expect(Object.getPrototypeOf(written)).toBe(Object.getPrototypeOf(FieldValue.delete()));
  });
});
