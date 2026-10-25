// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { BRIDGE_SCRIPT, injectBridge } from "./bridge.js";

describe("injectBridge", () => {
  it.each([
    ["<!doctype html><html><head><title>t</title></head><body>x</body></html>", /<head><script data-tim-bridge>/],
    ["<html lang=ja><body>x</body></html>", /<html lang=ja><script data-tim-bridge>/],
    ["<!DOCTYPE html><p>x</p>", /^<!DOCTYPE html><script data-tim-bridge>/],
    ["<p>x</p>", /^<script data-tim-bridge>/],
  ])("injects the bridge right after the opening tag in %s", (html, re) => expect(injectBridge(html)).toMatch(re));

  it("does not mistake <header> for <head>", () => {
    expect(injectBridge("<html><header>x</header></html>")).toMatch(/^<html><script data-tim-bridge>/);
  });

  it("keeps the doctype first so the page stays in standards mode", () => {
    expect(injectBridge("<!doctype html><p>x</p>").startsWith("<!doctype html>")).toBe(true);
  });

  it("keeps the original HTML intact", () => {
    const html = "<!doctype html><html><head><title>$&</title></head><body>x</body></html>";
    expect(injectBridge(html).replace(/<script data-tim-bridge>[\s\S]*?<\/script>/, "")).toBe(html);
  });

  it("does not look for <head> inside the page's scripts or body", () => {
    const html = `<html><body><script>var s="<head>";</script></body></html>`;
    const out = injectBridge(html);
    expect(out).toMatch(/^<html><script data-tim-bridge>/);
    expect(out).toContain(`<script>var s="<head>";</script>`);
    expect(out.replace(/<script data-tim-bridge>[\s\S]*?<\/script>/, "")).toBe(html);
  });

  it("does not put the bridge inside a leading HTML comment", () => {
    const out = injectBridge("<!-- <head> --><html><head><title>t</title></head><body>x</body></html>");
    expect(out).toMatch(/^<!-- <head> --><html><head><script data-tim-bridge>/);
    expect(injectBridge("<!doctype html><!-- <head> --><p>x</p>")).toMatch(/^<!doctype html><script data-tim-bridge>/);
  });
});

describe("BRIDGE_SCRIPT", () => {
  it("never closes its own script tag early", () => {
    expect(BRIDGE_SCRIPT).not.toMatch(/<\/script/i);
  });

  it("never opens an HTML comment that would confuse the script parser", () => {
    expect(BRIDGE_SCRIPT).not.toContain("<!--");
  });

  it("parses as JavaScript", () => {
    expect(() => new Function(BRIDGE_SCRIPT)).not.toThrow();
  });
});

// ブリッジはウィンドウにリスナーを登録したまま残るため、このファイルでは 1 回だけ起動して使い回す。
// happy-dom では window.parent === window なので、親への送信は window.postMessage で捕まえる。
describe("bridge interaction", () => {
  type Msg = { tim: number; type: string; [k: string]: unknown };
  let postMessage: ReturnType<typeof vi.spyOn>;

  function posted(): Msg[] {
    return postMessage.mock.calls.map((c: unknown[]) => c[0] as Msg);
  }
  function lastPosted(type: string): Msg {
    return posted().filter((m) => m.type === type).at(-1)!;
  }
  function fromParent(data: unknown) {
    window.dispatchEvent(new MessageEvent("message", { data, source: window }));
  }
  function body(html: string) {
    document.body.innerHTML = html;
  }
  function shadow(): ShadowRoot {
    return document.querySelector("[data-tim-bridge]")!.shadowRoot!;
  }
  function selectText(el: Element) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }

  beforeAll(() => {
    postMessage = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    body("");
    new Function(BRIDGE_SCRIPT)();
  });

  afterEach(() => {
    fromParent({ tim: 1, type: "tim:set-pick", on: false });
    // 照合対象を空にして、本文の変化による送り直しが次のテストに漏れないようにする。
    fromParent({ tim: 1, type: "tim:set-anchors", anchors: [], activeId: null });
    window.getSelection()?.removeAllRanges();
    postMessage.mockClear();
  });

  it("announces itself to the parent", () => {
    expect(posted()).toContainEqual({ tim: 1, type: "tim:ready" });
  });

  it("puts its UI in a shadow root outside the page body", () => {
    const host = document.querySelector("[data-tim-bridge]")!;
    expect(host.parentElement).toBe(document.documentElement);
    expect(host.shadowRoot).not.toBeNull();
  });

  it("keeps clicks from reaching the page while picking, and lets them through otherwise", () => {
    body(`<button id="tab">タブ</button>`);
    const pageHandler = vi.fn();
    document.getElementById("tab")!.addEventListener("click", pageHandler);
    fromParent({ tim: 1, type: "tim:set-pick", on: true });
    document.getElementById("tab")!.click();
    expect(pageHandler).not.toHaveBeenCalled();
    fromParent({ tim: 1, type: "tim:set-pick", on: false });
    document.getElementById("tab")!.click();
    expect(pageHandler).toHaveBeenCalledTimes(1);
  });

  it.each(["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "auxclick", "contextmenu"])(
    "keeps %s from reaching the page while picking",
    (type) => {
      body(`<button id="tab">タブ</button>`);
      const pageHandler = vi.fn();
      document.getElementById("tab")!.addEventListener(type, pageHandler);
      fromParent({ tim: 1, type: "tim:set-pick", on: true });
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true });
      document.getElementById("tab")!.dispatchEvent(ev);
      expect(pageHandler).not.toHaveBeenCalled();
      expect(ev.defaultPrevented).toBe(true);
    },
  );

  it("sends the picked element only when its comment button is pressed, then ends the mode", () => {
    body(`<ul><li>一</li><li id="two">二つ目</li></ul>`);
    fromParent({ tim: 1, type: "tim:set-pick", on: true });
    document.getElementById("two")!.click();
    expect(posted().some((m) => m.type === "tim:compose")).toBe(false);
    const button = shadow().querySelector<HTMLButtonElement>("[data-role=pick-comment]")!;
    expect(button.hidden).toBe(false);
    button.click();
    expect(lastPosted("tim:compose")).toEqual({
      tim: 1,
      type: "tim:compose",
      anchor: { type: "element", tag: "li", text: "二つ目", path: [0, 1] },
    });
    expect(posted()).toContainEqual({ tim: 1, type: "tim:pick-ended" });
    expect(button.hidden).toBe(true);
  });

  it("keeps clicks on its own buttons from reaching the page's listeners", () => {
    body(`<ul><li id="one">一</li></ul>`);
    const onDocument = vi.fn();
    const onWindow = vi.fn();
    const types = ["click", "mousedown", "pointerdown"];
    for (const t of types) {
      document.addEventListener(t, onDocument);
      window.addEventListener(t, onWindow);
    }
    try {
      fromParent({ tim: 1, type: "tim:set-pick", on: true });
      document.getElementById("one")!.click();
      const button = shadow().querySelector<HTMLButtonElement>("[data-role=pick-comment]")!;
      for (const t of ["pointerdown", "mousedown"]) {
        button.dispatchEvent(new MouseEvent(t, { bubbles: true, composed: true, cancelable: true }));
      }
      button.click();
      expect(lastPosted("tim:compose")).toBeDefined();
      expect(onDocument).not.toHaveBeenCalled();
      expect(onWindow).not.toHaveBeenCalled();
    } finally {
      for (const t of types) {
        document.removeEventListener(t, onDocument);
        window.removeEventListener(t, onWindow);
      }
    }
  });

  it("does not offer to comment on the body itself", () => {
    body(`<p>x</p>`);
    fromParent({ tim: 1, type: "tim:set-pick", on: true });
    document.body.click();
    expect(shadow().querySelector<HTMLButtonElement>("[data-role=pick-comment]")!.hidden).toBe(true);
  });

  it("forwards Alt+C as toggle-pick unless an input has focus", () => {
    const ev = new KeyboardEvent("keydown", { code: "KeyC", altKey: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(posted()).toContainEqual({ tim: 1, type: "tim:key", key: "toggle-pick" });
    expect(ev.defaultPrevented).toBe(true);

    postMessage.mockClear();
    body(`<input id="q"><div id="ed" contenteditable="true">x</div>`);
    for (const id of ["q", "ed"]) {
      const el = document.getElementById(id)!;
      el.focus();
      el.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyC", altKey: true, bubbles: true }));
    }
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyC", altKey: true, metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyC", altKey: true, ctrlKey: true }));
    expect(posted().some((m) => m.type === "tim:key")).toBe(false);
  });

  it("ignores Alt+C key repeats", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyC", altKey: true, repeat: true }));
    expect(posted().some((m) => m.type === "tim:key")).toBe(false);
  });

  it("ends picking on Escape without forwarding the key", () => {
    fromParent({ tim: 1, type: "tim:set-pick", on: true });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape" }));
    expect(posted()).toEqual([{ tim: 1, type: "tim:pick-ended" }]);
  });

  it("forwards Escape when not picking", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape" }));
    expect(posted()).toEqual([{ tim: 1, type: "tim:key", key: "escape" }]);
  });

  it("does not forward Escape typed in an input of the page", () => {
    body(`<input id="q">`);
    const input = document.getElementById("q")!;
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    expect(posted()).toEqual([]);
  });

  it("ignores messages that do not come from the parent", () => {
    body(`<button id="tab">タブ</button>`);
    const pageHandler = vi.fn();
    document.getElementById("tab")!.addEventListener("click", pageHandler);
    window.dispatchEvent(
      new MessageEvent("message", { data: { tim: 1, type: "tim:set-pick", on: true }, source: null }),
    );
    fromParent({ type: "tim:set-pick", on: true });
    document.getElementById("tab")!.click();
    expect(pageHandler).toHaveBeenCalledTimes(1);
  });

  it("reports anchor states for the anchors the parent sends", () => {
    body(`<p>PVC は共有する</p><h2>見出し</h2>`);
    fromParent({
      tim: 1,
      type: "tim:set-anchors",
      activeId: null,
      anchors: [
        { id: "a", anchor: { type: "text", quote: "PVC は共有する", prefix: "", suffix: "" }, highlight: true },
        { id: "b", anchor: { type: "text", quote: "存在しない", prefix: "", suffix: "" }, highlight: true },
        { id: "c", anchor: { type: "element", tag: "h2", text: "見出し", path: [1] }, highlight: false },
        { id: "d", anchor: { type: "element", tag: "table", text: "x", path: [5] }, highlight: false },
      ],
    });
    const states = lastPosted("tim:anchor-states").states as Record<string, string>;
    expect(states.b).toBe("outdated");
    expect(states.d).toBe("outdated");
    expect(states.a).not.toBe("outdated");
    expect(states.c).not.toBe("outdated");
  });

  it("reports anchor states again after the page changes", async () => {
    body(`<p>前</p>`);
    fromParent({
      tim: 1,
      type: "tim:set-anchors",
      activeId: null,
      anchors: [{ id: "a", anchor: { type: "text", quote: "後で出る", prefix: "", suffix: "" }, highlight: true }],
    });
    expect((lastPosted("tim:anchor-states").states as Record<string, string>).a).toBe("outdated");
    postMessage.mockClear();
    document.body.insertAdjacentHTML("beforeend", "<p>後で出る</p>");
    await vi.waitFor(() => expect(lastPosted("tim:anchor-states")).toBeDefined(), { timeout: 1000 });
    expect((lastPosted("tim:anchor-states").states as Record<string, string>).a).not.toBe("outdated");
  });

  it("answers a focus request with the anchor state", () => {
    body(`<p>ここ</p>`);
    fromParent({
      tim: 1,
      type: "tim:set-anchors",
      activeId: null,
      anchors: [
        { id: "a", anchor: { type: "text", quote: "ここ", prefix: "", suffix: "" }, highlight: true },
        { id: "b", anchor: { type: "text", quote: "無い", prefix: "", suffix: "" }, highlight: true },
      ],
    });
    fromParent({ tim: 1, type: "tim:focus", id: "b" });
    expect(lastPosted("tim:focus-result")).toEqual({ tim: 1, type: "tim:focus-result", id: "b", state: "outdated" });
    fromParent({ tim: 1, type: "tim:focus", id: "a" });
    expect(lastPosted("tim:focus-result").state).not.toBe("outdated");
  });

  it("asks the parent to open an external link instead of navigating the frame", () => {
    body(`<a id="ext" href="https://example.com/x">外部</a><a id="in" href="#sec">内部</a><a id="mail" href="mailto:a@example.com">メール</a>`);
    const ext = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.getElementById("ext")!.dispatchEvent(ext);
    expect(ext.defaultPrevented).toBe(true);
    expect(posted()).toContainEqual({ tim: 1, type: "tim:open-link", href: "https://example.com/x" });
    postMessage.mockClear();
    for (const id of ["in", "mail"]) {
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
      document.getElementById(id)!.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(posted().some((m) => m.type === "tim:open-link")).toBe(false);
  });

  it("never sends a compose message just because text was selected", () => {
    body(`<p id="p">PVC は共有する</p>`);
    selectText(document.getElementById("p")!);
    expect(posted().some((m) => m.type === "tim:compose")).toBe(false);
  });

  it("sends the selected text when its comment button is pressed", () => {
    body(`<p id="p">PVC は共有する</p>`);
    selectText(document.getElementById("p")!);
    const button = shadow().querySelector<HTMLButtonElement>("[data-role=text-comment]")!;
    expect(button.hidden).toBe(false);
    button.click();
    expect(lastPosted("tim:compose")).toEqual({
      tim: 1,
      type: "tim:compose",
      anchor: { type: "text", quote: "PVC は共有する", prefix: "", suffix: "" },
    });
    expect(button.hidden).toBe(true);
  });

  it("drops the text selection and its button when picking starts", () => {
    body(`<p id="p">PVC は共有する</p>`);
    selectText(document.getElementById("p")!);
    fromParent({ tim: 1, type: "tim:set-pick", on: true });
    expect(window.getSelection()!.rangeCount).toBe(0);
    expect(shadow().querySelector<HTMLButtonElement>("[data-role=text-comment]")!.hidden).toBe(true);
    selectText(document.getElementById("p")!);
    expect(window.getSelection()!.rangeCount).toBe(0);
    expect(shadow().querySelector<HTMLButtonElement>("[data-role=text-comment]")!.hidden).toBe(true);
  });

  it("clears the text selection when the parent asks", () => {
    body(`<p id="p">PVC は共有する</p>`);
    selectText(document.getElementById("p")!);
    fromParent({ tim: 1, type: "tim:clear-selection" });
    expect(window.getSelection()!.rangeCount).toBe(0);
    expect(shadow().querySelector<HTMLButtonElement>("[data-role=text-comment]")!.hidden).toBe(true);
  });
});
