// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VIEWER_HELPERS, VIEWER_SCRIPT } from "./viewerScript.js";

type Person = { email: string; name: string };
type Comment = {
  id: string;
  version: number;
  anchor: Record<string, unknown>;
  body: string;
  author: Person;
  createdAt: string;
  resolved: boolean;
  replies: { id: string; body: string; author: Person; viaAgent: boolean; createdAt: string }[];
};

type Helpers = {
  visibleComments: (list: Comment[], shown: number, showResolved: boolean) => Comment[];
  unresolvedCount: (list: Comment[], shown: number) => number;
  anchorsMessage: (
    list: Comment[],
    activeId: string | null,
  ) => { type: string; anchors: Record<string, unknown>[]; activeId: string | null };
  formatDate: (iso: string) => string;
  anchorLabel: (anchor: Record<string, unknown>) => string;
  replyAuthorLabel: (reply: { author: Person; viaAgent: boolean }) => string;
  isValidAnchor: (anchor: unknown) => boolean;
  composeProblemMessage: (anchor: unknown) => string | null;
  focusResultMessage: (state: string, shown: number, version: number) => string | null;
};

const h = new Function(
  VIEWER_HELPERS +
    "; return { visibleComments, unresolvedCount, anchorsMessage, formatDate, anchorLabel, replyAuthorLabel, isValidAnchor, composeProblemMessage, focusResultMessage };",
)() as Helpers;

const ALICE: Person = { email: "alice@example.com", name: "Alice" };

function comment(id: string, version: number, extra: Partial<Comment> = {}): Comment {
  return {
    id,
    version,
    anchor: { type: "text", quote: `引用 ${id}`, prefix: "", suffix: "" },
    body: `本文 ${id}`,
    author: ALICE,
    createdAt: `2026-10-0${version}T00:00:00.000Z`,
    resolved: false,
    replies: [],
    ...extra,
  };
}

// c4 は解決済み、c3 は表示中より新しい版
const COMMENTS: Comment[] = [
  comment("c2", 2),
  comment("c1", 1),
  comment("c3", 3),
  comment("c4", 2, { resolved: true, createdAt: "2026-10-05T00:00:00.000Z" }),
];

describe("VIEWER_SCRIPT", () => {
  it("parses as JavaScript", () => {
    expect(() => new Function(VIEWER_SCRIPT)).not.toThrow();
  });

  it("checks the message source and never trusts origin", () => {
    expect(VIEWER_SCRIPT).toContain("event.source !== frame.contentWindow");
    expect(VIEWER_SCRIPT).not.toMatch(/event\.origin/);
  });

  it("never writes user content with innerHTML", () => {
    expect(VIEWER_SCRIPT).not.toMatch(/\.innerHTML\s*=/);
  });

  it("never posts comment bodies or authors to the frame", () => {
    const withReply = comment("c1", 1, {
      replies: [{ id: "r1", body: "返信", author: ALICE, viaAgent: false, createdAt: "2026-10-01T00:00:00.000Z" }],
    });
    const msg = h.anchorsMessage([withReply], null);
    const text = JSON.stringify(msg);
    expect(text).not.toContain("本文");
    expect(text).not.toContain("返信");
    expect(text).not.toContain("alice@example.com");
    expect(Object.keys(msg).sort()).toEqual(["activeId", "anchors", "type"]);
  });
});

describe("viewer helpers", () => {
  it("shows only comments up to the shown version and hides resolved ones by default", () => {
    expect(h.visibleComments(COMMENTS, 2, false).map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(h.visibleComments(COMMENTS, 2, true).map((c) => c.id)).toEqual(["c1", "c2", "c4"]);
  });

  it("counts unresolved comments up to the shown version", () => {
    expect(h.unresolvedCount(COMMENTS, 2)).toBe(2);
    expect(h.unresolvedCount(COMMENTS, 3)).toBe(3);
  });

  it("builds set-anchors with only id, anchor and highlight", () => {
    const msg = h.anchorsMessage(h.visibleComments(COMMENTS, 2, true), "c1");
    expect(msg.type).toBe("tim:set-anchors");
    expect(msg.activeId).toBe("c1");
    expect(msg.anchors.every((a) => Object.keys(a).sort().join() === "anchor,highlight,id")).toBe(true);
    expect(msg.anchors.map((a) => [a.id, a.highlight])).toEqual([
      ["c1", true],
      ["c2", true],
      ["c4", false],
    ]);
  });

  it("formats dates in Asia/Tokyo", () => {
    expect(h.formatDate("2026-02-01T00:00:00Z")).toBe("2026-02-01 09:00");
  });

  it("labels a text anchor by its quote", () => {
    expect(h.anchorLabel({ type: "text", quote: "スナップショット", prefix: "", suffix: "" })).toBe('"スナップショット"');
  });

  it("labels an element anchor by its text, or by its tag when empty", () => {
    expect(h.anchorLabel({ type: "element", tag: "td", text: "日次", path: [0] })).toBe("▢ 要素「日次」");
    expect(h.anchorLabel({ type: "element", tag: "rect", text: "", path: [0] })).toBe("▢ 要素 <rect>");
    expect(h.anchorLabel({ type: "element", tag: "p", text: "あ".repeat(80), path: [] })).toBe(
      `▢ 要素「${"あ".repeat(60)}」`,
    );
  });

  it("appends （agent 経由） to replies made by an agent", () => {
    expect(h.replyAuthorLabel({ author: ALICE, viaAgent: true })).toBe("Alice（agent 経由）");
    expect(h.replyAuthorLabel({ author: ALICE, viaAgent: false })).toBe("Alice");
  });

  it("accepts anchors within the limits", () => {
    expect(h.isValidAnchor({ type: "text", quote: "あ".repeat(1000), prefix: "", suffix: "" })).toBe(true);
    expect(h.isValidAnchor({ type: "element", tag: "clipPath", text: "", path: [0, 1, 100000] })).toBe(true);
  });

  it("rejects a compose anchor that breaks the limits", () => {
    expect(h.isValidAnchor({ type: "text", quote: "あ".repeat(1001), prefix: "", suffix: "" })).toBe(false);
    expect(h.isValidAnchor({ type: "text", quote: "   ", prefix: "", suffix: "" })).toBe(false);
    expect(h.isValidAnchor({ type: "text", quote: "a", prefix: "x".repeat(33), suffix: "" })).toBe(false);
    expect(h.isValidAnchor({ type: "text", quote: "a", prefix: "", suffix: "", extra: 1 })).toBe(false);
    expect(h.isValidAnchor({ type: "element", tag: "1div", text: "", path: [] })).toBe(false);
    expect(h.isValidAnchor({ type: "element", tag: "div", text: "x".repeat(201), path: [] })).toBe(false);
    expect(h.isValidAnchor({ type: "element", tag: "div", text: "", path: [-1] })).toBe(false);
    expect(h.isValidAnchor({ type: "element", tag: "div", text: "", path: new Array(65).fill(0) })).toBe(false);
    expect(h.isValidAnchor({ type: "element", tag: "div", text: "", path: [100001] })).toBe(false);
    expect(h.isValidAnchor({ type: "other" })).toBe(false);
    expect(h.isValidAnchor(null)).toBe(false);
  });

  it("explains why a compose anchor was rejected", () => {
    expect(h.composeProblemMessage({ type: "text", quote: "a".repeat(1001), prefix: "", suffix: "" })).toBe(
      "選択範囲が長すぎます（1,000 文字まで）",
    );
    expect(h.composeProblemMessage({ type: "element", tag: "1div", text: "", path: [] })).toBe(
      "この箇所にはコメントできません",
    );
    expect(h.composeProblemMessage({ type: "text", quote: "a", prefix: "", suffix: "" })).toBeNull();
  });

  it("explains a focus result that could not be shown", () => {
    expect(h.focusResultMessage("outdated", 3, 1)).toBe(
      "v3 には引用箇所がありません。v1 に切り替えると確認できます",
    );
    expect(h.focusResultMessage("hidden", 3, 1)).toBe("この要素はいま表示されていません（裏のタブなど）");
    expect(h.focusResultMessage("attached", 3, 1)).toBeNull();
  });
});

// 外枠ページの DOM を組み、スクリプトを実際に動かして iframe とのやり取りを確かめる。
// happy-dom は iframe を読み込もうとしてエラーを出すので、iframe の代わりに contentWindow を持たせた div を置く。
describe("viewer script in a page", () => {
  let posted: Record<string, unknown>[];
  let frameWindow: { postMessage: (msg: Record<string, unknown>, target: string) => void };
  let fetchMock: ReturnType<typeof vi.fn>;
  let comments: Comment[];

  function page(scriptsAllowed = true, shown = 2, latest = 3) {
    document.body.replaceChildren();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<select id="version-select"><option value="2" selected>v2</option></select>
      <button id="pick-toggle" aria-pressed="false"${scriptsAllowed ? "" : " disabled"}>◎</button>
      <div id="viewer-frame"></div>
      <aside id="comment-panel" data-file-id="01ABC" data-shown-version="${shown}" data-latest-version="${latest}" data-scripts-allowed="${scriptsAllowed}">
        <div id="composer" hidden>
          <div id="composer-anchor"></div>
          <textarea id="composer-text"></textarea>
          <div id="composer-error" hidden></div>
          <button id="composer-submit">コメント</button>
          <button id="composer-cancel">キャンセル</button>
        </div>
        <p id="idle-hint"></p>
        <span id="comment-count"></span>
        <input type="checkbox" id="show-resolved">
        <div id="comment-list"></div>
      </aside>
      <div id="toast" hidden></div>`,
    );
    const frame = document.getElementById("viewer-frame")!;
    Object.defineProperty(frame, "contentWindow", { value: frameWindow, configurable: true });
  }

  function json(status: number, data: unknown) {
    return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
  }

  // fetch の応答を読むところまで、何回かタスクを回して待つ。
  async function settle(rounds = 5): Promise<void> {
    if (rounds === 0) return;
    await new Promise((r) => setTimeout(r, 0));
    return settle(rounds - 1);
  }

  function fromFrame(data: Record<string, unknown>, source: unknown = frameWindow) {
    window.dispatchEvent(new MessageEvent("message", { data: { tim: 1, ...data }, source: source as Window }));
  }

  function run() {
    new Function(VIEWER_SCRIPT)();
  }

  function sentOf(type: string) {
    return posted.filter((m) => m.type === type);
  }

  beforeEach(() => {
    posted = [];
    frameWindow = { postMessage: (msg) => posted.push(msg) };
    comments = [comment("c1", 1), comment("c2", 2, { body: "<b>太字</b>" }), comment("c3", 3)];
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (!init || !init.method || init.method === "GET") return json(200, { comments });
      return json(201, { comment: comments[0] });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("lists comments up to the shown version as text, and counts unresolved ones", async () => {
    page();
    run();
    await settle();
    expect(fetchMock).toHaveBeenCalledWith("/files/01ABC/comments", expect.anything());
    const cards = document.querySelectorAll("#comment-list [data-comment-id]");
    expect([...cards].map((c) => c.getAttribute("data-comment-id"))).toEqual(["c1", "c2"]);
    expect(document.getElementById("comment-list")!.textContent).toContain("<b>太字</b>");
    expect(document.querySelector("#comment-list b")).toBeNull();
    expect(document.getElementById("comment-count")!.textContent).toBe("2 件の未解決コメント");
  });

  it("shows an empty message when the version has no comments", async () => {
    comments = [];
    page();
    run();
    await settle();
    expect(document.getElementById("comment-list")!.textContent).toBe("この版にはまだコメントがありません");
  });

  it("sends nothing to the frame before ready, then sends anchors on every ready", async () => {
    page();
    run();
    await settle();
    expect(posted).toEqual([]);
    fromFrame({ type: "tim:ready" });
    expect(sentOf("tim:set-anchors")).toHaveLength(1);
    expect(sentOf("tim:set-anchors")[0]).toMatchObject({ tim: 1, activeId: null });
    expect((sentOf("tim:set-anchors")[0].anchors as { id: string }[]).map((a) => a.id)).toEqual(["c1", "c2"]);
    fromFrame({ type: "tim:ready" });
    expect(sentOf("tim:set-anchors")).toHaveLength(2);
  });

  it("ignores messages from other windows or without the tim marker", async () => {
    page();
    run();
    await settle();
    fromFrame({ type: "tim:ready" }, window);
    window.dispatchEvent(new MessageEvent("message", { data: { type: "tim:ready" }, source: frameWindow as unknown as Window }));
    expect(posted).toEqual([]);
  });

  it("labels cards from anchor states", async () => {
    page();
    run();
    await settle();
    fromFrame({ type: "tim:anchor-states", states: { c1: "outdated", c2: "hidden" } });
    const c1 = document.querySelector('[data-comment-id="c1"]')!;
    const c2 = document.querySelector('[data-comment-id="c2"]')!;
    expect(c1.textContent).toContain("Outdated");
    expect(c2.textContent).toContain("非表示の要素");
  });

  it("focuses a card and toasts when its target is outdated", async () => {
    page();
    run();
    await settle();
    fromFrame({ type: "tim:ready" });
    (document.querySelector('[data-comment-id="c1"]') as HTMLElement).click();
    expect(sentOf("tim:focus")).toEqual([{ tim: 1, type: "tim:focus", id: "c1" }]);
    fromFrame({ type: "tim:focus-result", id: "c1", state: "outdated" });
    expect(document.getElementById("toast")!.textContent).toBe(
      "v2 には引用箇所がありません。v1 に切り替えると確認できます",
    );
  });

  it("opens the composer on compose without sending, then posts the comment", async () => {
    page();
    run();
    await settle();
    fromFrame({ type: "tim:ready" });
    fromFrame({ type: "tim:compose", anchor: { type: "text", quote: "選んだ文", prefix: "", suffix: "" } });
    expect(document.getElementById("composer")!.hidden).toBe(false);
    expect(document.getElementById("composer-anchor")!.textContent).toBe('"選んだ文"');
    expect(document.activeElement).toBe(document.getElementById("composer-text"));
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(0);

    (document.getElementById("composer-text") as HTMLTextAreaElement).value = "ここを直す";
    document.getElementById("composer-text")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
    await settle();
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(post[0]).toBe("/files/01ABC/comments");
    expect(post[1].headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(post[1].body)).toEqual({
      version: 2,
      anchor: { type: "text", quote: "選んだ文", prefix: "", suffix: "" },
      body: "ここを直す",
    });
    expect(document.getElementById("toast")!.textContent).toBe("過去の版へのコメントとして保存しました");
    expect(document.getElementById("composer")!.hidden).toBe(true);
    expect(sentOf("tim:clear-selection")).toHaveLength(1);
  });

  it("keeps the input and shows the error when posting fails", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === "POST" ? json(400, { error: "body must not be empty" }) : json(200, { comments }),
    );
    page();
    run();
    await settle();
    fromFrame({ type: "tim:compose", anchor: { type: "text", quote: "選んだ文", prefix: "", suffix: "" } });
    (document.getElementById("composer-text") as HTMLTextAreaElement).value = "x";
    document.getElementById("composer-submit")!.click();
    await settle();
    expect(document.getElementById("composer")!.hidden).toBe(false);
    expect((document.getElementById("composer-text") as HTMLTextAreaElement).value).toBe("x");
    expect(document.getElementById("composer-error")!.hidden).toBe(false);
    expect(document.getElementById("composer-error")!.textContent).toContain("body must not be empty");
  });

  it("toasts and keeps the composer closed for an anchor that breaks the limits", async () => {
    page();
    run();
    await settle();
    fromFrame({ type: "tim:compose", anchor: { type: "text", quote: "a".repeat(1001), prefix: "", suffix: "" } });
    expect(document.getElementById("composer")!.hidden).toBe(true);
    expect(document.getElementById("toast")!.textContent).toBe("選択範囲が長すぎます（1,000 文字まで）");
  });

  it("toggles pick mode with the button and ends it on pick-ended", async () => {
    page();
    run();
    await settle();
    fromFrame({ type: "tim:ready" });
    const button = document.getElementById("pick-toggle")!;
    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(sentOf("tim:set-pick")).toEqual([{ tim: 1, type: "tim:set-pick", on: true }]);
    fromFrame({ type: "tim:pick-ended" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fromFrame({ type: "tim:key", key: "toggle-pick" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fromFrame({ type: "tim:key", key: "escape" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the composer open when the same Escape ended pick mode in the frame", async () => {
    page();
    run();
    await settle();
    fromFrame({ type: "tim:ready" });
    fromFrame({ type: "tim:compose", anchor: { type: "text", quote: "選んだ文", prefix: "", suffix: "" } });
    document.getElementById("pick-toggle")!.click();
    // ブリッジはモード中の Escape で pick-ended と escape を続けて送る
    fromFrame({ type: "tim:pick-ended" });
    fromFrame({ type: "tim:key", key: "escape" });
    expect(document.getElementById("composer")!.hidden).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.getElementById("composer")!.hidden).toBe(true);
  });

  it("toggles pick mode with Alt+C but not while typing", async () => {
    page();
    run();
    await settle();
    const button = document.getElementById("pick-toggle")!;
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyC", key: "ç", altKey: true, bubbles: true }));
    expect(button.getAttribute("aria-pressed")).toBe("true");
    document.getElementById("composer-text")!.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyC", key: "ç", altKey: true, bubbles: true }),
    );
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("does not enter pick mode when scripts are not allowed", async () => {
    page(false);
    run();
    await settle();
    fromFrame({ type: "tim:key", key: "toggle-pick" });
    expect(document.getElementById("pick-toggle")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("opens only http and https links", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    page();
    run();
    await settle();
    fromFrame({ type: "tim:open-link", href: "javascript:alert(1)" });
    fromFrame({ type: "tim:open-link", href: "not a url" });
    fromFrame({ type: "tim:open-link", href: "https://example.com/a" });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener,noreferrer");
  });

  it("replies and resolves through the API", async () => {
    page();
    run();
    await settle();
    const card = document.querySelector('[data-comment-id="c1"]')!;
    (card.querySelector("[data-action=reply]") as HTMLElement).click();
    const box = card.querySelector("textarea") as HTMLTextAreaElement;
    box.value = "了解";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    await settle();
    (document.querySelector('[data-comment-id="c1"] [data-action=resolve]') as HTMLElement).click();
    await settle();
    const posts = fetchMock.mock.calls.filter((c) => c[1]?.method === "POST");
    expect(posts.map((c) => [c[0], JSON.parse(c[1].body)])).toEqual([
      ["/files/01ABC/comments/c1/replies", { body: "了解" }],
      ["/files/01ABC/comments/c1/resolve", { resolved: true }],
    ]);
  });
});
