// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { BRIDGE_ANCHOR_LIB } from "./bridgeAnchor.js";

type Lib = {
  timCaptureText: (root: Element, range: Range) => { type: "text"; quote: string; prefix: string; suffix: string } | null;
  timFindText: (root: Element, anchor: { type: "text"; quote: string; prefix: string; suffix: string }) => Range | null;
  timCaptureElement: (root: Element, el: Element) => { type: "element"; tag: string; text: string; path: number[] };
  timFindElement: (root: Element, anchor: { type: "element"; tag: string; text: string; path: number[] }) => Element | null;
};

const lib = new Function(
  BRIDGE_ANCHOR_LIB + "; return { timCaptureText, timFindText, timCaptureElement, timFindElement };",
)() as Lib;

function body(html: string) {
  document.body.innerHTML = html;
}

// 本文中の文字列 a の先頭から b の末尾までの Range を作る。
function rangeOver(a: string, b: string): Range {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let start: [Node, number] | null = null;
  let end: [Node, number] | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent ?? "";
    if (!start && t.includes(a)) start = [n, t.indexOf(a)];
    if (start && !end && t.includes(b)) end = [n, t.indexOf(b) + b.length];
  }
  const range = document.createRange();
  range.setStart(start![0], start![1]);
  range.setEnd(end![0], end![1]);
  return range;
}

describe("bridge anchor lib", () => {
  it("round-trips a text selection across element boundaries and whitespace", () => {
    body(`<p>新しい PVC は<b>スナップショット</b>から
        複製する。</p>`);
    const anchor = lib.timCaptureText(document.body, rangeOver("PVC は", "複製する"));
    expect(anchor).toEqual({ type: "text", quote: "PVC はスナップショットから 複製する", prefix: "新しい ", suffix: "。" });
    expect(lib.timFindText(document.body, anchor!)!.toString().replace(/\s+/g, " ")).toBe("PVC はスナップショットから 複製する");
  });

  it("picks the occurrence whose context matches when the quote appears twice", () => {
    body(`<p>手動で 日次 実行する</p><p>CronJob が 日次 実行する</p>`);
    const r = lib.timFindText(document.body, { type: "text", quote: "日次", prefix: "CronJob が ", suffix: " 実行する" });
    expect(r!.startContainer.parentElement!.textContent).toContain("CronJob");
  });

  it("treats a duplicated quote with no matching context as outdated", () => {
    body(`<p>A 日次 B</p><p>C 日次 D</p>`);
    expect(lib.timFindText(document.body, { type: "text", quote: "日次", prefix: "X", suffix: "Y" })).toBeNull();
  });

  it("ignores context when the quote is unique", () => {
    body(`<p>全く別の 日次 文脈</p>`);
    expect(lib.timFindText(document.body, { type: "text", quote: "日次", prefix: "X", suffix: "Y" })).not.toBeNull();
  });

  it("does not match text inside script and style", () => {
    body(`<script>var a = "日次";</script><style>/* 日次 */</style><p>週次</p>`);
    expect(lib.timFindText(document.body, { type: "text", quote: "日次", prefix: "", suffix: "" })).toBeNull();
  });

  it("does not match text inside the bridge's own elements", () => {
    body(`<div data-tim-bridge>日次</div><p>週次</p>`);
    expect(lib.timFindText(document.body, { type: "text", quote: "日次", prefix: "", suffix: "" })).toBeNull();
  });

  it("returns null for a whitespace-only selection", () => {
    body(`<p>前</p>   <p>後</p>`);
    const range = document.createRange();
    const ws = document.body.childNodes[1];
    range.setStart(ws, 0);
    range.setEnd(ws, 3);
    expect(lib.timCaptureText(document.body, range)).toBeNull();
  });

  it("finds an element by tag and text, including SVG", () => {
    body(`<svg><text>古くなる</text></svg><table><tr><td>日次</td></tr></table>`);
    const svgText = document.querySelector("text")!;
    expect(lib.timFindElement(document.body, lib.timCaptureElement(document.body, svgText))).toBe(svgText);
  });

  it("follows an element whose text changed by its position and tag", () => {
    body(`<table><tr><td>週次</td><td>日次</td></tr></table>`);
    const anchor = lib.timCaptureElement(document.body, document.querySelectorAll("td")[1]);
    body(`<table><tr><td>週次</td><td>日次（差分 fetch で追従）</td></tr></table>`);
    expect(lib.timFindElement(document.body, anchor)!.textContent).toBe("日次（差分 fetch で追従）");
  });

  it("does not reattach when the text is ambiguous and the position no longer matches", () => {
    const anchor = { type: "element" as const, tag: "td", text: "日次", path: [5, 0, 0, 0] };
    body(`<table><tr><td>日次</td><td>日次</td></tr></table>`);
    expect(lib.timFindElement(document.body, anchor)).toBeNull();
  });

  it("does not take an element of another tag at the same position", () => {
    body(`<table><tr><td>週次</td><td>日次</td></tr></table>`);
    const anchor = lib.timCaptureElement(document.body, document.querySelectorAll("td")[1]);
    body(`<table><tr><td>週次</td><th>別物</th></tr></table>`);
    expect(lib.timFindElement(document.body, anchor)).toBeNull();
  });

  it("truncates element text to 200 characters", () => {
    body(`<div>${"あ".repeat(300)}</div>`);
    const anchor = lib.timCaptureElement(document.body, document.querySelector("div")!);
    expect(anchor.text.length).toBe(200);
  });
});
