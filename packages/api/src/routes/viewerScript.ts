/**
 * 共有ページ（外枠ページ）に埋め込むクライアントスクリプト。版の切り替えとコメントパネルを受け持ち、
 * iframe の中のブリッジとは postMessage だけでやり取りする。
 * バンドラを持ち込まないため、素の JavaScript を文字列として保持する。
 */
import { ANCHOR_LIMITS } from "../lib/anchors.js";
import { BRIDGE_MESSAGES } from "../lib/bridgeProtocol.js";

// メッセージ種別はブリッジと同じ定数から埋め込む。
const MESSAGE_VARS = `var TIM_MSG = {
${Object.entries(BRIDGE_MESSAGES)
  .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
  .join(",\n")}
};`;

const TOO_LONG_MESSAGE = `選択範囲が長すぎます（${ANCHOR_LIMITS.quote.toLocaleString("en-US")} 文字まで）`;

/**
 * パネルの描画に使う純粋関数。DOM に触れず、宣言するだけで何もしない。
 * テストでは new Function で取り出して呼ぶ。
 */
export const VIEWER_HELPERS = String.raw`
${MESSAGE_VARS}
var TIM_LIMITS = ${JSON.stringify(ANCHOR_LIMITS)};
// サーバー（lib/anchors.ts）と同じ条件。localName を想定するので SVG の大文字混じりも通す。
var TIM_TAG_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
var TIM_ELEMENT_LABEL_LENGTH = 60;
var TIM_DATE_FORMAT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

// 表示中の版以下のコメントを、作成順に並べる。解決済みは showResolved のときだけ含める。
function visibleComments(list, shown, showResolved) {
  return list
    .filter(function (c) { return c.version <= shown && (showResolved || !c.resolved); })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0; });
}

function unresolvedCount(list, shown) {
  return list.filter(function (c) { return c.version <= shown && !c.resolved; }).length;
}

// 本体には照合に要るものだけを渡す。本文や書いた人は本体の JS から読めてしまうので送らない。
function anchorsMessage(list, activeId) {
  return {
    type: TIM_MSG.SET_ANCHORS,
    anchors: list.map(function (c) { return { id: c.id, anchor: c.anchor, highlight: !c.resolved }; }),
    activeId: activeId
  };
}

function formatDate(iso) {
  return TIM_DATE_FORMAT.format(new Date(iso));
}

function anchorLabel(anchor) {
  if (anchor.type === "text") return '"' + anchor.quote + '"';
  var text = String(anchor.text || "").slice(0, TIM_ELEMENT_LABEL_LENGTH);
  return text ? "▢ 要素「" + text + "」" : "▢ 要素 <" + anchor.tag + ">";
}

function replyAuthorLabel(reply) {
  return reply.author.name + (reply.viaAgent ? "（agent 経由）" : "");
}

function timIsRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function timHasOnlyKeys(o, keys) {
  return Object.keys(o).every(function (k) { return keys.indexOf(k) !== -1; });
}

function timIsShortString(v, max) {
  return typeof v === "string" && v.length <= max;
}

// 対象が保存できない理由。null なら保存できる。文字範囲の長さ超えだけは "too-long" と区別する。
function anchorProblem(a) {
  if (!timIsRecord(a)) return "invalid";
  if (a.type === "text") {
    if (!timHasOnlyKeys(a, ["type", "quote", "prefix", "suffix"]) || typeof a.quote !== "string") return "invalid";
    var quote = a.quote.replace(/\s+/g, " ").trim();
    if (quote.length > TIM_LIMITS.quote) return "too-long";
    if (quote.length < 1) return "invalid";
    if (!timIsShortString(a.prefix, TIM_LIMITS.context) || !timIsShortString(a.suffix, TIM_LIMITS.context)) return "invalid";
    return null;
  }
  if (a.type === "element") {
    if (!timHasOnlyKeys(a, ["type", "tag", "text", "path"])) return "invalid";
    if (typeof a.tag !== "string" || !TIM_TAG_PATTERN.test(a.tag)) return "invalid";
    if (!timIsShortString(a.text, TIM_LIMITS.elementText)) return "invalid";
    if (!Array.isArray(a.path) || a.path.length > TIM_LIMITS.pathDepth) return "invalid";
    var pathOk = a.path.every(function (n) {
      return typeof n === "number" && Math.floor(n) === n && n >= 0 && n <= TIM_LIMITS.pathIndex;
    });
    return pathOk ? null : "invalid";
  }
  return "invalid";
}

function isValidAnchor(a) {
  return anchorProblem(a) === null;
}

function composeProblemMessage(a) {
  var problem = anchorProblem(a);
  if (problem === null) return null;
  return problem === "too-long" ? ${JSON.stringify(TOO_LONG_MESSAGE)} : "この箇所にはコメントできません";
}

function focusResultMessage(state, shown, version) {
  if (state === "outdated") {
    if (version === shown) return "この版では引用箇所が見つかりません";
    return "v" + shown + " には引用箇所がありません。v" + version + " に切り替えると確認できます";
  }
  if (state === "hidden") return "この要素はいま表示されていません（裏のタブなど）";
  return null;
}
`;

export const VIEWER_SCRIPT = String.raw`
(function () {
${VIEWER_HELPERS}

  var TOAST_DURATION = 2600;

  var versionSelect = document.getElementById("version-select");
  var frame = document.getElementById("viewer-frame");
  var panel = document.getElementById("comment-panel");
  var pickToggle = document.getElementById("pick-toggle");
  var composer = document.getElementById("composer");
  var composerAnchor = document.getElementById("composer-anchor");
  var composerText = document.getElementById("composer-text");
  var composerError = document.getElementById("composer-error");
  var composerSubmit = document.getElementById("composer-submit");
  var composerCancel = document.getElementById("composer-cancel");
  var idleHint = document.getElementById("idle-hint");
  var countLabel = document.getElementById("comment-count");
  var showResolvedInput = document.getElementById("show-resolved");
  var listEl = document.getElementById("comment-list");
  var toastEl = document.getElementById("toast");

  var fileId = panel.dataset.fileId;
  var shown = Number(panel.dataset.shownVersion);
  var latest = Number(panel.dataset.latestVersion);
  var scriptsAllowed = panel.dataset.scriptsAllowed === "true";
  var commentsUrl = "/files/" + encodeURIComponent(fileId) + "/comments";

  var comments = [];
  var visible = [];
  var states = {};
  var cards = {};
  // 書きかけの返信。一覧を描き直しても消えないように id ごとに持つ（キーがあれば返信欄を開く）。
  var replyDrafts = {};
  var activeId = null;
  // ブリッジの受信処理は tim:ready を送った後にしか無いので、それまでは何も送らない。
  var ready = false;
  var picking = false;
  var pendingAnchor = null;
  var submitting = false;
  var toastTimer = null;

  // 版を選んだら ?v=<N> へ移る。最新版を選んだときも ?v=<latest> にする。
  versionSelect.addEventListener("change", function (e) {
    location.href = "?v=" + encodeURIComponent(e.target.value);
  });

  // #… 付きで開かれたら、本体の中の同じ位置へ移れるよう iframe にも渡す。
  if (location.hash) frame.src = "/s/" + encodeURIComponent(fileId) + "/v/" + shown + location.hash;

  function post(message) {
    if (!ready || !frame.contentWindow) return;
    message.tim = 1;
    frame.contentWindow.postMessage(message, "*");
  }

  function sendAnchors() {
    post(anchorsMessage(visible, activeId));
  }

  function el(tag, className, parent, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastTimer = null;
      toastEl.hidden = true;
    }, TOAST_DURATION);
  }

  function isSubmitKey(e) {
    return e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.isComposing && e.keyCode !== 229;
  }

  function isEditable(t) {
    return !!t && t.nodeType === 1 && (t.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  // ---- API ----
  function postJson(url, payload) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function failureText(prefix, result) {
    if (!result) return prefix + "（通信に失敗しました）";
    var detail = result.data && typeof result.data.error === "string" ? result.data.error : "HTTP " + result.status;
    return prefix + "（" + detail + "）";
  }

  function loadComments() {
    return fetch(commentsUrl, { headers: { Accept: "application/json" } })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok || !data || !Array.isArray(data.comments)) throw new Error("load failed");
          comments = data.comments;
          render();
          sendAnchors();
        });
      })
      .catch(function () {
        listEl.replaceChildren(el("p", "hint", null, "コメントを読み込めませんでした"));
      });
  }

  // ---- 一覧 ----
  function labelsOf(c) {
    var out = [];
    if (states[c.id] === "outdated") out.push("Outdated");
    if (states[c.id] === "hidden") out.push("非表示の要素");
    if (c.resolved) out.push("解決済み");
    return out;
  }

  function updateLabels() {
    Object.keys(cards).forEach(function (id) {
      var entry = cards[id];
      entry.labels.replaceChildren();
      labelsOf(entry.comment).forEach(function (text) { el("span", "label", entry.labels, text); });
      entry.card.classList.toggle("outdated", states[id] === "outdated");
    });
  }

  function updateActive() {
    Object.keys(cards).forEach(function (id) {
      cards[id].card.classList.toggle("active", id === activeId);
    });
  }

  function person(parent, name, email) {
    var who = el("strong", "", parent, name);
    who.title = email;
  }

  function buildCard(c) {
    var card = el("div", "card" + (c.resolved ? " resolved" : ""));
    card.dataset.commentId = c.id;
    el("div", c.anchor.type === "element" ? "anchor el" : "anchor", card, anchorLabel(c.anchor));

    var meta = el("div", "meta", card);
    person(meta, c.author.name, c.author.email);
    var labels = el("span", "labels", meta);
    el("span", "hint", meta, "v" + c.version + "・" + formatDate(c.createdAt));
    el("div", "body", card, c.body);

    c.replies.forEach(function (r) {
      var reply = el("div", "reply", card);
      var replyMeta = el("div", "meta", reply);
      person(replyMeta, replyAuthorLabel(r), r.author.email);
      el("span", "hint", replyMeta, formatDate(r.createdAt));
      el("div", "body", reply, r.body);
    });

    var actions = el("div", "actions", card);
    var replyButton = el("button", "", actions, "返信");
    replyButton.type = "button";
    replyButton.dataset.action = "reply";
    var resolveButton = el("button", "", actions, c.resolved ? "未解決に戻す" : "解決にする");
    resolveButton.type = "button";
    resolveButton.dataset.action = "resolve";

    var replyBox = el("div", "reply-box", card);
    replyBox.hidden = !Object.prototype.hasOwnProperty.call(replyDrafts, c.id);
    var replyText = el("textarea", "", replyBox);
    replyText.placeholder = "返信を書く…";
    replyText.value = replyDrafts[c.id] || "";
    var sendButton = el("button", "primary", el("div", "row", replyBox), "返信");
    sendButton.type = "button";
    sendButton.dataset.action = "send-reply";
    var error = el("div", "error", card);
    error.hidden = true;

    function showError(message) {
      error.textContent = message;
      error.hidden = false;
    }

    function sendReply() {
      var body = replyText.value.trim();
      if (!body || sendButton.disabled) return;
      sendButton.disabled = true;
      error.hidden = true;
      postJson(commentsUrl + "/" + encodeURIComponent(c.id) + "/replies", { body: body })
        .then(function (result) {
          if (!result.ok) return showError(failureText("返信を保存できませんでした", result));
          delete replyDrafts[c.id];
          return loadComments();
        }, function () { showError(failureText("返信を保存できませんでした", null)); })
        .then(function () { sendButton.disabled = false; });
    }

    replyButton.addEventListener("click", function () {
      replyBox.hidden = !replyBox.hidden;
      if (replyBox.hidden) {
        delete replyDrafts[c.id];
      } else {
        replyDrafts[c.id] = replyText.value;
        replyText.focus();
      }
    });
    replyText.addEventListener("input", function () { replyDrafts[c.id] = replyText.value; });
    replyText.addEventListener("keydown", function (e) {
      if (!isSubmitKey(e)) return;
      e.preventDefault();
      sendReply();
    });
    sendButton.addEventListener("click", sendReply);

    resolveButton.addEventListener("click", function () {
      if (resolveButton.disabled) return;
      resolveButton.disabled = true;
      error.hidden = true;
      postJson(commentsUrl + "/" + encodeURIComponent(c.id) + "/resolve", { resolved: !c.resolved })
        .then(function (result) {
          if (!result.ok) return showError(failureText("状態を変更できませんでした", result));
          return loadComments();
        }, function () { showError(failureText("状態を変更できませんでした", null)); })
        .then(function () { resolveButton.disabled = false; });
    });

    card.addEventListener("click", function (e) {
      var t = e.target;
      if (t && typeof t.closest === "function" && t.closest("button, textarea, .reply-box")) return;
      activeId = c.id;
      updateActive();
      post({ type: TIM_MSG.FOCUS, id: c.id });
    });

    cards[c.id] = { card: card, labels: labels, comment: c };
    return card;
  }

  function render() {
    visible = visibleComments(comments, shown, showResolvedInput.checked);
    countLabel.textContent = unresolvedCount(comments, shown) + " 件の未解決コメント";
    cards = {};
    var nodes = visible.map(buildCard);
    if (nodes.length === 0) nodes.push(el("p", "hint", null, "この版にはまだコメントがありません"));
    listEl.replaceChildren.apply(listEl, nodes);
    updateLabels();
    updateActive();
  }

  showResolvedInput.addEventListener("change", function () {
    render();
    sendAnchors();
  });

  // ---- コメント欄 ----
  function showComposerError(message) {
    composerError.textContent = message;
    composerError.hidden = false;
  }

  function openComposer(anchor) {
    pendingAnchor = anchor;
    composerAnchor.className = anchor.type === "element" ? "anchor el" : "anchor";
    composerAnchor.textContent = anchorLabel(anchor);
    composerError.hidden = true;
    composer.hidden = false;
    if (idleHint) idleHint.hidden = true;
    composerText.focus();
  }

  function closeComposer() {
    pendingAnchor = null;
    composerText.value = "";
    composerError.hidden = true;
    composer.hidden = true;
    if (idleHint) idleHint.hidden = false;
  }

  function submitComment() {
    var body = composerText.value.trim();
    if (submitting || !pendingAnchor || !body) return;
    submitting = true;
    composerSubmit.disabled = true;
    composerError.hidden = true;
    postJson(commentsUrl, { version: shown, anchor: pendingAnchor, body: body })
      .then(function (result) {
        if (!result.ok) return showComposerError(failureText("コメントを保存できませんでした", result));
        if (shown !== latest) toast("過去の版へのコメントとして保存しました");
        closeComposer();
        post({ type: TIM_MSG.CLEAR_SELECTION });
        return loadComments();
      }, function () { showComposerError(failureText("コメントを保存できませんでした", null)); })
      .then(function () {
        submitting = false;
        composerSubmit.disabled = false;
      });
  }

  composerSubmit.addEventListener("click", submitComment);
  composerCancel.addEventListener("click", closeComposer);
  composerText.addEventListener("keydown", function (e) {
    if (!isSubmitKey(e)) return;
    e.preventDefault();
    submitComment();
  });

  // ---- 要素選択モード ----
  function setPicking(on) {
    if (on && !scriptsAllowed) return;
    picking = on;
    pickToggle.setAttribute("aria-pressed", on ? "true" : "false");
    post({ type: TIM_MSG.SET_PICK, on: on });
  }

  // 親画面での Escape。モード中ならモードを終え、そうでなければコメント欄を閉じる。
  function handleEscape() {
    if (picking) setPicking(false);
    else if (!composer.hidden) closeComposer();
  }

  pickToggle.addEventListener("click", function () { setPicking(!picking); });

  window.addEventListener("keydown", function (e) {
    if (e.isComposing || e.keyCode === 229) return;
    // ⌥+C は macOS では key が "ç" になるので code で見る（ブリッジと同じ条件）。
    if (e.code === "KeyC" && e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat && !isEditable(e.target)) {
      e.preventDefault();
      setPicking(!picking);
    } else if (e.key === "Escape") {
      handleEscape();
    }
  });

  function openLink(href) {
    if (typeof href !== "string") return;
    var url;
    try {
      url = new URL(href);
    } catch (err) {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    window.open(url.href, "_blank", "noopener,noreferrer");
  }

  function findVisible(id) {
    for (var i = 0; i < visible.length; i++) if (visible[i].id === id) return visible[i];
    return null;
  }

  // ---- ブリッジからのメッセージ ----
  // 本体は不透明オリジンで動くので origin では確かめられない。送り元のウィンドウで確かめる。
  window.addEventListener("message", function (event) {
    if (event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!timIsRecord(data) || data.tim !== 1) return;
    if (data.type === TIM_MSG.READY) {
      // iframe を読み込み直すたびに届く。ブリッジ側の状態は初期化されているので送り直す。
      ready = true;
      sendAnchors();
      if (picking) post({ type: TIM_MSG.SET_PICK, on: true });
    } else if (data.type === TIM_MSG.ANCHOR_STATES) {
      if (timIsRecord(data.states)) states = data.states;
      updateLabels();
    } else if (data.type === TIM_MSG.FOCUS_RESULT) {
      var c = findVisible(data.id);
      var message = c ? focusResultMessage(data.state, shown, c.version) : null;
      if (message) toast(message);
    } else if (data.type === TIM_MSG.COMPOSE) {
      var problem = composeProblemMessage(data.anchor);
      if (problem) toast(problem);
      else openComposer(data.anchor);
    } else if (data.type === TIM_MSG.KEY) {
      if (data.key === "toggle-pick") setPicking(!picking);
      // 本体からの Escape はモードを終えるだけ。コメント欄を閉じたり書きかけを消したりはしない。
      else if (data.key === "escape" && picking) setPicking(false);
    } else if (data.type === TIM_MSG.PICK_ENDED) {
      picking = false;
      pickToggle.setAttribute("aria-pressed", "false");
    } else if (data.type === TIM_MSG.OPEN_LINK) {
      openLink(data.href);
    }
  });

  loadComments();
})();
`;
