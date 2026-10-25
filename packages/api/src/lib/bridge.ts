/**
 * 配信する本体 HTML に差し込むブリッジ。親画面（外枠ページ）とは postMessage だけでやり取りする。
 * 保存する HTML には入れず、serve.ts の配信時にだけ差し込む。
 */
import { BRIDGE_ANCHOR_LIB } from "./bridgeAnchor.js";

// 照合ロジックを使う側。親画面とのやり取りはここに足していく。
const BRIDGE_BODY = String.raw`
function timPost(message) {
  message.tim = 1;
  window.parent.postMessage(message, "*");
}

// ブリッジは <head> の先頭で動くので、本文ができてから準備完了を知らせる。
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () { timPost({ type: "tim:ready" }); });
} else {
  timPost({ type: "tim:ready" });
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

export function injectBridge(html: string): string {
  for (const pattern of INSERT_AFTER) {
    const m = pattern.exec(html);
    if (m) {
      const at = m.index + m[0].length;
      return html.slice(0, at) + BRIDGE_TAG + html.slice(at);
    }
  }
  return BRIDGE_TAG + html;
}
