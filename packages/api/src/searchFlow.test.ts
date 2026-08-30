import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * アップロード → インデックス化 → 検索 → 削除 までを、アプリ全体を通して確かめる。
 *
 * ルート単位のテストは配線の食い違いを見つけられない（index.ts のマウント漏れ、
 * web.tsx と検索ロジックの噛み合わせなど）。ここでは Firestore と GCS だけを
 * インメモリに差し替えて、あとは本物を通す。
 */

const store = new Map<string, Record<string, unknown>>();
const objects = new Map<string, string>();

function timestamp(date: Date) {
  return { toDate: () => date };
}

vi.mock("./lib/firebase.js", () => {
  function docRef(collection: string, id: string) {
    const key = `${collection}/${id}`;
    return {
      id,
      path: key,
      ref: { path: key },
      get: () =>
        Promise.resolve({
          id,
          exists: store.has(key),
          data: () => store.get(key),
        }),
      set: (data: Record<string, unknown>) => {
        store.set(key, data);
        return Promise.resolve();
      },
      delete: () => {
        store.delete(key);
        return Promise.resolve();
      },
    };
  }

  return {
    storage: { bucket: vi.fn() },
    db: {
      collection: (name: string) => ({
        doc: (id: string) => docRef(name, id),
        where: (field: string, _op: string, value: unknown) => ({
          get: () =>
            Promise.resolve({
              docs: [...store.entries()]
                .filter(
                  ([key, data]) =>
                    key.startsWith(`${name}/`) && data[field] === value,
                )
                .map(([key, data]) => ({
                  id: key.slice(name.length + 1),
                  ref: { path: key },
                  data: () => data,
                })),
            }),
        }),
        orderBy: (field: string, dir: string) => ({
          get: () =>
            Promise.resolve({
              docs: [...store.entries()]
                .filter(([key]) => key.startsWith(`${name}/`))
                .map(([key, value]) => ({
                  id: key.slice(name.length + 1),
                  data: () => value,
                }))
                .sort((a, b) => {
                  const av = (a.data() as never)[field];
                  const bv = (b.data() as never)[field];
                  const cmp = av < bv ? -1 : av > bv ? 1 : 0;
                  return dir === "desc" ? -cmp : cmp;
                }),
            }),
        }),
      }),
      getAll: (...refs: Array<{ get: () => Promise<unknown> }>) =>
        Promise.all(refs.map((ref) => ref.get())),
      batch: () => {
        const ops: Array<() => void> = [];
        return {
          set: (ref: { path: string }, data: Record<string, unknown>) => {
            ops.push(() => store.set(ref.path, data));
          },
          delete: (ref: { path: string }) => {
            ops.push(() => store.delete(ref.path));
          },
          commit: () => {
            ops.forEach((op) => op());
            return Promise.resolve();
          },
        };
      },
    },
  };
});

vi.mock("./lib/storage.js", () => ({
  getFileContent: (path: string) =>
    objects.has(path)
      ? Promise.resolve(objects.get(path))
      : Promise.reject(Object.assign(new Error("No such object"), { code: 404 })),
  deleteFile: (path: string) =>
    objects.delete(path)
      ? Promise.resolve()
      : Promise.reject(Object.assign(new Error("No such object"), { code: 404 })),
  isNotFoundError: (error: unknown) =>
    (error as { code?: number } | null)?.code === 404,
  generateSignedUploadUrl: () => Promise.resolve("http://example.invalid/signed"),
  uploadHtml: (path: string, html: string) => {
    objects.set(path, html);
    return Promise.resolve();
  },
  getBucket: () => ({}),
  UPLOAD_CONTENT_TYPE: "text/html; charset=utf-8",
}));

// モデルのロードを避ける。ベクトル側は integration テストで実物を通す。
vi.mock("./lib/embeddings.js", () => ({
  embed: () => Promise.resolve(null),
  embedOne: () => Promise.resolve(null),
  EMBEDDING_MODEL: "test-model",
  EMBEDDING_DIM: 384,
}));

import app from "./index.js";

const DAY_MS = 86_400_000;

function seed(
  id: string,
  title: string,
  html: string | null,
  { expired = false } = {},
) {
  const storagePath = `timothy-files/${id}.html`;
  store.set(`htmlFiles/${id}`, {
    title,
    description: "",
    storagePath,
    createdAt: timestamp(new Date(Date.now() - DAY_MS)),
    expiresAt: timestamp(new Date(Date.now() + (expired ? -DAY_MS : 7 * DAY_MS))),
  });
  if (html !== null) objects.set(storagePath, html);
}

function req(path: string, init?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, init));
}

async function search(q: string) {
  const res = await req(`/search?q=${encodeURIComponent(q)}`);
  return (await res.json()) as {
    total: number;
    pendingCount: number;
    results: Array<{
      id: string;
      title: string;
      score: number;
      snippets: Array<{ before: string; match: string; after: string }>;
    }>;
  };
}

const REPORT_HTML = `<html><head><title>月次売上レポート</title>
  <meta name="description" content="2026年8月の売上"></head>
  <body><h1>売上サマリ</h1><p>今月の売上は前月比で12%増加した。</p>
  <table><tr><td>東京</td><td>大阪</td></tr></table>
  <script>var chartData=[1,2,3];</script></body></html>`;

const INCIDENT_HTML = `<html><head><title>障害レポート TIM-4821</title></head>
  <body><p>ＡＰＩ でタイムアウトが発生。NullPointerException を確認。</p></body></html>`;

describe("search flow", () => {
  beforeEach(() => {
    store.clear();
    objects.clear();
    seed("01AAA", "月次売上レポート", REPORT_HTML);
    seed("01BBB", "障害レポート TIM-4821", INCIDENT_HTML);
    seed("01CCC", "Expired", "<p>売上 should never appear</p>", {
      expired: true,
    });
    // GCS への PUT が失敗して残ったオーファンレコード。
    seed("01ORPHAN", "Orphan", null);
  });

  it("reports unindexed files instead of failing, before anything is indexed", async () => {
    const result = await search("売上");
    expect(result.total).toBe(1); // タイトル一致のみ
    expect(result.pendingCount).toBe(3); // 期限切れは数えない
  });

  it("indexes every live file through the reindex endpoint", async () => {
    const res = await req("/files/reindex", { method: "POST" });
    expect(await res.json()).toEqual({
      indexed: 2,
      // オーファンは 409 になるので失敗として数え、リトライは利用者に任せる。
      failed: 1,
      remaining: 0,
    });
  });

  describe("once indexed", () => {
    beforeEach(async () => {
      await req("/files/reindex", { method: "POST" });
    });

    it("finds a word that appears only in the body", async () => {
      const result = await search("前月比");
      expect(result.results.map((r) => r.id)).toEqual(["01AAA"]);
      expect(result.results[0].snippets[0].match).toBe("前月比");
    });

    it("finds an identifier a tokenizer would split", async () => {
      const result = await search("TIM-4821");
      expect(result.results.map((r) => r.id)).toEqual(["01BBB"]);
    });

    it("matches a full-width query against half-width body text", async () => {
      // 本文の「ＡＰＩ」は NFKC で "API" として保存される。
      expect((await search("api")).results.map((r) => r.id)).toEqual(["01BBB"]);
      expect((await search("ＡＰＩ")).results.map((r) => r.id)).toEqual(["01BBB"]);
    });

    it("matches case-insensitively", async () => {
      expect((await search("nullpointer")).total).toBe(1);
    });

    it("does not match text that only existed inside a script tag", async () => {
      expect((await search("chartData")).total).toBe(0);
    });

    it("does not glue adjacent table cells into a false match", async () => {
      expect((await search("東京大阪")).total).toBe(0);
      expect((await search("東京")).total).toBe(1);
    });

    it("never surfaces an expired file", async () => {
      expect((await search("should never appear")).total).toBe(0);
    });

    it("ranks a title match above a body-only match", async () => {
      // 共有フィクスチャは両方のタイトルに「レポート」が入っていて
      // 比較にならないので、この検証専用に2件足す。
      seed("01TITLE", "タイムアウト調査", "<p>無関係な本文</p>");
      seed("01BODY", "無関係なタイトル", "<p>タイムアウト が本文だけに出る</p>");
      await req("/files/reindex", { method: "POST" });

      const result = await search("タイムアウト");
      const ranked = result.results.map((r) => r.id);
      expect(ranked.indexOf("01TITLE")).toBeLessThan(ranked.indexOf("01BODY"));
    });

    it("removes the extracted text when the file is deleted", async () => {
      expect((await search("前月比")).total).toBe(1);

      const res = await req("/files/01AAA", { method: "DELETE" });
      expect(res.status).toBe(200);

      // Firestore はカスケード削除しないので、明示的な削除が効いているか見る。
      expect(store.has("htmlFileTexts/01AAA")).toBe(false);
      expect((await search("前月比")).total).toBe(0);
    });
  });

  describe("web UI", () => {
    beforeEach(async () => {
      seed(
        "01XSS",
        "<img src=x onerror=alert(1)>",
        "<p>危険 <script>alert(1)</script> な内容</p>",
      );
      await req("/files/reindex", { method: "POST" });
    });

    it("highlights the match without letting uploaded HTML execute", async () => {
      const html = await (await req("/?q=" + encodeURIComponent("危険"))).text();

      expect(html).toContain("<mark>");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(html).not.toContain("<img src=x onerror");
      expect(html).not.toContain("<script>alert(1)</script>");
    });

    it("keeps the upload form so the client script still initialises", async () => {
      const html = await (await req("/?q=" + encodeURIComponent("危険"))).text();
      expect(html).toContain('id="upload-form"');
      expect(html).toContain('id="drop-zone"');
    });

    it("falls back to the plain listing when no query is given", async () => {
      const html = await (await req("/")).text();
      expect(html).toContain("<table");
      expect(html).not.toContain("<mark>");
    });
  });
});
