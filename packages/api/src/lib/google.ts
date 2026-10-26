import { createHash, randomBytes } from "node:crypto";
import type { AuthConfig } from "./authConfig.js";

export type IdClaims = {
  iss: string;
  aud: string;
  exp: number;
  email: string;
  email_verified: boolean;
  hd?: string;
  name?: string;
  picture?: string;
};

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

// hostedDomain はログイン画面のアカウント候補を絞るためだけに使う。
// ブラウザ側で書き換えられるため、許可判定には使わず isAllowedAccount で検証する。
export function buildAuthorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  hostedDomain: string | null;
}): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    // profile は要求しない。Google はコールバックの URL に scope を付けて返す。そこに入る
    // userinfo.profile の「.profile」を、WAF の LFI ルール（OWASP CRS 930120 など）が攻撃と誤検知するため。
    // 名前は ID トークンに入らなくなり、表示はメールアドレスになる。
    scope: "openid email",
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    // 許可外のアカウントで弾かれた後、同じアカウントで自動的に再ログインされて
    // 抜け出せなくなるのを防ぐため、毎回アカウント選択画面を出す
    prompt: "select_account",
  });
  if (p.hostedDomain) q.set("hd", p.hostedDomain);
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function exchangeCode(p: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  config: AuthConfig;
  fetchFn?: typeof fetch;
}): Promise<string> {
  const fetchFn = p.fetchFn ?? fetch;
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: p.code,
      client_id: p.config.clientId,
      client_secret: p.config.clientSecret,
      redirect_uri: p.redirectUri,
      grant_type: "authorization_code",
      code_verifier: p.codeVerifier,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Token endpoint returned ${res.status}`);
  }
  const json: unknown = await res.json().catch(() => null);
  const idToken = (json as { id_token?: unknown } | null)?.id_token;
  if (typeof idToken !== "string" || idToken === "") {
    throw new Error("Token response is missing id_token");
  }
  return idToken;
}

function optionalString(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new Error(`Invalid ID token claim: ${key}`);
  return v;
}

// 設計上の判断: ID トークンの署名は検証しない。
// トークンは Google のトークンエンドポイントから TLS 経由で直接受け取っており、
// 第三者がペイロードを差し込める経路がない（OIDC Core §3.1.3.7 は、この場合
// 署名検証を省略してよいとしている）。そのため iss / aud / exp のクレーム検証だけを行う。
// 外部から受け取った ID トークンをこの関数に渡してはならない。
export function parseIdTokenClaims(idToken: string, clientId: string, nowMs = Date.now()): IdClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1]) throw new Error("Malformed ID token");

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Malformed ID token payload");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Malformed ID token payload");
  }
  // 形を信用しない: 必須項目は実行時に型を確かめる
  const o = raw as Record<string, unknown>;
  const { iss, aud, exp, email, email_verified } = o;
  if (typeof iss !== "string") throw new Error("Invalid ID token claim: iss");
  if (typeof aud !== "string") throw new Error("Invalid ID token claim: aud");
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    throw new Error("Invalid ID token claim: exp");
  }
  if (typeof email !== "string") throw new Error("Invalid ID token claim: email");
  if (typeof email_verified !== "boolean") {
    throw new Error("Invalid ID token claim: email_verified");
  }
  const hd = optionalString(o, "hd");
  const name = optionalString(o, "name");
  const picture = optionalString(o, "picture");

  if (!ISSUERS.includes(iss)) throw new Error("Unexpected ID token issuer");
  if (aud !== clientId) throw new Error("ID token audience mismatch");
  if (exp * 1000 <= nowMs) throw new Error("ID token expired");

  const claims: IdClaims = { iss, aud, exp, email, email_verified };
  if (hd !== undefined) claims.hd = hd;
  if (name !== undefined) claims.name = name;
  if (picture !== undefined) claims.picture = picture;
  return claims;
}

// hd だけでは足りない（email の実ドメインとのずれを防ぐため両方確認する）。
// hd が無い個人 Gmail は、gmail.com を許可に入れても通さない。
export function isAllowedAccount(claims: IdClaims, allowedDomains: string[]): boolean {
  if (claims.email_verified !== true) return false;
  if (!claims.hd) return false;
  const hd = claims.hd.toLowerCase();
  if (!allowedDomains.includes(hd)) return false;
  const at = claims.email.lastIndexOf("@");
  if (at < 0) return false;
  return claims.email.slice(at + 1).toLowerCase() === hd;
}
