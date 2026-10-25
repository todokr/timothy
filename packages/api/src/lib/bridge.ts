/**
 * 配信する本体 HTML に差し込むブリッジ。親画面（外枠ページ）とは postMessage だけでやり取りする。
 * 保存する HTML には入れず、serve.ts の配信時にだけ差し込む。
 */
import { BRIDGE_ANCHOR_LIB } from "./bridgeAnchor.js";
import { BRIDGE_MESSAGES } from "./bridgeProtocol.js";

// メッセージ種別は親画面と同じ定数から埋め込む。
const BRIDGE_MESSAGE_VARS = `var TIM_MSG = {
${Object.entries(BRIDGE_MESSAGES)
  .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
  .join(",\n")}
};`;

// 画面に出す UI のスタイル。Shadow DOM の中に入れるので、ページの CSS とは干渉しない。
const BRIDGE_UI_CSS = [
  "[hidden] { display: none !important; }",
  ".box { position: fixed; box-sizing: border-box; pointer-events: none; z-index: 2147483647; border-radius: 2px; }",
  ".hover { outline: 1px dashed #0969da; }",
  ".picked { outline: 2px solid #0969da; }",
  ".mark { background: rgba(255, 212, 0, 0.18); outline: 1px solid rgba(212, 167, 44, 0.6); }",
  ".mark.active { background: rgba(255, 170, 0, 0.28); outline: 2px solid rgba(212, 140, 0, 0.8); }",
  ".flash { outline: 2px solid #0969da; outline-offset: 3px; }",
  ".button { position: fixed; z-index: 2147483647; margin: 0; padding: 4px 10px; font: 13px/1.4 system-ui, sans-serif;",
  "  color: #1f2328; background: #fff; border: 1px solid #d0d7de; border-radius: 6px;",
  "  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15); cursor: pointer; white-space: nowrap; }",
  ".button:hover { background: #f6f8fa; }",
].join("\n");

// ハイライトの色。CSS Custom Highlight API の ::highlight() は文書側のスタイルシートに書く必要がある。
const BRIDGE_HIGHLIGHT_CSS =
  "::highlight(tim-comments) { background-color: rgba(255, 212, 0, 0.3); }\n" +
  "::highlight(tim-comment-active) { background-color: rgba(255, 170, 0, 0.55); }";

// 照合ロジックを使う側。親画面とのやり取りと、本文上の操作・表示を受け持つ。
// ブリッジは <head> の先頭で動くので、キャプチャフェーズのリスナーはすぐ登録し（ページのリスナーより先に動かす）、
// 本文や UI に触る処理は DOM ができてから始める。
const BRIDGE_BODY = String.raw`
${BRIDGE_MESSAGE_VARS}
var TIM_UI_CSS = ${JSON.stringify(BRIDGE_UI_CSS)};
var TIM_HIGHLIGHT_CSS = ${JSON.stringify(BRIDGE_HIGHLIGHT_CSS)};
var TIM_PICK_EVENTS = ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "auxclick", "contextmenu"];
var TIM_REFRESH_DELAY = 300;
var TIM_FLASH_DURATION = 1200;

var timHost = null;
var timUi = null;
var timHighlights = null;
var timPicking = false;
var timHovered = null;
var timPicked = null;
var timTextRange = null;
var timAnchors = [];
var timActiveId = null;
var timMarks = [];
var timLastStates = null;
var timRefreshTimer = null;
var timRepositionQueued = false;
var timFlashTarget = null;
var timFlashTimer = null;

function timPost(message) {
  message.tim = 1;
  window.parent.postMessage(message, "*");
}

// ブリッジ自身の UI（Shadow DOM の中）で起きたイベントか。外から見ると対象はホストに付け替わる。
function timIsOwn(e) {
  if (!timHost) return false;
  if (e.target === timHost) return true;
  var path = typeof e.composedPath === "function" ? e.composedPath() : [];
  return path.indexOf(timHost) !== -1;
}

function timIsEditable(t) {
  if (!t || t.nodeType !== 1) return false;
  var name = t.localName;
  if (name === "input" || name === "textarea" || name === "select") return true;
  if (t.isContentEditable) return true;
  var editable = t.closest ? t.closest("[contenteditable]") : null;
  return !!editable && editable.getAttribute("contenteditable") !== "false";
}

// コメントの対象にできる要素か。本文の外・本文そのもの・ブリッジ自身の UI は除く。
function timPickable(t) {
  var body = document.body;
  if (!t || t.nodeType !== 1 || !body || t === body || t === timHost || !body.contains(t)) return null;
  return t;
}

function timRect(target) {
  return target && typeof target.getBoundingClientRect === "function" ? target.getBoundingClientRect() : null;
}

function timStateOf(target) {
  if (!target) return "outdated";
  var rects = typeof target.getClientRects === "function" ? target.getClientRects() : [];
  return rects.length === 0 ? "hidden" : "attached";
}

// flat は同じ照合の中で使い回す document.body の平坦化（省略時はその場で作る）。
function timFind(anchor, flat) {
  var body = document.body;
  if (!body || !anchor || typeof anchor !== "object") return null;
  try {
    if (anchor.type === "text") return timFindText(body, anchor, flat);
    if (anchor.type === "element") return timFindElement(body, anchor);
  } catch (err) {
    // 親から届いた対象の形が崩れていても、ブリッジは止めずに見つからない扱いにする。
  }
  return null;
}

function timElement(tag, className, parent) {
  var el = document.createElement(tag);
  if (className) el.className = className;
  parent.appendChild(el);
  return el;
}

function timButton(label, role, parent, onClick) {
  var b = timElement("button", "button", parent);
  b.type = "button";
  b.textContent = label;
  b.setAttribute("data-role", role);
  b.hidden = true;
  // 押しても文字選択が外れないようにする。ブリッジ自身のボタンの操作はページのリスナーに見せない。
  b.addEventListener("mousedown", function (e) {
    e.preventDefault();
    e.stopPropagation();
  });
  b.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
  b.addEventListener("click", function (e) {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function timSetupUi() {
  timHost = document.createElement("div");
  timHost.setAttribute("data-tim-bridge", "");
  timHost.style.cssText = "all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important;" +
    " width: 0 !important; height: 0 !important; display: block !important; z-index: 2147483647 !important;";
  var root = timHost.attachShadow({ mode: "open" });
  var style = document.createElement("style");
  style.textContent = TIM_UI_CSS;
  root.appendChild(style);
  timUi = {
    marks: timElement("div", "", root),
    hover: timElement("div", "box hover", root),
    picked: timElement("div", "box picked", root),
    flash: timElement("div", "box flash", root),
    textButton: timButton("💬 コメント", "text-comment", root, timComposeText),
    pickButton: timButton("💬 この要素にコメント", "pick-comment", root, timComposeElement)
  };
  timUi.hover.hidden = true;
  timUi.picked.hidden = true;
  timUi.flash.hidden = true;
  document.documentElement.appendChild(timHost);
}

function timSetupHighlights() {
  if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight !== "function") return;
  try {
    var normal = new Highlight();
    var active = new Highlight();
    active.priority = 1;
    CSS.highlights.set("tim-comments", normal);
    CSS.highlights.set("tim-comment-active", active);
    if (typeof CSSStyleSheet === "function" && document.adoptedStyleSheets) {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(TIM_HIGHLIGHT_CSS);
      document.adoptedStyleSheets = Array.prototype.slice.call(document.adoptedStyleSheets).concat([sheet]);
    }
    timHighlights = { normal: normal, active: active };
  } catch (err) {
    timHighlights = null;
  }
}

function timPlaceBox(box, target, pad) {
  var r = timRect(target);
  if (!r || (r.width === 0 && r.height === 0)) {
    box.hidden = true;
    return;
  }
  pad = pad || 0;
  box.hidden = false;
  box.style.left = (r.left - pad) + "px";
  box.style.top = (r.top - pad) + "px";
  box.style.width = (r.width + pad * 2) + "px";
  box.style.height = (r.height + pad * 2) + "px";
}

// ボタンを矩形の右下に置く。画面の外にはみ出さないように寄せる。
function timPlaceButton(button, r) {
  var right = r ? r.right : 0;
  var bottom = r ? r.bottom : 0;
  var width = button.offsetWidth || 0;
  var height = button.offsetHeight || 0;
  var left = Math.max(4, Math.min(right - width, window.innerWidth - width - 4));
  var top = Math.max(4, Math.min(bottom + 6, window.innerHeight - height - 4));
  button.style.left = left + "px";
  button.style.top = top + "px";
}

function timTextRect(range) {
  var rects = typeof range.getClientRects === "function" ? range.getClientRects() : [];
  return rects.length > 0 ? rects[rects.length - 1] : timRect(range);
}

function timHideTextButton() {
  timTextRange = null;
  if (timUi) timUi.textButton.hidden = true;
}

function timClearSelection() {
  var sel = window.getSelection ? window.getSelection() : null;
  if (sel && sel.rangeCount > 0) sel.removeAllRanges();
  timHideTextButton();
}

function timOnSelectionChange() {
  if (!timUi) return;
  if (timPicking) {
    timClearSelection();
    return;
  }
  var sel = window.getSelection ? window.getSelection() : null;
  var body = document.body;
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !body) {
    timHideTextButton();
    return;
  }
  var range = sel.getRangeAt(0);
  if (!body.contains(range.commonAncestorContainer) || timNormalize(range.toString()) === "") {
    timHideTextButton();
    return;
  }
  timTextRange = range.cloneRange();
  timUi.textButton.hidden = false;
  timPlaceButton(timUi.textButton, timTextRect(timTextRange));
}

function timComposeText() {
  var range = timTextRange;
  timHideTextButton();
  if (!range || !document.body) return;
  var anchor = timCaptureText(document.body, range);
  // 上限の確認は親画面が行う（超えていればトーストで知らせる）。
  if (anchor) timPost({ type: TIM_MSG.COMPOSE, anchor: anchor });
}

function timStartPick() {
  timPicking = true;
  timClearSelection();
}

function timEndPick(notify) {
  if (!timPicking) return;
  timPicking = false;
  timHovered = null;
  timPicked = null;
  if (timUi) {
    timUi.hover.hidden = true;
    timUi.picked.hidden = true;
    timUi.pickButton.hidden = true;
  }
  if (notify) timPost({ type: TIM_MSG.PICK_ENDED });
}

function timPickElement(el) {
  timPicked = el;
  if (!el) {
    timUi.picked.hidden = true;
    timUi.pickButton.hidden = true;
    return;
  }
  timPlaceBox(timUi.picked, el);
  timUi.pickButton.hidden = false;
  timPlaceButton(timUi.pickButton, timRect(el));
}

function timComposeElement() {
  var el = timPickable(timPicked);
  if (!el) {
    timPickElement(null);
    return;
  }
  timPost({ type: TIM_MSG.COMPOSE, anchor: timCaptureElement(document.body, el) });
  timEndPick(true);
}

// 要素選択モード中は、ページへのクリック類をキャプチャフェーズで止める（ブリッジ自身の UI は除く）。
function timOnPickEvent(e) {
  if (!timPicking || timIsOwn(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === "click" && timUi) timPickElement(timPickable(e.target));
}

function timOnMouseOver(e) {
  if (!timPicking || !timUi || timIsOwn(e)) return;
  timHovered = timPickable(e.target);
  timPlaceBox(timUi.hover, timHovered);
}

// Escape はモード中ならモードを終えるだけ。モード外では、ページの入力欄で押したものは親に送らない。
function timOnKeyDown(e) {
  if (e.code === "KeyC" && e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat && !timIsEditable(e.target)) {
    e.preventDefault();
    timPost({ type: TIM_MSG.KEY, key: "toggle-pick" });
  } else if (e.key === "Escape" && !e.isComposing) {
    if (timPicking) timEndPick(true);
    else if (!timIsEditable(e.target)) timPost({ type: TIM_MSG.KEY, key: "escape" });
  }
}

function timWithoutHash(href) {
  var at = href.indexOf("#");
  return at === -1 ? href : href.slice(0, at);
}

// 外枠ページの frame-src で本体の中からは外部へ移動できないため、別の文書へのリンクは親画面に開いてもらう。
// 同じ文書の #… はそのまま本体の中で動かす。http・https 以外のスキームは触らない。
function timOnLinkClick(e) {
  if (timPicking || timIsOwn(e)) return;
  var t = e.target;
  if (!t || t.nodeType !== 1 || typeof t.closest !== "function") return;
  var a = t.closest("a[href]");
  if (!a) return;
  var url;
  try {
    url = new URL(a.getAttribute("href"), document.baseURI);
  } catch (err) {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (timWithoutHash(url.href) === timWithoutHash(window.location.href)) return;
  e.preventDefault();
  timPost({ type: TIM_MSG.OPEN_LINK, href: url.href });
}

function timPaintText(normal, active) {
  if (!timHighlights) return;
  timHighlights.normal.clear();
  timHighlights.active.clear();
  for (var i = 0; i < normal.length; i++) timHighlights.normal.add(normal[i]);
  for (var j = 0; j < active.length; j++) timHighlights.active.add(active[j]);
}

function timPlaceMarks() {
  if (!timUi) return;
  var container = timUi.marks;
  while (container.firstChild) container.removeChild(container.firstChild);
  for (var i = 0; i < timMarks.length; i++) {
    var box = timElement("div", timMarks[i].active ? "box mark active" : "box mark", container);
    timPlaceBox(box, timMarks[i].el);
  }
}

// 対象を照合し直してハイライトを描き、状態を親に送る。force でなければ状態が変わったときだけ送る。
function timRefresh(force) {
  var states = {};
  var normal = [];
  var active = [];
  var marks = [];
  // 文字範囲の照合ごとに本文を平坦化し直さないよう、最初に要ったときに 1 回だけ作る。
  var flat = null;
  for (var i = 0; i < timAnchors.length; i++) {
    var entry = timAnchors[i];
    if (!flat && document.body && entry.anchor && entry.anchor.type === "text") flat = timFlatten(document.body);
    var target = timFind(entry.anchor, flat);
    states[entry.id] = timStateOf(target);
    if (!target || entry.highlight !== true) continue;
    var isActive = entry.id === timActiveId;
    if (target.nodeType === 1) marks.push({ el: target, active: isActive });
    else (isActive ? active : normal).push(target);
  }
  timPaintText(normal, active);
  timMarks = marks;
  timPlaceMarks();
  var key = JSON.stringify(states);
  if (force || key !== timLastStates) {
    timLastStates = key;
    timPost({ type: TIM_MSG.ANCHOR_STATES, states: states });
  }
}

// 本文の変化（タブ切り替えなどで表示が変わった場合を含む）は 300ms に 1 回まで照合し直す。
function timScheduleRefresh() {
  if (timRefreshTimer !== null || timAnchors.length === 0) return;
  timRefreshTimer = setTimeout(function () {
    timRefreshTimer = null;
    timRefresh(false);
  }, TIM_REFRESH_DELAY);
}

// スクロール・リサイズのたびに、本文に重ねた枠とボタンを追従させる。
function timReposition() {
  timRepositionQueued = false;
  if (!timUi) return;
  timPlaceMarks();
  if (timPicking) {
    timPlaceBox(timUi.hover, timHovered);
    if (timPicked) timPickElement(timPicked);
  }
  if (timTextRange) timPlaceButton(timUi.textButton, timTextRect(timTextRange));
  if (timFlashTarget) timPlaceBox(timUi.flash, timFlashTarget, 3);
}

function timScheduleReposition() {
  if (timRepositionQueued) return;
  timRepositionQueued = true;
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(timReposition);
  else setTimeout(timReposition, 16);
}

function timFlash(target) {
  timFlashTarget = target;
  timPlaceBox(timUi.flash, target, 3);
  if (timFlashTimer !== null) clearTimeout(timFlashTimer);
  timFlashTimer = setTimeout(function () {
    timFlashTimer = null;
    timFlashTarget = null;
    timUi.flash.hidden = true;
  }, TIM_FLASH_DURATION);
}

function timScrollTo(target) {
  if (target.nodeType === 1) {
    target.scrollIntoView({ block: "center", inline: "nearest" });
    return;
  }
  var start = target.startContainer;
  var el = start.nodeType === 1 ? start : start.parentElement;
  if (el) el.scrollIntoView({ block: "center", inline: "nearest" });
  // 長い段落では要素の中央と文字範囲がずれるので、範囲が画面外なら範囲の中央へ寄せる。
  var r = timRect(target);
  if (r && (r.top < 0 || r.bottom > window.innerHeight)) window.scrollBy(0, r.top + r.height / 2 - window.innerHeight / 2);
}

function timFocus(id) {
  var entry = null;
  for (var i = 0; i < timAnchors.length; i++) {
    if (timAnchors[i].id === id) entry = timAnchors[i];
  }
  var target = entry ? timFind(entry.anchor) : null;
  var state = timStateOf(target);
  if (entry && timActiveId !== id) {
    timActiveId = id;
    timRefresh(false);
  }
  if (state === "attached") {
    timScrollTo(target);
    timFlash(target);
  }
  timPost({ type: TIM_MSG.FOCUS_RESULT, id: id, state: state });
}

function timOnMessage(e) {
  if (e.source !== window.parent) return;
  var d = e.data;
  if (!d || typeof d !== "object" || d.tim !== 1) return;
  if (d.type === TIM_MSG.SET_PICK) {
    if (d.on === true) timStartPick(); else timEndPick(false);
  } else if (d.type === TIM_MSG.SET_ANCHORS) {
    var list = Array.isArray(d.anchors) ? d.anchors : [];
    timAnchors = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a && typeof a === "object" && typeof a.id === "string") timAnchors.push(a);
    }
    timActiveId = typeof d.activeId === "string" ? d.activeId : null;
    timRefresh(true);
  } else if (d.type === TIM_MSG.FOCUS) {
    if (typeof d.id === "string") timFocus(d.id);
  } else if (d.type === TIM_MSG.CLEAR_SELECTION) {
    timClearSelection();
  }
}

for (var timI = 0; timI < TIM_PICK_EVENTS.length; timI++) {
  window.addEventListener(TIM_PICK_EVENTS[timI], timOnPickEvent, true);
}
window.addEventListener("click", timOnLinkClick, true);
window.addEventListener("mouseover", timOnMouseOver, true);
window.addEventListener("keydown", timOnKeyDown, true);
window.addEventListener("scroll", timScheduleReposition, { capture: true, passive: true });
window.addEventListener("resize", function () {
  timScheduleReposition();
  timScheduleRefresh();
});
document.addEventListener("selectionchange", timOnSelectionChange);

function timStart() {
  timSetupUi();
  timSetupHighlights();
  if (document.body && typeof MutationObserver === "function") {
    new MutationObserver(timScheduleRefresh).observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true
    });
  }
  window.addEventListener("message", timOnMessage);
  timPost({ type: TIM_MSG.READY });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", timStart);
} else {
  timStart();
}
`;

export const BRIDGE_SCRIPT = `(function () {
"use strict";
${BRIDGE_ANCHOR_LIB}
${BRIDGE_BODY}
})();
`;

const BRIDGE_TAG = `<script data-tim-bridge>${BRIDGE_SCRIPT}</script>`;

// <head> があればその直後、無ければ <html> の直後、無ければ doctype の直後、どれも無ければ先頭。
// doctype より前に置くと互換モードになるため、doctype は必ず先頭に残す。
const INSERT_AFTER = [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i, /<!doctype[^>]*>/i];

// HTML コメント（閉じていないものは末尾まで）。同じ長さの空白に置き換えて、位置を変えずに探索から外す。
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;

// 探すのは最初の <body・<script より前だけにする。ページのスクリプトや本文の中の "<head>" という文字列には差し込まない。
const SEARCH_END = /<body|<script/i;

export function injectBridge(html: string): string {
  const masked = html.replace(HTML_COMMENT, (m) => " ".repeat(m.length));
  const end = masked.search(SEARCH_END);
  const head = end === -1 ? masked : masked.slice(0, end);
  for (const pattern of INSERT_AFTER) {
    const m = pattern.exec(head);
    if (m) {
      const at = m.index + m[0].length;
      return html.slice(0, at) + BRIDGE_TAG + html.slice(at);
    }
  }
  return BRIDGE_TAG + html;
}
