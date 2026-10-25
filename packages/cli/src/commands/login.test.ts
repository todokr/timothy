import { describe, expect, it } from "vitest";
import { startLoopback } from "./login.js";

const state = "s".repeat(32);

describe("startLoopback", () => {
  it("resolves the token when the callback carries the right state", async () => {
    const { port, token } = await startLoopback(state);
    const res = await fetch(`http://127.0.0.1:${port}/callback?token=abc&state=${state}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("ログインしました");
    expect(await token).toBe("abc");
  });

  it("ignores a callback with the wrong state and keeps waiting", async () => {
    const { port, token } = await startLoopback(state);
    let settled = false;
    token.then(() => (settled = true), () => (settled = true));

    const bad = await fetch(`http://127.0.0.1:${port}/callback?token=evil&state=nope`);
    expect(bad.status).toBe(400);
    const missing = await fetch(`http://127.0.0.1:${port}/callback?token=evil`);
    expect(missing.status).toBe(400);
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    await fetch(`http://127.0.0.1:${port}/callback?token=good&state=${state}`);
    expect(await token).toBe("good");
  });

  it("returns 404 for other paths", async () => {
    const { port, token } = await startLoopback(state);
    const res = await fetch(`http://127.0.0.1:${port}/other?token=x&state=${state}`);
    expect(res.status).toBe(404);
    await fetch(`http://127.0.0.1:${port}/callback?token=ok&state=${state}`);
    await token;
  });

  it("times out", async () => {
    const { token } = await startLoopback(state, 50);
    await expect(token).rejects.toThrow(/timed out/i);
  });

  it("closes the server after success", async () => {
    const { port, token } = await startLoopback(state);
    await fetch(`http://127.0.0.1:${port}/callback?token=abc&state=${state}`);
    await token;
    await expect(fetch(`http://127.0.0.1:${port}/callback?token=a&state=${state}`)).rejects.toThrow();
  });
});
