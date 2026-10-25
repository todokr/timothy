import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/firebase.js", () => ({
  db: { collection: vi.fn() },
}));

import { db } from "../lib/firebase.js";
import app from "./viewer.js";

type VersionDocs = Record<number, Record<string, unknown>>;

function ts(iso = "2026-01-01T00:00:00Z") {
  return { toDate: () => new Date(iso) };
}

// 親ドキュメントと versions サブコレクション（list 用）を返す
function mockDoc(parent: { exists: boolean; data?: () => Record<string, unknown> }, versions: VersionDocs = {}) {
  const doc = parent.exists
    ? { exists: true, data: () => ({ createdAt: ts(), ...parent.data!() }) }
    : parent;
  vi.mocked(db.collection).mockReturnValue({
    doc: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue(doc),
      collection: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          docs: Object.entries(versions).map(([n, data]) => ({ id: n, data: () => data })),
        }),
      }),
    }),
  } as unknown as ReturnType<typeof db.collection>);
}

function mockParent(fields: Record<string, unknown>, versions: VersionDocs = {}) {
  mockDoc(
    { exists: true, data: () => ({ ownerEmail: "a@example.com", ownerName: "A", ...fields }) },
    versions,
  );
}

const threeVersions: VersionDocs = {
  2: { storagePath: "p2", createdAt: ts("2026-02-01T00:00:00Z") },
  3: { storagePath: "p3", createdAt: ts("2026-03-01T00:00:00Z") },
};

describe("GET /s/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParent({ title: "設計書", storagePath: "p", latestVersion: 3, expiresAt: null }, threeVersions);
  });

  it("shows the latest version by default", async () => {
    const html = await (await app.request("/01ABC")).text();
    expect(html).toContain('src="/s/01ABC/v/3"');
    expect(html).toContain("v3 / 全 3 版");
    expect(html).not.toContain("最新版ではありません");
  });

  it("shows the version named in ?v and links back to the latest", async () => {
    const html = await (await app.request("/01ABC?v=1")).text();
    expect(html).toContain('src="/s/01ABC/v/1"');
    expect(html).toContain("最新版ではありません");
    expect(html).toContain('href="/s/01ABC?v=3"');
  });

  it("lists every version in the selector with the shown one selected", async () => {
    const html = await (await app.request("/01ABC?v=2")).text();
    expect(html.match(/<option/g)).toHaveLength(3);
    expect(html).toMatch(/<option[^>]*value="2"[^>]*selected/);
    expect(html).toContain("v2（2026-02-01 09:00）");
  });

  it("shows a one-entry selector for a legacy file", async () => {
    mockParent({ title: "旧", storagePath: "p", expiresAt: null });
    const html = await (await app.request("/01OLD")).text();
    expect(html).toContain('src="/s/01OLD/v/1"');
    expect(html.match(/<option/g)).toHaveLength(1);
  });

  it("returns 404 for a missing file", async () => {
    mockDoc({ exists: false });
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not Found" });
  });

  it.each(["0", "4", "abc"])("returns 404 for ?v=%s", async (v) => {
    const res = await app.request(`/01ABC?v=${v}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not Found" });
  });

  it("returns 410 for an expired file", async () => {
    mockParent({ title: "t", storagePath: "p", expiresAt: ts("2020-01-01T00:00:00Z") });
    const res = await app.request("/01ABC");
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "Gone" });
  });

  it("sandboxes the frame with the default tokens", async () => {
    const html = await (await app.request("/01ABC")).text();
    expect(html).toMatch(/<iframe[^>]*sandbox="allow-scripts allow-popups allow-downloads allow-modals"/);
    expect(html).toMatch(/<iframe[^>]*title="設計書"/);
  });

  it("uses the file's saved sandbox tokens for the frame attribute", async () => {
    mockParent(
      {
        title: "設計書",
        storagePath: "p",
        latestVersion: 3,
        expiresAt: null,
        responseHeaders: { sandbox: ["allow-scripts", "allow-forms"] },
      },
      threeVersions,
    );
    const html = await (await app.request("/01ABC")).text();
    expect(html).toMatch(/<iframe[^>]*sandbox="allow-scripts allow-forms"/);
    expect(html).not.toContain("allow-same-origin");
  });

  it("never puts allow-same-origin in the frame attribute", async () => {
    const html = await (await app.request("/01ABC")).text();
    expect(html).not.toContain("allow-same-origin");
  });

  it("titles the tab with the file title", async () => {
    const html = await (await app.request("/01ABC")).text();
    expect(html).toContain("<title>設計書</title>");
  });

  it("refuses to be framed and is not cached", async () => {
    const res = await app.request("/01ABC");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toBe(
      "frame-ancestors 'none'; frame-src 'self'",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("renders the comment panel with the file id and versions", async () => {
    const html = await (await app.request("/01ABC?v=2")).text();
    expect(html).toMatch(/<aside[^>]*id="comment-panel"[^>]*data-file-id="01ABC"/);
    expect(html).toContain('data-shown-version="2"');
    expect(html).toContain('data-latest-version="3"');
    expect(html).toContain('data-scripts-allowed="true"');
    expect(html).toContain("◎ 要素を選んでコメント");
    expect(html).toMatch(/<button[^>]*id="pick-toggle"[^>]*title="⌥\+C \/ Alt\+C"/);
    expect(html).not.toMatch(/<button[^>]*id="pick-toggle"[^>]*disabled/);
    expect(html).toContain("コメントを書く…");
    expect(html).toContain("⌘+Enter / Ctrl+Enter で送信");
    expect(html).toContain("文字を選択するか、「要素を選んでコメント」で図などを選ぶと、その箇所にコメントできます");
    expect(html).toContain("解決済みも表示");
    expect(html).toMatch(/<input[^>]*id="show-resolved"/);
    expect(html).not.toMatch(/<input[^>]*id="show-resolved"[^>]*checked/);
  });

  it("disables element picking when the owner removed allow-scripts", async () => {
    mockParent(
      {
        title: "設計書",
        storagePath: "p",
        latestVersion: 3,
        expiresAt: null,
        responseHeaders: { sandbox: ["allow-popups"] },
      },
      threeVersions,
    );
    const html = await (await app.request("/01ABC")).text();
    expect(html).toContain('data-scripts-allowed="false"');
    expect(html).toMatch(/<button[^>]*id="pick-toggle"[^>]*disabled/);
    expect(html).toContain("この HTML はスクリプトを許可していないため、本文を選んでコメントすることはできません");
    expect(html).not.toContain("その箇所にコメントできます");
  });

  it("embeds the viewer script", async () => {
    const html = await (await app.request("/01ABC")).text();
    expect(html).toContain("tim:set-anchors");
    expect(html).toContain('getElementById("version-select")');
  });

  it("escapes the title", async () => {
    mockParent({ title: "<script>x</script>", storagePath: "p", expiresAt: null });
    const html = await (await app.request("/01ABC")).text();
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });
});
