import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AuthConfig } from "./authConfig.js";
import {
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCode,
  type IdClaims,
  isAllowedAccount,
  parseIdTokenClaims,
} from "./google.js";

const base = {
  iss: "https://accounts.google.com",
  aud: "cid",
  exp: 2_000_000_000,
  email: "a@example.com",
  email_verified: true,
  hd: "example.com",
};
const token = (c: object) => `h.${Buffer.from(JSON.stringify(c)).toString("base64url")}.s`;
const config: AuthConfig = {
  clientId: "cid",
  clientSecret: "secret",
  sessionSecret: "s",
  allowedDomains: ["example.com"],
  publicBaseUrl: null,
};

describe("isAllowedAccount", () => {
  it("accepts a verified account in an allowed domain", () => {
    expect(isAllowedAccount(parseIdTokenClaims(token(base), "cid", 0), ["example.com"])).toBe(true);
  });
  it("accepts an upper-case hd", () => {
    expect(isAllowedAccount({ ...base, hd: "Example.COM" }, ["example.com"])).toBe(true);
  });
  it("rejects a personal Gmail account (no hd)", () => {
    const { hd: _hd, ...gmail } = { ...base, email: "a@gmail.com" };
    expect(isAllowedAccount(gmail as IdClaims, ["gmail.com"])).toBe(false);
  });
  it("rejects an unverified email", () => {
    expect(isAllowedAccount({ ...base, email_verified: false }, ["example.com"])).toBe(false);
  });
  it("rejects another domain", () => {
    expect(
      isAllowedAccount({ ...base, hd: "other.com", email: "a@other.com" }, ["example.com"]),
    ).toBe(false);
  });
  it("rejects when email domain differs from hd", () => {
    expect(isAllowedAccount({ ...base, email: "a@other.com" }, ["example.com"])).toBe(false);
  });
  it("rejects a lookalike email domain suffix", () => {
    expect(isAllowedAccount({ ...base, email: "a@evil.example.com" }, ["example.com"])).toBe(false);
  });
});

describe("parseIdTokenClaims", () => {
  it("accepts the bare accounts.google.com issuer", () => {
    expect(parseIdTokenClaims(token({ ...base, iss: "accounts.google.com" }), "cid", 0).email).toBe(
      "a@example.com",
    );
  });
  it("rejects a wrong audience", () => {
    expect(() => parseIdTokenClaims(token({ ...base, aud: "x" }), "cid", 0)).toThrow();
  });
  it("rejects an expired token", () => {
    expect(() => parseIdTokenClaims(token(base), "cid", 2_000_000_001_000)).toThrow();
  });
  it("rejects a foreign issuer", () => {
    expect(() => parseIdTokenClaims(token({ ...base, iss: "https://evil" }), "cid", 0)).toThrow();
  });
  it("rejects a token with missing segments", () => {
    expect(() => parseIdTokenClaims("onlyone", "cid", 0)).toThrow();
  });
  it("rejects a non-JSON payload", () => {
    expect(() =>
      parseIdTokenClaims(`h.${Buffer.from("not json").toString("base64url")}.s`, "cid", 0),
    ).toThrow();
  });
  it("rejects a non-object payload", () => {
    expect(() => parseIdTokenClaims(token([1, 2]), "cid", 0)).toThrow();
    expect(() => parseIdTokenClaims(token(null), "cid", 0)).toThrow();
  });
  it.each([
    ["email", 1],
    ["email", undefined],
    ["email_verified", "true"],
    ["email_verified", undefined],
    ["exp", "2000000000"],
    ["exp", undefined],
    ["aud", ["cid"]],
    ["iss", undefined],
    ["hd", 5],
    ["name", 5],
    ["picture", {}],
  ])("rejects malformed %s (%j)", (key, value) => {
    expect(() => parseIdTokenClaims(token({ ...base, [key]: value }), "cid", 0)).toThrow();
  });
});

describe("buildAuthorizeUrl", () => {
  const p = {
    clientId: "cid",
    redirectUri: "https://app/cb",
    state: "st",
    codeChallenge: "ch",
    hostedDomain: null,
  };
  it("builds the Google authorize URL with PKCE", () => {
    const u = new URL(buildAuthorizeUrl(p));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid email profile");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app/cb");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("code_challenge")).toBe("ch");
    // 許可外のアカウントで弾かれた後に別アカウントを選べるよう、毎回アカウント選択を出す
    expect(u.searchParams.get("prompt")).toBe("select_account");
    expect(u.searchParams.has("hd")).toBe(false);
  });
  it("adds hd only when a hosted domain is given", () => {
    expect(new URL(buildAuthorizeUrl({ ...p, hostedDomain: "example.com" })).searchParams.get("hd")).toBe(
      "example.com",
    );
  });
});

describe("createPkcePair", () => {
  it("returns a verifier and its S256 challenge", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(createPkcePair().verifier).not.toBe(verifier);
  });
});

describe("exchangeCode", () => {
  const args = { code: "c", codeVerifier: "v", redirectUri: "r", config };
  it("returns id_token from the token endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id_token: "abc" })));
    expect(await exchangeCode({ ...args, fetchFn })).toBe("abc");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(body)).toEqual({
      code: "c",
      client_id: "cid",
      client_secret: "secret",
      redirect_uri: "r",
      grant_type: "authorization_code",
      code_verifier: "v",
    });
  });
  it("throws when the token endpoint fails", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 400 }));
    await expect(exchangeCode({ ...args, fetchFn })).rejects.toThrow();
  });
  it("throws when id_token is missing", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({})));
    await expect(exchangeCode({ ...args, fetchFn })).rejects.toThrow();
  });
});
