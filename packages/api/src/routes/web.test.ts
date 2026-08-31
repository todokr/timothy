import { describe, it, expect, vi, beforeEach } from "vitest";

// 差し替えるのは Firestore を触る listFiles / resolveBaseUrl だけ。
// HTML_FILES_COLLECTION と純関数の indexStateOf は本物を使う。
vi.mock("../lib/files.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/files.js")>()),
  listFiles: vi.fn(),
  resolveBaseUrl: vi.fn().mockReturnValue("http://localhost"),
}));
vi.mock("../lib/search.js", () => ({ searchFiles: vi.fn() }));

vi.mock("../lib/firebase.js", () => ({
  db: { collection: vi.fn() },
}));

import { listFiles } from "../lib/files.js";
import { db } from "../lib/firebase.js";
import { searchFiles } from "../lib/search.js";
import app, { formatJst, isExpired } from "./web.js";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ABC",
    title: "Monthly Report",
    description: "Details",
    url: "http://localhost/s/01ABC",
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-08-07T03:04:00.000Z",
    // 既定は取り込み済み。バッジが出ないことを前提にしたテストが多いため。
    extractorVersion: 1,
    textLength: 120,
    chunkCount: 2,
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

  // 説明はタイトルに従属する情報なので、独立した列を持たずタイトルの下に入る。
  it("renders the description inside the title cell instead of its own column", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    const html = await (await app.request("/")).text();

    expect(html).not.toContain("<th>説明</th>");

    const titleCell = html.slice(html.indexOf("Monthly Report"));
    expect(titleCell.slice(0, titleCell.indexOf("</td>"))).toContain("Details");
  });

  // 空の要素が残ると margin の分だけ行の高さが揺れる。
  it("omits the description element when there is no description", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry({ description: "" })]);
    const html = await (await app.request("/")).text();

    const titleCell = html.slice(html.indexOf("Monthly Report"));
    expect(titleCell.slice(0, titleCell.indexOf("</td>"))).not.toContain("<span");
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

function hit(overrides: Record<string, unknown> = {}) {
  return {
    id: "01ABC",
    title: "Monthly Report",
    description: "Details",
    url: "http://localhost/s/01ABC",
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-08-07T03:04:00.000Z",
    score: 3,
    snippets: [{ before: "sales ", match: "grew", after: " last month" }],
    ...overrides,
  };
}

describe("GET / の取り込み状態の表示", () => {
  beforeEach(() => {
    vi.mocked(searchFiles).mockReset();
    vi.mocked(listFiles).mockReset();
  });

  it("flags a file that has not been indexed", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry({ extractorVersion: undefined, textLength: 0, chunkCount: 0 }),
    ]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("未取り込み");
    // 一覧からそのまま取り込める導線があること。
    expect(html).toContain("data-reindex");
    expect(html).toContain("取り込みが必要なファイル 1 件");
  });

  // 埋め込み時にモデルが使えないと、本文はあるがベクトルが無い状態になる。
  it("flags a file whose body was extracted but never embedded", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry({ extractorVersion: 1, textLength: 120, chunkCount: 0 }),
    ]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("本文のみ");
  });

  it("shows no badge and no notice once everything is indexed", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    const html = await (await app.request("/")).text();
    expect(html).not.toContain("未取り込み");
    expect(html).not.toContain("本文のみ");
    expect(html).not.toContain("取り込みが必要なファイル");
  });

  // 抽出できる本文が無い文書（JS デモなど）はチャンクが無くて当たり前。
  it("does not flag a document that has no extractable text", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry({ extractorVersion: 1, textLength: 0, chunkCount: 0 }),
    ]);
    const html = await (await app.request("/")).text();
    expect(html).not.toContain("本文のみ");
    expect(html).not.toContain("取り込みが必要なファイル");
  });
});

describe("GET / with a search query", () => {
  beforeEach(() => {
    vi.mocked(searchFiles).mockReset();
    vi.mocked(listFiles).mockReset();
  });

  it("renders the search box on the plain listing page", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toContain('type="search"');
    expect(html).toContain('name="q"');
    // クエリが無いときは検索しない。
    expect(searchFiles).not.toHaveBeenCalled();
  });

  it("renders hits with the matched text wrapped in mark", async () => {
    vi.mocked(searchFiles).mockResolvedValue({
      query: "grew",
      hits: [hit()],
      pendingCount: 0,
    } as never);

    const html = await (await app.request("/?q=grew")).text();

    expect(searchFiles).toHaveBeenCalledWith("grew", "http://localhost");
    expect(html).toContain("<mark>grew</mark>");
    expect(html).toContain("Monthly Report");
    expect(html).toContain("検索結果 1 件");
  });

  it("trims the query before searching", async () => {
    vi.mocked(searchFiles).mockResolvedValue({
      query: "grew",
      hits: [],
      pendingCount: 0,
    } as never);
    await app.request("/?q=%20grew%20");
    expect(vi.mocked(searchFiles).mock.calls[0][0]).toBe("grew");
  });

  // スニペットはアップロードされた HTML から取り出したテキストなので、
  // 管理画面から見れば敵性の入力。raw() や dangerouslySetInnerHTML で
  // 組み立てると serve.ts の sandbox CSP が守っている境界を自分で壊す。
  it("escapes HTML inside a snippet instead of rendering it", async () => {
    vi.mocked(searchFiles).mockResolvedValue({
      query: "script",
      hits: [
        hit({
          title: "<img src=x onerror=alert(1)>",
          snippets: [
            { before: "<script>alert(1)</script>", match: "script", after: "</p>" },
          ],
        }),
      ],
      pendingCount: 0,
    } as never);

    const html = await (await app.request("/?q=script")).text();

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    // ハイライト自体は生きていること。
    expect(html).toContain("<mark>script</mark>");
  });

  it("shows a distinct empty state naming the query", async () => {
    vi.mocked(searchFiles).mockResolvedValue({
      query: "missing",
      hits: [],
      pendingCount: 0,
    } as never);

    const html = await (await app.request("/?q=missing")).text();
    expect(html).toContain("「missing」に一致するファイルはありません");
    expect(html).not.toContain("まだファイルがありません");
  });

  it("offers the reindex button when files are not indexed yet", async () => {
    vi.mocked(searchFiles).mockResolvedValue({
      query: "q",
      hits: [],
      pendingCount: 3,
    } as never);

    const html = await (await app.request("/?q=q")).text();
    expect(html).toContain("取り込みが必要なファイル 3 件");
    expect(html).toContain("data-reindex");
  });

  it("hides the reindex notice when nothing is pending", async () => {
    vi.mocked(searchFiles).mockResolvedValue({
      query: "q",
      hits: [],
      pendingCount: 0,
    } as never);

    const html = await (await app.request("/?q=q")).text();
    expect(html).not.toContain("取り込みが必要なファイル");
  });

  // CLIENT_SCRIPT はアップロードフォームの要素を前提に初期化するので、
  // 検索結果ページから外すと削除・コピー・再インデックスのハンドラごと死ぬ。
  it("still renders the upload form so the client script can initialise", async () => {
    vi.mocked(searchFiles).mockResolvedValue({
      query: "q",
      hits: [],
      pendingCount: 0,
    } as never);

    const html = await (await app.request("/?q=q")).text();
    expect(html).toContain('id="upload-form"');
    expect(html).toContain('id="drop-zone"');
    expect(html).toContain('id="submit-button"');
  });

  it("keeps the search box on the error page", async () => {
    vi.mocked(searchFiles).mockRejectedValue(new Error("boom"));
    const res = await app.request("/?q=q");
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('name="q"');
  });
});

describe("CLIENT_SCRIPT", () => {
  // 一覧では tr、検索結果では article が行にあたるため、両方を拾う必要がある。
  it("finds the row for a delete button in both the table and the search results", async () => {
    const { CLIENT_SCRIPT } = await import("./webScript.js");
    expect(CLIENT_SCRIPT).toContain('closest("tr, article")');
  });

  it("loops the reindex call until nothing remains", async () => {
    const { CLIENT_SCRIPT } = await import("./webScript.js");
    expect(CLIENT_SCRIPT).toContain('fetch("/files/reindex"');
    expect(CLIENT_SCRIPT).toContain("body.remaining === 0");
  });

  it("indexes the file contents after a successful upload", async () => {
    const { CLIENT_SCRIPT } = await import("./webScript.js");
    expect(CLIENT_SCRIPT).toContain('"/files/" + encodeURIComponent(issued.id) + "/index"');
  });

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
