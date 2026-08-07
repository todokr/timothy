import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import type { Context } from "hono";
import { getClientIp, ipAllowlistMiddleware } from "./ipAllowlist.js";

function contextWith(forwarded?: string): Context {
  return {
    req: {
      header: (name: string) => (name === "x-forwarded-for" ? forwarded : undefined),
    },
  } as unknown as Context;
}

const app = new Hono();
app.use("*", ipAllowlistMiddleware);
app.get("/guarded", (c) => c.text("ok"));

function get(forwarded?: string) {
  return app.request("/guarded", {
    headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded },
  });
}

afterEach(() => {
  delete process.env.ALLOWED_IPS;
  delete process.env.XFF_TRUSTED_HOPS;
});

describe("getClientIp", () => {
  it("returns null when the header is absent", () => {
    expect(getClientIp(contextWith(undefined))).toBeNull();
  });

  it("uses the only entry when the header has a single value", () => {
    expect(getClientIp(contextWith("198.51.100.7"))).toBe("198.51.100.7");
  });

  it("defaults to one trusted hop: uses the last entry when the header has two values", () => {
    expect(getClientIp(contextWith("203.0.113.9, 198.51.100.7"))).toBe("198.51.100.7");
  });

  it("defaults to one trusted hop: uses the last entry when the header has three values", () => {
    expect(getClientIp(contextWith("1.2.3.4, 203.0.113.9, 198.51.100.7"))).toBe("198.51.100.7");
  });

  it("uses the second-to-last entry only when XFF_TRUSTED_HOPS is 2", () => {
    const header = "1.2.3.4, 203.0.113.9, 198.51.100.7";
    expect(getClientIp(contextWith(header))).toBe("198.51.100.7");

    process.env.XFF_TRUSTED_HOPS = "2";
    expect(getClientIp(contextWith(header))).toBe("203.0.113.9");
  });

  it("uses the third-to-last entry when XFF_TRUSTED_HOPS is 3", () => {
    process.env.XFF_TRUSTED_HOPS = "3";
    expect(getClientIp(contextWith("1.2.3.4, 203.0.113.9, 198.51.100.7"))).toBe("1.2.3.4");
  });

  it("returns null when the header has fewer entries than XFF_TRUSTED_HOPS", () => {
    process.env.XFF_TRUSTED_HOPS = "2";
    expect(getClientIp(contextWith("198.51.100.7"))).toBeNull();

    process.env.XFF_TRUSTED_HOPS = "3";
    expect(getClientIp(contextWith("203.0.113.9, 198.51.100.7"))).toBeNull();
  });

  it("falls back to one hop when XFF_TRUSTED_HOPS is non-numeric, zero or negative", () => {
    for (const value of ["", "abc", "0", "-2", "  "]) {
      process.env.XFF_TRUSTED_HOPS = value;
      expect(getClientIp(contextWith("203.0.113.9, 198.51.100.7"))).toBe("198.51.100.7");
    }
  });

  it("trims surrounding whitespace on the selected entry", () => {
    expect(getClientIp(contextWith("  1.2.3.4  ,\t203.0.113.9\t,  198.51.100.7  "))).toBe(
      "198.51.100.7"
    );
    expect(getClientIp(contextWith("   198.51.100.7   "))).toBe("198.51.100.7");

    process.env.XFF_TRUSTED_HOPS = "2";
    expect(getClientIp(contextWith("  1.2.3.4  ,\t203.0.113.9\t,  198.51.100.7  "))).toBe(
      "203.0.113.9"
    );
  });
});

describe("ipAllowlistMiddleware", () => {
  it("allows everything when ALLOWED_IPS is unset", async () => {
    expect((await get("203.0.113.9")).status).toBe(200);
    expect((await get(undefined)).status).toBe(200);
  });

  it("allows everything when ALLOWED_IPS is blank", async () => {
    process.env.ALLOWED_IPS = "   ";
    expect((await get("203.0.113.9")).status).toBe(200);
  });

  it("denies a request with no X-Forwarded-For header", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
    expect((await get(undefined)).status).toBe(403);
  });

  it("allows a single-entry header whose IP is on the allowlist", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
    expect((await get("198.51.100.7")).status).toBe(200);
  });

  it("denies a single-entry header whose IP is not on the allowlist", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
    expect((await get("203.0.113.9")).status).toBe(403);
  });

  // Central regression test. On a bare Cloud Run service (`*.run.app`) or a
  // Lambda Function URL exactly ONE entry is appended, so an attacker sending
  // `X-Forwarded-For: <allowed-ip>` produces `<spoofed>, <real-client-ip>`.
  // Trusting anything other than the last entry at the default hop count let
  // anyone bypass the allowlist.
  it("denies the bare-Cloud-Run spoof: a forged allowed IP ahead of the real client IP", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
    expect((await get("198.51.100.7, 10.0.0.1")).status).toBe(403);
  });

  it("denies a spoofed allowed IP in a longer chain at the default hop count", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
    expect((await get("198.51.100.7, 203.0.113.9, 10.0.0.1")).status).toBe(403);
    expect((await get("203.0.113.9, 198.51.100.7, 10.0.0.1")).status).toBe(403);
  });

  it("allows two entries where the LAST entry is on the allowlist", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
    expect((await get("203.0.113.9, 198.51.100.7")).status).toBe(200);
  });

  it("uses the second-to-last entry only when XFF_TRUSTED_HOPS is 2", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
    // Default (1 hop): the second-to-last entry is untrusted, so this is denied.
    expect((await get("203.0.113.9, 198.51.100.7, 10.0.0.1")).status).toBe(403);

    // GCLB / Cloud Armor in front of Cloud Run appends two entries.
    process.env.XFF_TRUSTED_HOPS = "2";
    expect((await get("203.0.113.9, 198.51.100.7, 10.0.0.1")).status).toBe(200);
    expect((await get("198.51.100.7, 203.0.113.9, 10.0.0.1")).status).toBe(403);
  });

  it("denies a header with fewer entries than XFF_TRUSTED_HOPS", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
    process.env.XFF_TRUSTED_HOPS = "2";
    expect((await get("198.51.100.7")).status).toBe(403);
    expect((await get("198.51.100.7, 198.51.100.8")).status).toBe(200);
  });

  it("falls back to one hop for a non-numeric or zero XFF_TRUSTED_HOPS", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";

    process.env.XFF_TRUSTED_HOPS = "abc";
    expect((await get("198.51.100.7, 10.0.0.1")).status).toBe(403);
    expect((await get("10.0.0.1, 198.51.100.7")).status).toBe(200);

    process.env.XFF_TRUSTED_HOPS = "0";
    expect((await get("198.51.100.7, 10.0.0.1")).status).toBe(403);
    expect((await get("10.0.0.1, 198.51.100.7")).status).toBe(200);
  });

  it("ignores surrounding whitespace when matching", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
    expect((await get("  10.0.0.1 ,  203.0.113.9  ,  198.51.100.7 ")).status).toBe(200);

    process.env.XFF_TRUSTED_HOPS = "2";
    expect((await get("  10.0.0.1 ,  198.51.100.7  ,  203.0.113.9 ")).status).toBe(200);
  });

  it("matches an exact IP entry without a CIDR suffix", async () => {
    process.env.ALLOWED_IPS = "203.0.113.9";
    expect((await get("203.0.113.9")).status).toBe(200);
    expect((await get("203.0.113.10")).status).toBe(403);
  });

  it("matches CIDR ranges of varying width", async () => {
    process.env.ALLOWED_IPS = "10.0.0.0/8";
    expect((await get("10.255.255.254")).status).toBe(200);
    expect((await get("11.0.0.1")).status).toBe(403);

    process.env.ALLOWED_IPS = "192.168.1.0/30";
    expect((await get("192.168.1.3")).status).toBe(200);
    expect((await get("192.168.1.4")).status).toBe(403);
  });

  it("allows any address for a /0 CIDR", async () => {
    process.env.ALLOWED_IPS = "0.0.0.0/0";
    expect((await get("203.0.113.9")).status).toBe(200);
  });

  it("accepts a comma-separated allowlist of mixed entries", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24, 203.0.113.9 ,10.0.0.0/8";
    expect((await get("203.0.113.9")).status).toBe(200);
    expect((await get("10.1.2.3")).status).toBe(200);
    expect((await get("198.51.100.200")).status).toBe(200);
    expect((await get("192.0.2.1")).status).toBe(403);
  });
});
