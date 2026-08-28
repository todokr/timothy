import { describe, it, expect, vi, beforeEach } from "vitest";

// listFiles / resolveBaseUrl だけ差し替え、HTML_FILES_COLLECTION は本物を使う。
vi.mock("../lib/files.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/files.js")>()),
  listFiles: vi.fn(),
  resolveBaseUrl: vi.fn().mockReturnValue("http://localhost"),
}));

vi.mock("../lib/firebase.js", () => ({
  db: { collection: vi.fn() },
}));

import { listFiles } from "../lib/files.js";
import { db } from "../lib/firebase.js";
import app, { formatJst, isExpired } from "./web.js";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ABC",
    title: "Monthly Report",
    description: "Details",
    url: "http://localhost/s/01ABC",
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-08-07T03:04:00.000Z",
    ...overrides,
  };
}

describe("formatJst", () => {
  it("formats an ISO timestamp as YYYY-MM-DD HH:mm in Asia/Tokyo", () => {
    expect(formatJst("2026-08-07T03:04:00.000Z")).toBe("2026-08-07 12:04");
  });

  it("rolls over to the next day for late UTC timestamps", () => {
    expect(formatJst("2026-08-07T15:30:00.000Z")).toBe("2026-08-08 00:30");
  });
});

describe("isExpired", () => {
  const nowMs = Date.parse("2026-08-07T00:00:00.000Z");

  it("returns false for a future timestamp", () => {
    expect(isExpired("2026-08-08T00:00:00.000Z", nowMs)).toBe(false);
  });

  it("returns true for a past timestamp", () => {
    expect(isExpired("2026-08-06T00:00:00.000Z", nowMs)).toBe(true);
  });

  // null は無期限。一覧から落としてはいけない。
  it("returns false for null", () => {
    expect(isExpired(null, nowMs)).toBe(false);
  });
});

describe("GET /", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state when there are no files", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("まだファイルがありません");
  });

  it("starts the document with a doctype so browsers use standards mode", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("starts the error page with a doctype too", async () => {
    vi.mocked(listFiles).mockRejectedValue(new Error("Firestore is down"));
    const html = await (await app.request("/")).text();
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("renders a row with the title and share URL", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("Monthly Report");
    expect(html).toContain("http://localhost/s/01ABC");
    expect(html).not.toContain("まだファイルがありません");
  });

  it("formats timestamps in Asia/Tokyo", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("2026-08-07 12:04");
  });

  it("hides expired files from the list", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry({ id: "01OLD", title: "Expired Report", expiresAt: "2000-01-01T00:00:00.000Z" }),
    ]);
    const html = await (await app.request("/")).text();
    expect(html).not.toContain("Expired Report");
    expect(html).not.toContain('data-delete-id="01OLD"');
  });

  it("renders 無期限 for a file with no expiry and keeps it listed", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry({ id: "01FOREVER", title: "Handbook", expiresAt: null }),
    ]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("Handbook");
    expect(html).toContain('data-delete-id="01FOREVER"');
    expect(html).toContain("無期限");
  });

  it("keeps live files and drops only the expired ones", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry({ id: "01LIVE", title: "Live Report", expiresAt: "2099-01-01T00:00:00.000Z" }),
      entry({ id: "01OLD", title: "Expired Report", expiresAt: "2000-01-01T00:00:00.000Z" }),
    ]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("Live Report");
    expect(html).toContain('data-delete-id="01LIVE"');
    expect(html).not.toContain("Expired Report");
    expect(html).not.toContain('data-delete-id="01OLD"');
  });

  // 全件が期限切れのときに「まだファイルがありません」を出すと、
  // 昨日アップロードした利用者がデータを失ったと誤解する。
  it("distinguishes an empty collection from an all-expired one", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry({ id: "01OLD", expiresAt: "2000-01-01T00:00:00.000Z" }),
    ]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("有効期限内のファイルがありません");
    expect(html).not.toContain("まだファイルがありません");
  });

  it("renders a delete button carrying the file id", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    const html = await (await app.request("/")).text();
    expect(html).toContain('data-delete-id="01ABC"');
  });

  it("escapes HTML in the title", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry({ title: "<script>alert(1)</script>" })]);
    const html = await (await app.request("/")).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("returns 500 with a readable message when listing fails", async () => {
    vi.mocked(listFiles).mockRejectedValue(new Error("Firestore is down"));
    const res = await app.request("/");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(await res.text()).toContain("一覧を取得できませんでした");
  });

  it("renders the upload form with all inputs", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toContain('id="upload-form"');
    expect(html).toContain('id="drop-zone"');
    expect(html).toContain('id="file-input"');
    expect(html).toContain('id="title-input"');
    expect(html).toContain('id="description-input"');
    expect(html).toContain('id="ttl-input"');
    expect(html).toContain('id="no-expiry-input"');
    expect(html).toContain('id="submit-button"');
    expect(html).toContain('id="form-error"');
  });

  it("restricts the file input to HTML files", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toContain('accept=".html,.htm"');
  });

  it("defaults the TTL to 7 days and only accepts positive integers", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toContain('value="7"');
    expect(html).toContain('min="1"');
    expect(html).toContain('step="1"');
  });

  it("hides the error area by default", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toMatch(/id="form-error"[^>]*hidden/);
  });

  it("does not render the upload form on the error page", async () => {
    vi.mocked(listFiles).mockRejectedValue(new Error("Firestore is down"));
    const html = await (await app.request("/")).text();
    expect(html).not.toContain('id="upload-form"');
  });

  it("embeds the client script on the list page", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("addEventListener");
    expect(html).toContain('"/upload"');
  });

  it("does not embed the client script on the error page", async () => {
    vi.mocked(listFiles).mockRejectedValue(new Error("Firestore is down"));
    const html = await (await app.request("/")).text();
    expect(html).not.toContain("addEventListener");
  });

  it("declares a light color scheme", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toMatch(/color-scheme:\s*light/);
    expect(html).not.toMatch(/color-scheme:\s*dark/);
  });

  // webStyles.ts の import が外れたり <Style> が空になったりすると、
  // 画面は無スタイルになるが他のテストは通ってしまうため、ここで検出する。
  it("emits the stylesheet with the accent token", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toContain('<style id="hono-css">');
    expect(html).toContain("#2563eb");
  });

  it("calls the page Tim, not Timothy", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("<title>Tim</title>");
    expect(html).toContain(">Tim</h1>");
    expect(html).not.toContain("Timothy");
  });

  it("calls the error page Tim too", async () => {
    vi.mocked(listFiles).mockRejectedValue(new Error("Firestore is down"));
    const html = await (await app.request("/")).text();
    expect(html).toContain("<title>Tim</title>");
    expect(html).toContain(">Tim</h1>");
    expect(html).not.toContain("Timothy");
  });

  it("offers 開く and URL をコピー instead of printing the URL", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    const html = await (await app.request("/")).text();

    expect(html).toContain(">開く<");
    expect(html).toContain(">URL をコピー<");
    // URL は href と data-copy-url にのみ残り、本文としては出ない。
    expect(html).toContain('href="http://localhost/s/01ABC"');
    expect(html).toContain('data-copy-url="http://localhost/s/01ABC"');
    expect(html).not.toContain(">http://localhost/s/01ABC<");
  });

  it("labels the share column 共有", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("<th>共有</th>");
    expect(html).not.toContain("<th>共有 URL</th>");
  });

  it("wraps the table so narrow screens scroll the table, not the page", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    const html = await (await app.request("/")).text();
    // ラッパーの div が table を直接包んでいること。
    expect(html).toMatch(/<div class="css-[^"]*"><table/);
    // 横スクロールの指定がスタイルシートに出ていること。
    expect(html).toContain("overflow-x:auto");
  });

});

describe("CLIENT_SCRIPT", () => {
  it("does not contain a closing script tag that would break embedding", async () => {
    const { CLIENT_SCRIPT } = await import("./webScript.js");
    expect(CLIENT_SCRIPT).not.toContain("</script>");
  });

  // POST /upload writes the Firestore record before the browser PUTs to GCS,
  // so a failed PUT leaves an orphan row. The message tells the user to delete
  // it from the list, which requires the list to be refreshed.
  it("reloads after a delay when the GCS PUT fails, so the orphan row appears", async () => {
    const { CLIENT_SCRIPT } = await import("./webScript.js");
    const putFailure = CLIENT_SCRIPT.slice(
      CLIENT_SCRIPT.indexOf("if (!put.ok)"),
      CLIENT_SCRIPT.indexOf("} catch (err)")
    );
    expect(putFailure).toContain("ファイル情報だけが登録されている場合があります");
    expect(putFailure).toContain("再読み込み");
    expect(putFailure).toMatch(/setTimeout\(function \(\) \{ location\.reload\(\); \}, \d+\)/);
  });

  // null がそのまま無期限を意味する。Number("") が 0 になり 400 で弾かれる形や、
  // 日数がそのまま送られて無期限にならない形を防ぐ。
  it("sends ttlDays: null when the no-expiry checkbox is checked", async () => {
    const { CLIENT_SCRIPT } = await import("./webScript.js");
    const payload = CLIENT_SCRIPT.slice(
      CLIENT_SCRIPT.indexOf("body: JSON.stringify({"),
      CLIENT_SCRIPT.indexOf("if (!res.ok)")
    );
    expect(payload).toContain("noExpiryInput.checked ? null : Number(ttlInput.value)");
  });

  // 「7 日と入力しつつ無期限」という矛盾した状態を UI 側で作れなくする。
  it("disables the day input while the no-expiry checkbox is checked", async () => {
    const { CLIENT_SCRIPT } = await import("./webScript.js");
    expect(CLIENT_SCRIPT).toContain('noExpiryInput.addEventListener("change"');
    expect(CLIENT_SCRIPT).toContain("ttlInput.disabled = noExpiryInput.checked");
    expect(CLIENT_SCRIPT).toContain("ttlInput.required = !noExpiryInput.checked");
  });
});

describe("GET /files/:id/headers/edit", () => {
  function mockDoc(exists: boolean, responseHeaders?: unknown) {
    vi.mocked(db.collection).mockReturnValue({
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists,
          data: () => ({ title: "Monthly Report", responseHeaders }),
        }),
      }),
    } as unknown as ReturnType<typeof db.collection>);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ALLOW_UNSANDBOXED_CONTENT;
  });

  it("returns 404 for an unknown id", async () => {
    mockDoc(false);
    expect((await app.request("/files/01MISSING/headers/edit")).status).toBe(404);
  });

  // The page shows the policy actually being sent rather than describing it, so
  // a mismatch between the copy and the behaviour cannot develop.
  it("shows the policy currently in effect", async () => {
    mockDoc(true, undefined);
    const html = await (await app.request("/files/01ABC/headers/edit")).text();
    expect(html).toContain("connect-src &#39;none&#39;");
  });

  // Asserts the text *between* the tags. A textarea has no value attribute —
  // rendering one produces markup that contains the origin but shows an empty
  // box, which a plain toContain on the whole page would happily accept.
  it("puts stored origins inside the textarea, not on an attribute", async () => {
    mockDoc(true, {
      allowedSources: { script: ["https://a.example.com", "https://b.example.com"] },
    });
    const html = await (await app.request("/files/01ABC/headers/edit")).text();

    const textarea = html.match(/<textarea data-source="script"[^>]*>([\s\S]*?)<\/textarea>/);
    expect(textarea?.[1]).toBe("https://a.example.com\nhttps://b.example.com");
  });

  it("leaves the textarea empty when nothing is stored", async () => {
    mockDoc(true, undefined);
    const html = await (await app.request("/files/01ABC/headers/edit")).text();

    const textarea = html.match(/<textarea data-source="script"[^>]*>([\s\S]*?)<\/textarea>/);
    expect(textarea?.[1]).toBe("");
  });

  // A stored sandbox list is the final set, not a delta, so the checkboxes must
  // follow it exactly — including the defaults it leaves out.
  it("checks exactly the stored sandbox tokens", async () => {
    mockDoc(true, { sandbox: ["allow-scripts"] });
    const html = await (await app.request("/files/01ABC/headers/edit")).text();

    expect(html).toMatch(/data-token="allow-scripts"[^>]*checked/);
    expect(html).not.toMatch(/data-token="allow-popups"[^>]*checked/);
  });

  // Every token says what it enables, not just the risky ones — a checkbox
  // whose effect is unstated is not a choice the user can actually make.
  it("describes every token, including the safe ones", async () => {
    mockDoc(true, undefined);
    const html = await (await app.request("/files/01ABC/headers/edit")).text();

    expect(html).toContain("レポート内の JavaScript が動きます");
    expect(html).toContain("マウスカーソルを固定");
  });

  // The operator opts in at deploy time. Until then the option must not exist
  // on the page at all — a disabled control still invites someone to look for
  // a way around it.
  it("omits allow-same-origin unless the operator enabled it", async () => {
    mockDoc(true, undefined);
    const html = await (await app.request("/files/01ABC/headers/edit")).text();
    expect(html).not.toContain("allow-same-origin");
  });

  it("offers allow-same-origin with its consequence spelled out once enabled", async () => {
    process.env.ALLOW_UNSANDBOXED_CONTENT = "true";
    mockDoc(true, undefined);
    const html = await (await app.request("/files/01ABC/headers/edit")).text();

    expect(html).toContain("allow-same-origin");
    expect(html).toContain("全ファイルの一覧取得・閲覧・削除");
  });
});

describe("the file list", () => {
  it("links each row to its header settings", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    const html = await (await app.request("/")).text();
    expect(html).toContain('href="/files/01ABC/headers/edit"');
  });
});
