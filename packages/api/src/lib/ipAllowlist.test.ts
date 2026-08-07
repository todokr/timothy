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
});

describe("getClientIp", () => {
  it("returns null when the header is absent", () => {
    expect(getClientIp(contextWith(undefined))).toBeNull();
  });

  it("uses the only entry when the header has a single value", () => {
    expect(getClientIp(contextWith("198.51.100.7"))).toBe("198.51.100.7");
  });

  it("uses the second-to-last entry when the header has two values", () => {
    expect(getClientIp(contextWith("203.0.113.9, 198.51.100.7"))).toBe("203.0.113.9");
  });

  it("uses the second-to-last entry when the header has three values", () => {
    expect(getClientIp(contextWith("1.2.3.4, 203.0.113.9, 198.51.100.7"))).toBe("203.0.113.9");
  });

  it("trims surrounding whitespace on the selected entry", () => {
    expect(getClientIp(contextWith("  1.2.3.4  ,\t203.0.113.9\t,  198.51.100.7  "))).toBe(
      "203.0.113.9"
    );
    expect(getClientIp(contextWith("   198.51.100.7   "))).toBe("198.51.100.7");
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

  // Regression test for the spoofing vulnerability. A client behind Google Cloud
  // Load Balancer / Cloud Run that sends `X-Forwarded-For: <allowed-ip>` from a
  // denied source address produces `<spoofed>, <real-client-ip>, <lb-ip>`.
  // Trusting the FIRST entry (the old behaviour) let anyone bypass the allowlist.
  it("denies a spoofed allowed IP when the real client IP is denied", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
    expect((await get("198.51.100.7, 203.0.113.9, 10.0.0.1")).status).toBe(403);
  });

  it("allows two entries where the second-to-last is on the allowlist", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
    expect((await get("198.51.100.7, 10.0.0.1")).status).toBe(200);
  });

  it("denies two entries where the second-to-last is not on the allowlist", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
    expect((await get("203.0.113.9, 10.0.0.1")).status).toBe(403);
  });

  it("allows three entries where the second-to-last is on the allowlist", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
    expect((await get("203.0.113.9, 198.51.100.7, 10.0.0.1")).status).toBe(200);
  });

  it("ignores surrounding whitespace when matching", async () => {
    process.env.ALLOWED_IPS = "198.51.100.0/24";
    expect((await get("  203.0.113.9 ,  198.51.100.7  ,  10.0.0.1 ")).status).toBe(200);
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
