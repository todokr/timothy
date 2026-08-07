import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/files.js", () => ({
  listFiles: vi.fn(),
  resolveBaseUrl: vi.fn().mockReturnValue("http://localhost"),
}));

import { listFiles } from "../lib/files.js";
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

  it("marks expired files with a badge", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry({ id: "01OLD", expiresAt: "2000-01-01T00:00:00.000Z" }),
    ]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("期限切れ");
  });

  it("does not mark live files as expired", async () => {
    vi.mocked(listFiles).mockResolvedValue([entry()]);
    const html = await (await app.request("/")).text();
    expect(html).not.toContain("期限切れ");
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

  it("declares a dark color scheme", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toMatch(/color-scheme:\s*dark/);
  });

  it("hides the decorative rails from assistive technology", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toContain('aria-hidden="true"');
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
});
