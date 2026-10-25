import { describe, expect, it } from "vitest";
import { assertAuthConfig, loadAuthConfig } from "./authConfig.js";

const full = {
  GOOGLE_OAUTH_CLIENT_ID: "id",
  GOOGLE_OAUTH_CLIENT_SECRET: "secret",
  SESSION_SECRET: "sess",
  ALLOWED_EMAIL_DOMAINS: "example.com",
};

describe("loadAuthConfig", () => {
  it("lists every missing variable", () => {
    expect(() => loadAuthConfig({})).toThrow(
      /ALLOWED_EMAIL_DOMAINS.*GOOGLE_OAUTH_CLIENT_ID.*GOOGLE_OAUTH_CLIENT_SECRET.*SESSION_SECRET/s,
    );
  });

  it("treats a blank domain list as missing", () => {
    expect(() => loadAuthConfig({ ...full, ALLOWED_EMAIL_DOMAINS: " , " })).toThrow(
      /ALLOWED_EMAIL_DOMAINS/,
    );
  });

  it("normalizes domains", () => {
    expect(
      loadAuthConfig({ ...full, ALLOWED_EMAIL_DOMAINS: " Example.com ,b.org" }).allowedDomains,
    ).toEqual(["example.com", "b.org"]);
  });

  it("treats PUBLIC_BASE_URL as optional and strips trailing slashes", () => {
    expect(loadAuthConfig(full).publicBaseUrl).toBeNull();
    expect(loadAuthConfig({ ...full, PUBLIC_BASE_URL: "https://t.example.com/" }).publicBaseUrl).toBe(
      "https://t.example.com",
    );
  });

  it("does not cache between calls", () => {
    expect(loadAuthConfig(full).clientId).toBe("id");
    expect(loadAuthConfig({ ...full, GOOGLE_OAUTH_CLIENT_ID: "other" }).clientId).toBe("other");
  });

  it("assertAuthConfig reads process.env", () => {
    expect(() => assertAuthConfig()).not.toThrow();
  });
});
