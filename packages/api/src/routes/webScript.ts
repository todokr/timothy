/**
 * 管理画面に埋め込むクライアントスクリプト。
 * バンドラを持ち込まないため、素の JavaScript を文字列として保持する。
 */
/**
 * GCS への PUT が失敗したとき、Firestore 側にだけ残ったレコードを一覧に出すため
 * 再読み込みするまでの待ち時間。エラーメッセージを読む時間を確保する。
 */
const ORPHAN_RELOAD_DELAY_MS = 4000;

export const CLIENT_SCRIPT = `
(function () {
  var form = document.getElementById("upload-form");
  var fileInput = document.getElementById("file-input");
  var titleInput = document.getElementById("title-input");
  var descriptionInput = document.getElementById("description-input");
  var ttlInput = document.getElementById("ttl-input");
  var noExpiryInput = document.getElementById("no-expiry-input");
  var submitButton = document.getElementById("submit-button");
  var dropZone = document.getElementById("drop-zone");
  var errorBox = document.getElementById("form-error");

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.textContent = "";
    errorBox.hidden = true;
  }

  function isHtmlFile(file) {
    return /\\.html?$/i.test(file.name);
  }

  function baseName(name) {
    return name.replace(/\\.html?$/i, "");
  }

  function fillTitleIfEmpty(file) {
    if (!titleInput.value) titleInput.value = baseName(file.name);
  }

  ["dragenter", "dragover"].forEach(function (type) {
    dropZone.addEventListener(type, function (e) {
      e.preventDefault();
      dropZone.dataset.dragging = "true";
    });
  });

  ["dragleave", "drop"].forEach(function (type) {
    dropZone.addEventListener(type, function (e) {
      e.preventDefault();
      dropZone.dataset.dragging = "false";
    });
  });

  dropZone.addEventListener("drop", function (e) {
    var file = e.dataTransfer && e.dataTransfer.files[0];
    if (!file) return;
    if (!isHtmlFile(file)) {
      showError("HTML ファイル (.html / .htm) を選択してください");
      return;
    }
    clearError();
    var transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    fillTitleIfEmpty(file);
  });

  fileInput.addEventListener("change", function () {
    var file = fileInput.files[0];
    if (file) fillTitleIfEmpty(file);
  });

  // 無期限を選んでいる間は日数入力を触れなくする。required も外さないと、
  // disabled でない限りブラウザの検証が空欄で止めてしまう。
  noExpiryInput.addEventListener("change", function () {
    ttlInput.disabled = noExpiryInput.checked;
    ttlInput.required = !noExpiryInput.checked;
  });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    clearError();

    var file = fileInput.files[0];
    if (!file) {
      showError("ファイルを選択してください");
      return;
    }
    if (!isHtmlFile(file)) {
      showError("HTML ファイル (.html / .htm) を選択してください");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "アップロード中...";

    try {
      var html = await file.text();

      var res = await fetch("/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleInput.value,
          description: descriptionInput.value,
          ttlDays: noExpiryInput.checked ? null : Number(ttlInput.value),
        }),
      });

      if (!res.ok) {
        var body = await res.json().catch(function () { return {}; });
        showError(body.error || "アップロードの準備に失敗しました (HTTP " + res.status + ")");
        return;
      }

      var issued = await res.json();
      var put = await fetch(issued.uploadUrl, {
        method: "PUT",
        headers: issued.uploadHeaders,
        body: html,
      });

      if (!put.ok) {
        showError(
          "アップロードに失敗しました (HTTP " + put.status + ")。" +
          "ファイル情報だけが登録されている場合があります。" +
          "数秒後に一覧を再読み込みしますので、不要なら一覧から削除してください。"
        );
        setTimeout(function () { location.reload(); }, ${ORPHAN_RELOAD_DELAY_MS});
        return;
      }

      // 失敗してもアップロード自体は成功しているので握り潰す
      // （「インデックスを作成」で後から拾える）。
      await fetch("/files/" + encodeURIComponent(issued.id) + "/index", {
        method: "POST",
      }).catch(function () {});

      location.reload();
    } catch (err) {
      showError(
        "アップロードに失敗しました: " + err.message +
        "。ストレージバケットの CORS 設定を確認してください。"
      );
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "アップロード";
    }
  });

  document.querySelectorAll("[data-delete-id]").forEach(function (button) {
    button.addEventListener("click", async function () {
      if (!confirm("このファイルを削除しますか？")) return;

      var row = button.closest("tr");
      var rowError = row.querySelector("[data-row-error]");
      rowError.textContent = "";
      button.disabled = true;

      try {
        var res = await fetch("/files/" + button.dataset.deleteId, { method: "DELETE" });
        if (!res.ok) {
          rowError.textContent = "削除に失敗しました (HTTP " + res.status + ")";
          button.disabled = false;
          return;
        }
        location.reload();
      } catch (err) {
        rowError.textContent = "削除に失敗しました: " + err.message;
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll("[data-copy-url]").forEach(function (button) {
    button.addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(button.dataset.copyUrl);
        var original = button.textContent;
        button.textContent = "コピーしました";
        setTimeout(function () { button.textContent = original; }, 1500);
      } catch (err) {
        /* クリップボードが使えない環境では何もしない */
      }
    });
  });
})();
`;

/**
 * ヘッダ設定画面のクライアントスクリプト。
 *
 * 送出される CSP はサーバが組み立てたものを表示するだけで、ここでは組み立てない。
 * 同じ組み立てを 2 か所に持つと、プレビューと実際の配信が食い違いうる。
 */
export const SETTINGS_SCRIPT = `
(function () {
  var form = document.getElementById("settings-form");
  var saveButton = document.getElementById("save-button");
  var resetButton = document.getElementById("reset-button");
  var errorBox = document.getElementById("form-error");

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function parseOrigins(value) {
    return value
      .split("\\n")
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return line.length > 0; });
  }

  function collect() {
    var settings = {};

    var tokens = [];
    form.querySelectorAll("[data-token]").forEach(function (box) {
      if (box.checked) tokens.push(box.dataset.token);
    });
    if (tokens.length > 0) settings.sandbox = tokens;

    var sources = {};
    form.querySelectorAll("[data-source]").forEach(function (area) {
      var origins = parseOrigins(area.value);
      if (origins.length > 0) sources[area.dataset.source] = origins;
    });
    if (Object.keys(sources).length > 0) settings.allowedSources = sources;

    form.querySelectorAll("[data-field]").forEach(function (select) {
      if (select.value) settings[select.dataset.field] = select.value;
    });

    return settings;
  }

  function confirmDangerous() {
    var checked = [];
    form.querySelectorAll('[data-token][data-risk="danger"]').forEach(function (box) {
      if (box.checked) checked.push(box.dataset.token + " … " + box.dataset.description);
    });
    if (checked.length === 0) return true;
    return confirm(
      "次の設定はこのコンテンツの隔離を弱めます。\\n\\n" +
      checked.join("\\n") +
      "\\n\\n保存しますか？"
    );
  }

  async function save(settings) {
    errorBox.hidden = true;
    saveButton.disabled = true;

    try {
      var res = await fetch(location.pathname.replace(/\\/edit$/, ""), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        var body = await res.json().catch(function () { return {}; });
        showError(body.error || "保存に失敗しました (HTTP " + res.status + ")");
        return;
      }
      location.reload();
    } catch (err) {
      showError("保存に失敗しました: " + err.message);
    } finally {
      saveButton.disabled = false;
    }
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!confirmDangerous()) return;
    save(collect());
  });

  resetButton.addEventListener("click", function () {
    if (!confirm("このコンテンツの設定を既定に戻しますか？")) return;
    save({});
  });
})();
`;
