/**
 * `/s/:id` のレスポンスヘッダを組み立てる。
 *
 * 既定は「実行には寛容、送信には厳格」。コンテンツごとの設定はこの既定を
 * **緩める方向にのみ**働き、床（sandbox の付与・Content-Type・
 * インライン実行の許可）は設定側から到達できない。
 *
 * 危険な値はバリデーションで弾くのではなく、そもそも設定の語彙に存在させない。
 * `allow-same-origin` は運用者が許可しない限り語彙に現れず、床のヘッダ名には
 * スロットが無い。
 */

/**
 * sandbox の既定トークン。
 *   allow-scripts   … グラフ描画など、レポート内の JS を動かすため
 *   allow-popups    … 出典リンクを別タブで開くレポートのため
 *   allow-downloads … CSV などのダウンロードリンクを提供するレポートのため
 *   allow-modals    … alert() / confirm() を呼ぶレポートのため
 */
export const DEFAULT_SANDBOX_TOKENS = [
  "allow-scripts",
  "allow-popups",
  "allow-downloads",
  "allow-modals",
] as const;

/**
 * コンテンツごとに指定できる sandbox トークンと、その危険度。
 *
 *   safe    … 表示の挙動を変えるだけで、外部への経路を増やさない
 *   caution … 閲覧者を外部へ連れて行ける／送信経路が増える
 *   danger  … 隔離そのものを弱める
 *
 * 危険度の対応表なので allow-same-origin も含む。実際に選べるかどうかは
 * availableSandboxTokens() が決める。
 */
export const SANDBOX_TOKEN_RISK = {
  "allow-scripts": "safe",
  "allow-popups": "caution",
  "allow-downloads": "caution",
  "allow-modals": "safe",
  "allow-pointer-lock": "safe",
  "allow-orientation-lock": "safe",
  "allow-presentation": "safe",
  "allow-top-navigation-by-user-activation": "caution",
  "allow-forms": "danger",
  "allow-popups-to-escape-sandbox": "danger",
  "allow-top-navigation": "danger",
  "allow-same-origin": "danger",
} as const satisfies Record<string, "safe" | "caution" | "danger">;

export type SandboxToken = keyof typeof SANDBOX_TOKEN_RISK;

/**
 * 運用者が環境変数で許可しない限り設定できないトークン。
 *
 * allow-same-origin を付けると配信中の HTML が管理画面と同一オリジンになり、
 * その中の JS が /files の列挙・/upload・DELETE /files/:id を
 * IP 許可リストの内側から実行できる。UI の警告で受け止められる範囲を
 * 超えるので、デプロイ時の明示的な許可を前提にする。
 */
const GATED_SANDBOX_TOKENS = ["allow-same-origin"] as const;

export function unsandboxedContentAllowed(): boolean {
  return process.env.ALLOW_UNSANDBOXED_CONTENT === "true";
}

/**
 * いま設定できるトークン。ゲートは書き込みと読み取りの両方でこれを使う。
 * 片側だけだと「許可中に保存 → 許可を外しても配信され続ける」形になる。
 */
export function availableSandboxTokens(): readonly SandboxToken[] {
  const base = (Object.keys(SANDBOX_TOKEN_RISK) as SandboxToken[]).filter(
    (token) => !(GATED_SANDBOX_TOKENS as readonly string[]).includes(token)
  );
  return unsandboxedContentAllowed() ? [...base, ...GATED_SANDBOX_TOKENS] : base;
}

/** 追加のオリジンを指定できるディレクティブ。 */
export const SOURCE_KEYS = ["script", "style", "img", "font", "connect"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];

export const CACHE_CONTROL_VALUES = ["no-store", "private", "public"] as const;
export const REFERRER_POLICY_VALUES = [
  "no-referrer",
  "same-origin",
  "strict-origin-when-cross-origin",
] as const;

export type ResponseHeaderSettings = {
  /** 差分ではなく最終形。空配列は受け付けない（parseSettings 参照）。 */
  sandbox?: SandboxToken[];
  /** 既定値に**追加する**オリジン。既定の 'unsafe-inline' / data: / blob: は打ち消せない。 */
  allowedSources?: Partial<Record<SourceKey, string[]>>;
  cacheControl?: (typeof CACHE_CONTROL_VALUES)[number];
  referrerPolicy?: (typeof REFERRER_POLICY_VALUES)[number];
};

/**
 * CSP に連結して安全な https オリジンかどうか。
 *
 * TypeScript の型は受信 JSON を検証しないため、値側の防御はここだけが担う。
 * `url.origin === input` の完全一致が本体で、これにより空白・セミコロン・パス・
 * クエリ・認証情報・大文字ホスト・末尾スラッシュがまとめて落ちる。
 * 通すのは正規形のオリジンだけなので、`https://a.com; script-src *` のような
 * ディレクティブ注入は成立しない。
 */
export function validateOrigin(input: string): boolean {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.origin === input;
}

type ParseResult =
  | { ok: true; data: ResponseHeaderSettings }
  | { ok: false; error: string };

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): { ok: true; value: T } | { ok: false; error: string } {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    return { ok: false, error: `${field} must be one of: ${allowed.join(", ")}` };
  }
  return { ok: true, value: value as T };
}

function parseSandbox(value: unknown): { ok: true; value: SandboxToken[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "sandbox must be an array" };

  // 空配列は「素の sandbox」= スクリプト全停止になり、UI で全チェックを外した
  // 状態と区別できないまま無言でコンテンツが壊れる。意図的に止めたい場合は
  // 別の入口を用意すべきなので、ここでは受け付けない。
  if (value.length === 0) return { ok: false, error: "sandbox must not be empty" };

  const available = availableSandboxTokens() as readonly string[];
  const unknown = value.filter(
    (token) => typeof token !== "string" || !available.includes(token)
  );
  if (unknown.length > 0) {
    return { ok: false, error: `sandbox contains unsupported tokens: ${unknown.join(", ")}` };
  }
  return { ok: true, value: [...new Set(value as SandboxToken[])] };
}

function parseAllowedSources(
  value: unknown
): { ok: true; value: Partial<Record<SourceKey, string[]>> } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "allowedSources must be an object" };
  }

  const result: Partial<Record<SourceKey, string[]>> = {};
  for (const [key, origins] of Object.entries(value)) {
    if (!(SOURCE_KEYS as readonly string[]).includes(key)) {
      return { ok: false, error: `allowedSources.${key} is not a supported directive` };
    }
    if (!Array.isArray(origins)) {
      return { ok: false, error: `allowedSources.${key} must be an array` };
    }
    const invalid = origins.filter((origin) => typeof origin !== "string" || !validateOrigin(origin));
    if (invalid.length > 0) {
      return {
        ok: false,
        error: `allowedSources.${key} must contain https origins only (e.g. https://cdn.example.com)`,
      };
    }
    if (origins.length > 0) result[key as SourceKey] = [...new Set(origins as string[])];
  }
  return { ok: true, value: result };
}

/**
 * 受信 JSON を設定へ変換する。未知のキーは黙って捨てずに拒否する
 * （設定できたつもりで反映されていない、という無言の事故を避けるため）。
 */
export function parseSettings(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Body must be an object" };
  }

  const known = ["sandbox", "allowedSources", "cacheControl", "referrerPolicy"];
  const unknownKeys = Object.keys(body).filter((key) => !known.includes(key));
  if (unknownKeys.length > 0) {
    return { ok: false, error: `Unsupported fields: ${unknownKeys.join(", ")}` };
  }

  const input = body as Record<string, unknown>;
  const data: ResponseHeaderSettings = {};

  if (input.sandbox !== undefined) {
    const parsed = parseSandbox(input.sandbox);
    if (!parsed.ok) return parsed;
    data.sandbox = parsed.value;
  }
  if (input.allowedSources !== undefined) {
    const parsed = parseAllowedSources(input.allowedSources);
    if (!parsed.ok) return parsed;
    if (Object.keys(parsed.value).length > 0) data.allowedSources = parsed.value;
  }
  if (input.cacheControl !== undefined) {
    const parsed = parseEnum(input.cacheControl, CACHE_CONTROL_VALUES, "cacheControl");
    if (!parsed.ok) return parsed;
    data.cacheControl = parsed.value;
  }
  if (input.referrerPolicy !== undefined) {
    const parsed = parseEnum(input.referrerPolicy, REFERRER_POLICY_VALUES, "referrerPolicy");
    if (!parsed.ok) return parsed;
    data.referrerPolicy = parsed.value;
  }

  return { ok: true, data };
}

/**
 * ディレクティブ名と、設定が無いときの値。
 *
 * sandbox が止めるのは管理 API へのアクセスだけで、外向きの通信は素通しになる。
 * ここは送信を塞ぐためのもので、レスポンスを読めなくても送信自体は成立するため
 * connect-src が最も効く。
 * 'unsafe-inline' は妥協ではなく必須 — LLM 生成 HTML は <script> / <style> の
 * 直書きが前提で、絞るとレポートが軒並み壊れる。
 * img の blob: は canvas.toBlob() が返す画像用。生成元のドキュメント内で
 * 完結するため送信経路にはならない。
 * 'self' は使わない — 不透明オリジンでは何にもマッチしない。
 */
const SOURCE_DEFAULTS: Record<SourceKey, { directive: string; base: string[] }> = {
  script: { directive: "script-src", base: ["'unsafe-inline'"] },
  style: { directive: "style-src", base: ["'unsafe-inline'"] },
  img: { directive: "img-src", base: ["data:", "blob:"] },
  font: { directive: "font-src", base: ["data:"] },
  connect: { directive: "connect-src", base: ["'none'"] },
};

function sourceDirective(key: SourceKey, added: string[] | undefined): string {
  const { directive, base } = SOURCE_DEFAULTS[key];
  if (!added || added.length === 0) return `${directive} ${base.join(" ")}`;

  // 'none' は単独でしか使えないため、追加があるときは列挙で置き換える。
  // 他のディレクティブは既定値を残したまま末尾に足す。
  const sources = base.includes("'none'") ? added : [...base, ...added];
  return `${directive} ${sources.join(" ")}`;
}

/**
 * frame-src / media-src / object-src は明示せず default-src 'none' に落としている。
 * window.open() は CSP では塞げない（navigate-to は仕様から削除済み）ため、
 * allow-popups がある限り送信経路として残る。
 */
export function buildCsp(settings?: ResponseHeaderSettings): string {
  // 保存済みの値も語彙で濾す。parseSettings は書き込み時にしか働かないので、
  // 読み取り側でも通さないと「一度保存された危険な設定が配信され続ける」形になる。
  const stored = settings?.sandbox?.filter((token) =>
    (availableSandboxTokens() as readonly string[]).includes(token)
  );
  const tokens = stored?.length ? stored : DEFAULT_SANDBOX_TOKENS;
  return [
    `sandbox ${tokens.join(" ")}`,
    "default-src 'none'",
    sourceDirective("script", settings?.allowedSources?.script),
    sourceDirective("style", settings?.allowedSources?.style),
    sourceDirective("img", settings?.allowedSources?.img),
    sourceDirective("font", settings?.allowedSources?.font),
    sourceDirective("connect", settings?.allowedSources?.connect),
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

export type BuiltHeaders = {
  csp: string;
  cacheControl?: string;
  xFrameOptions: string;
  referrerPolicy?: string;
};

/**
 * `public` は共有キャッシュに残るため、有効期限までの残り秒数を max-age に入れる。
 * これが無いとブラウザや中間キャッシュがヒューリスティックに期間を決め、
 * TTL 経過後もキャッシュから配信され続けうる。
 */
function cacheControlValue(
  value: ResponseHeaderSettings["cacheControl"],
  expiresAt: Date,
  nowMs: number
): string | undefined {
  if (!value) return undefined;
  if (value === "no-store") return "no-store";

  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - nowMs) / 1000));
  return `${value}, max-age=${maxAge}`;
}

export function buildHeaders(
  settings: ResponseHeaderSettings | undefined,
  expiresAt: Date,
  nowMs: number = Date.now()
): BuiltHeaders {
  return {
    csp: buildCsp(settings),
    cacheControl: cacheControlValue(settings?.cacheControl, expiresAt, nowMs),
    // 埋め込み拒否はこのヘッダだけで行う。CSP の frame-ancestors は
    // default-src にフォールバックしない数少ないディレクティブなので、
    // default-src 'none' があっても他サイトからの iframe は防げない。
    // frame-ancestors を併記すると CSP3 §6.4.2.2 によりこちらが無視されるため、
    // 送るのは片方だけにする。設定項目にはしない（全拒否以外の要求が無い）。
    xFrameOptions: "DENY",
    referrerPolicy: settings?.referrerPolicy,
  };
}

export type RiskLevel = "safe" | "caution" | "danger";

/**
 * 設定から導出する。保存はしない（設定が変われば必ず追従させるため）。
 *
 * 既定のトークンは、既に既定で付いている以上ここでは数えない。
 * 数えると未設定 (safe) と「既定と同じ内容を明示保存した状態」で
 * 判定が食い違ってしまう。
 */
export function riskLevel(settings?: ResponseHeaderSettings): RiskLevel {
  if (!settings) return "safe";

  const added = (settings.sandbox ?? []).filter(
    (token) => !(DEFAULT_SANDBOX_TOKENS as readonly string[]).includes(token)
  );
  if (added.some((token) => SANDBOX_TOKEN_RISK[token] === "danger")) return "danger";

  const opened = Object.values(settings.allowedSources ?? {}).some((origins) => origins.length > 0);
  const widened = added.some((token) => SANDBOX_TOKEN_RISK[token] === "caution");
  return opened || widened ? "caution" : "safe";
}
