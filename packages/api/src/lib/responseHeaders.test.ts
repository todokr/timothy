import { describe, it, expect, afterEach } from "vitest";
import {
  availableSandboxTokens,
  buildCsp,
  buildHeaders,
  parseSettings,
  riskLevel,
  unsandboxedContentAllowed,
  validateOrigin,
} from "./responseHeaders.js";

/** PR で確定した既定ポリシー。設定なしのドキュメントは常にこれと一致する。 */
const BASELINE =
  "sandbox allow-scripts allow-popups allow-downloads allow-modals; " +
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; connect-src 'none'; " +
  "form-action 'none'; base-uri 'none'";

describe("validateOrigin", () => {
  it("正規形の https オリジンを通す", () => {
    expect(validateOrigin("https://cdn.example.com")).toBe(true);
    expect(validateOrigin("https://cdn.example.com:8443")).toBe(true);
  });

  // 型は受信 JSON を検証しないため、CSP へのディレクティブ注入を止めるのは
  // ここだけ。セミコロンや空白が通ると床ごと書き換えられる。
  it("CSP に別のディレクティブを注ぎ込む値を弾く", () => {
    expect(validateOrigin("https://a.example.com; script-src *")).toBe(false);
    expect(validateOrigin("https://a.example.com 'unsafe-eval'")).toBe(false);
    expect(validateOrigin("'unsafe-eval'")).toBe(false);
    expect(validateOrigin("*")).toBe(false);
  });

  it("オリジン以外の情報を含む URL を弾く", () => {
    expect(validateOrigin("https://a.example.com/path")).toBe(false);
    expect(validateOrigin("https://a.example.com/")).toBe(false);
    expect(validateOrigin("https://a.example.com?q=1")).toBe(false);
    expect(validateOrigin("https://user:pass@a.example.com")).toBe(false);
  });

  it("https 以外のスキームを弾く", () => {
    expect(validateOrigin("http://a.example.com")).toBe(false);
    expect(validateOrigin("data:")).toBe(false);
    expect(validateOrigin("https:")).toBe(false);
  });

  // URL 正規化で大文字ホストは小文字になるため origin と一致しない。
  // 同じホストが複数の表記で保存されるのを防げる。
  it("正規形でない表記を弾く", () => {
    expect(validateOrigin("https://CDN.example.com")).toBe(false);
    expect(validateOrigin(" https://a.example.com ")).toBe(false);
    expect(validateOrigin("")).toBe(false);
  });
});

describe("parseSettings", () => {
  it("設定なし（空オブジェクト）を受け付ける", () => {
    const result = parseSettings({});
    expect(result).toEqual({ ok: true, data: {} });
  });

  // 運用者が許可していない状態では語彙に現れない。
  it("既定では allow-same-origin を弾く", () => {
    const result = parseSettings({ sandbox: ["allow-scripts", "allow-same-origin"] });
    expect(result.ok).toBe(false);
  });

  // 隔離を弱めるが、影響はそのコンテンツの外部送信に閉じる。UI が警告する。
  it("危険トークンは受け付ける（警告は UI の担当）", () => {
    for (const token of ["allow-forms", "allow-top-navigation", "allow-popups-to-escape-sandbox"]) {
      expect(parseSettings({ sandbox: [token] }).ok).toBe(true);
    }
  });

  // 空配列は素の sandbox（スクリプト全停止）になり、UI で全チェックを外した
  // 状態と区別できないままコンテンツが無言で壊れる。
  it("空の sandbox を弾く", () => {
    expect(parseSettings({ sandbox: [] }).ok).toBe(false);
  });

  it("sandbox の重複を除く", () => {
    const result = parseSettings({ sandbox: ["allow-scripts", "allow-scripts"] });
    expect(result).toEqual({ ok: true, data: { sandbox: ["allow-scripts"] } });
  });

  // 黙って捨てると「設定できたつもりで反映されていない」事故になる。
  it("未知のフィールドを弾く", () => {
    expect(parseSettings({ contentType: "text/plain" }).ok).toBe(false);
    expect(parseSettings({ allowedSources: { frame: ["https://a.example.com"] } }).ok).toBe(false);
  });

  it("不正なオリジンを含む allowedSources を弾く", () => {
    expect(parseSettings({ allowedSources: { script: ["http://a.example.com"] } }).ok).toBe(false);
    expect(parseSettings({ allowedSources: { script: "https://a.example.com" } }).ok).toBe(false);
  });

  it("列挙値以外を弾く", () => {
    expect(parseSettings({ cacheControl: "immutable" }).ok).toBe(false);
    expect(parseSettings({ referrerPolicy: "unsafe-url" }).ok).toBe(false);
  });

  it("オブジェクト以外の本文を弾く", () => {
    expect(parseSettings([]).ok).toBe(false);
    expect(parseSettings(null).ok).toBe(false);
    expect(parseSettings("{}").ok).toBe(false);
  });
});

describe("buildCsp", () => {
  // 後方互換の要。設定を持たない既存ドキュメントの配信内容が変わってはいけない。
  it("設定なしのとき既定のポリシーと完全に一致する", () => {
    expect(buildCsp(undefined)).toBe(BASELINE);
    expect(buildCsp({})).toBe(BASELINE);
  });

  // 既定値を残したまま末尾に足すので、設定でインライン実行を壊せない。
  it("allowedSources を既定値に追加する", () => {
    const csp = buildCsp({ allowedSources: { script: ["https://cdn.example.com"] } });
    expect(csp).toContain("script-src 'unsafe-inline' https://cdn.example.com");
  });

  // 'none' は単独でしか使えないため、追加があるときは列挙で置き換える。
  it("connect-src に追加があるとき 'none' を落とす", () => {
    const csp = buildCsp({ allowedSources: { connect: ["https://api.example.com"] } });
    expect(csp).toContain("connect-src https://api.example.com");
    expect(csp).not.toContain("connect-src 'none'");
  });

  it("sandbox トークンを差し替える", () => {
    const csp = buildCsp({ sandbox: ["allow-scripts"] });
    expect(csp.startsWith("sandbox allow-scripts;")).toBe(true);
  });

  // parseSettings は書き込み時にしか働かない。語彙に無いトークンが何らかの経路で
  // 保存されても配信されないことを、読み取り側で保証する。
  it("保存済みの値でも語彙に無いトークンを出さない", () => {
    const rogue = { sandbox: ["allow-scripts", "allow-same-origin"] } as never;
    expect(buildCsp(rogue)).not.toContain("allow-same-origin");
    expect(buildCsp(rogue)).toContain("sandbox allow-scripts;");
  });

  it("語彙に無いトークンだけが保存されていたら既定に戻す", () => {
    const rogue = { sandbox: ["allow-same-origin"] } as never;
    expect(buildCsp(rogue)).toBe(BASELINE);
  });

  it("設定をどう組んでも 'self' を含まない", () => {
    const csp = buildCsp({
      sandbox: ["allow-scripts", "allow-presentation"],
      allowedSources: { script: ["https://cdn.example.com"], connect: ["https://api.example.com"] },
    });
    expect(csp).not.toContain("'self'");
  });
});

describe("buildHeaders", () => {
  const expiresAt = new Date("2026-01-08T00:00:00Z");
  const nowMs = new Date("2026-01-01T00:00:00Z").getTime();

  it("設定なしでも X-Frame-Options は常に付く", () => {
    const headers = buildHeaders(undefined, expiresAt, nowMs);
    expect(headers).toEqual({
      csp: BASELINE,
      cacheControl: undefined,
      xFrameOptions: "DENY",
      referrerPolicy: undefined,
    });
  });

  // max-age が無いとブラウザや中間キャッシュがヒューリスティックに期間を決め、
  // TTL 経過後もキャッシュから配信されうる。
  it("public / private に有効期限までの max-age を付ける", () => {
    expect(buildHeaders({ cacheControl: "public" }, expiresAt, nowMs).cacheControl).toBe(
      "public, max-age=604800"
    );
    expect(buildHeaders({ cacheControl: "private" }, expiresAt, nowMs).cacheControl).toBe(
      "private, max-age=604800"
    );
  });

  it("no-store には max-age を付けない", () => {
    expect(buildHeaders({ cacheControl: "no-store" }, expiresAt, nowMs).cacheControl).toBe(
      "no-store"
    );
  });

  it("期限切れでも max-age が負にならない", () => {
    const past = new Date("2025-01-01T00:00:00Z");
    expect(buildHeaders({ cacheControl: "public" }, past, nowMs).cacheControl).toBe(
      "public, max-age=0"
    );
  });
});

describe("ALLOW_UNSANDBOXED_CONTENT ゲート", () => {
  afterEach(() => {
    delete process.env.ALLOW_UNSANDBOXED_CONTENT;
  });

  it("許可されていれば allow-same-origin を保存できる", () => {
    process.env.ALLOW_UNSANDBOXED_CONTENT = "true";
    expect(parseSettings({ sandbox: ["allow-scripts", "allow-same-origin"] }).ok).toBe(true);
  });

  it("true 以外の値では許可しない", () => {
    process.env.ALLOW_UNSANDBOXED_CONTENT = "1";
    expect(unsandboxedContentAllowed()).toBe(false);
    expect(availableSandboxTokens()).not.toContain("allow-same-origin");
  });

  // ゲートが書き込み時だけだと、許可を外しても保存済みの設定が配信され続ける。
  // 「運用者が許可しない限りこの穴は存在しない」を成立させるには読み取り側も要る。
  it("許可を外すと保存済みの allow-same-origin も配信されなくなる", () => {
    process.env.ALLOW_UNSANDBOXED_CONTENT = "true";
    const stored = parseSettings({ sandbox: ["allow-scripts", "allow-same-origin"] });
    expect(stored.ok && buildCsp(stored.data)).toContain("allow-same-origin");

    delete process.env.ALLOW_UNSANDBOXED_CONTENT;
    expect(stored.ok && buildCsp(stored.data)).not.toContain("allow-same-origin");
  });
});

describe("riskLevel", () => {
  it("設定なし・既定の範囲では safe", () => {
    expect(riskLevel(undefined)).toBe("safe");
    expect(riskLevel({ sandbox: ["allow-scripts"] })).toBe("safe");
    expect(riskLevel({ referrerPolicy: "no-referrer" })).toBe("safe");
  });

  // 特定ホストに開けた時点で、そのホストが外部送信の受け皿になる
  // （パスやクエリにデータを載せられる）ため safe ではない。
  it("送信先を開けたら caution", () => {
    expect(riskLevel({ allowedSources: { img: ["https://cdn.example.com"] } })).toBe("caution");
  });

  it("隔離を弱めるトークンを足したら danger", () => {
    expect(riskLevel({ sandbox: ["allow-scripts", "allow-forms"] })).toBe("danger");
  });

  it("遷移を許すトークンを足したら caution", () => {
    expect(riskLevel({ sandbox: ["allow-scripts", "allow-top-navigation-by-user-activation"] })).toBe(
      "caution"
    );
  });

  // 既定に無いという理由だけで警告すると、送信経路を増やさない変更にも
  // 警告が出て、本当に危険な設定との区別が付かなくなる。
  it("送信経路を増やさないトークンは safe のまま", () => {
    expect(
      riskLevel({ sandbox: ["allow-scripts", "allow-pointer-lock", "allow-presentation"] })
    ).toBe("safe");
  });
});
