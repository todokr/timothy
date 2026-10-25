/**
 * ブリッジ（本体 HTML の中で動くスクリプト）のうち、コメント対象の記録と照合を行う部分。
 * 本体は不透明オリジンの sandbox で動くため DOM 以外に頼らない。
 * バンドラを持ち込まないため、素の JavaScript を文字列として保持する。
 * 関数を宣言するだけで、読み込んだ時点では何もしない。
 */
import { ANCHOR_LIMITS } from "./anchors.js";

export const BRIDGE_ANCHOR_LIB = String.raw`
var TIM_CONTEXT_LENGTH = ${ANCHOR_LIMITS.context};
var TIM_ELEMENT_TEXT_LENGTH = ${ANCHOR_LIMITS.elementText};

function timNormalize(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

// 照合の対象から外す要素。ブリッジ自身が差し込む要素も data-tim-bridge で外す。
function timIsSkipped(el) {
  var name = el.localName;
  return name === "script" || name === "style" || name === "noscript" || name === "template" ||
    el.hasAttribute("data-tim-bridge");
}

// root 以下の文字を文書順に並べ、空白を詰めた 1 本の文字列にする。
// map[i] は text の i 文字目がどのテキストノードの何文字目から来たか。
function timFlatten(root) {
  var chars = [];
  var map = [];
  var lastIsSpace = true;
  function walk(node) {
    for (var c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) {
        var data = c.data;
        for (var i = 0; i < data.length; i++) {
          var ch = data.charAt(i);
          if (/\s/.test(ch)) {
            // 連続する空白は先頭の 1 文字だけを半角空白として残す。先頭の空白は捨てる。
            if (lastIsSpace) continue;
            ch = " ";
            lastIsSpace = true;
          } else {
            lastIsSpace = false;
          }
          chars.push(ch);
          map.push({ node: c, offset: i });
        }
      } else if (c.nodeType === 1 && !timIsSkipped(c)) {
        walk(c);
      }
    }
  }
  walk(root);
  if (chars.length > 0 && chars[chars.length - 1] === " ") {
    chars.pop();
    map.pop();
  }
  return { text: chars.join(""), map: map };
}

// pred が false から true に切り替わる最初の添字。map は文書順なので二分探索できる。
function timFirstIndex(length, pred) {
  var lo = 0;
  var hi = length;
  while (lo < hi) {
    var mid = (lo + hi) >> 1;
    if (pred(mid)) hi = mid; else lo = mid + 1;
  }
  return lo;
}

function timCaptureText(root, range) {
  var flat = timFlatten(root);
  var text = flat.text;
  var map = flat.map;
  // 範囲の始点以降にある最初の文字と、終点までに収まる最後の文字を探す。
  var start = timFirstIndex(map.length, function (i) {
    return range.comparePoint(map[i].node, map[i].offset) >= 0;
  });
  var end = timFirstIndex(map.length, function (i) {
    return range.comparePoint(map[i].node, map[i].offset + 1) > 0;
  }) - 1;
  while (start <= end && text.charAt(start) === " ") start++;
  while (end >= start && text.charAt(end) === " ") end--;
  if (start > end) return null;
  return {
    type: "text",
    quote: text.slice(start, end + 1),
    prefix: text.slice(Math.max(0, start - TIM_CONTEXT_LENGTH), start),
    suffix: text.slice(end + 1, end + 1 + TIM_CONTEXT_LENGTH)
  };
}

function timCommonSuffixLength(a, b) {
  var n = 0;
  while (n < a.length && n < b.length && a.charAt(a.length - 1 - n) === b.charAt(b.length - 1 - n)) n++;
  return n;
}

function timCommonPrefixLength(a, b) {
  var n = 0;
  while (n < a.length && n < b.length && a.charAt(n) === b.charAt(n)) n++;
  return n;
}

// 同じ文字列が複数あるときは、保存した前後の文脈との一致が最も長い箇所を選ぶ。
// どの箇所とも 1 文字も一致しなければ見つからない扱い（別の箇所に付け替えない）。
function timFindText(root, anchor) {
  var quote = anchor.quote;
  if (!quote) return null;
  var flat = timFlatten(root);
  var text = flat.text;
  var positions = [];
  for (var at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) positions.push(at);
  if (positions.length === 0) return null;

  var best = positions[0];
  if (positions.length > 1) {
    var bestScore = 0;
    best = -1;
    for (var i = 0; i < positions.length; i++) {
      var p = positions[i];
      var before = text.slice(Math.max(0, p - anchor.prefix.length), p);
      var after = text.slice(p + quote.length, p + quote.length + anchor.suffix.length);
      var score = timCommonSuffixLength(before, anchor.prefix) + timCommonPrefixLength(after, anchor.suffix);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best === -1) return null;
  }

  var first = flat.map[best];
  var last = flat.map[best + quote.length - 1];
  var range = root.ownerDocument.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}

function timElementText(el) {
  return timFlatten(el).text.slice(0, TIM_ELEMENT_TEXT_LENGTH);
}

function timCaptureElement(root, el) {
  var path = [];
  for (var node = el; node && node !== root && node.parentElement; node = node.parentElement) {
    path.unshift(Array.prototype.indexOf.call(node.parentElement.children, node));
  }
  return { type: "element", tag: el.localName, text: timElementText(el), path: path };
}

function timIsInsideSkipped(root, el) {
  for (var node = el; node && node !== root; node = node.parentElement) {
    if (timIsSkipped(node)) return true;
  }
  return false;
}

// 同じタグで文字が一致する要素がちょうど 1 つならそれ。そうでなければ位置とタグで追う。
// 文字が一致する要素が複数あっても先頭を選ばない（無理に付け替えない）。
function timFindElement(root, anchor) {
  var all = root.getElementsByTagName("*");
  var found = null;
  var count = 0;
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.localName !== anchor.tag || timIsInsideSkipped(root, el)) continue;
    if (timElementText(el) === anchor.text) {
      found = el;
      count++;
    }
  }
  if (count === 1) return found;

  var node = root;
  for (var j = 0; j < anchor.path.length; j++) {
    node = node.children[anchor.path[j]];
    if (!node) return null;
  }
  return node !== root && node.localName === anchor.tag ? node : null;
}
`;
