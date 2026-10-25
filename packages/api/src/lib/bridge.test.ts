import { describe, it, expect } from "vitest";
import { BRIDGE_SCRIPT, injectBridge } from "./bridge.js";

describe("injectBridge", () => {
  it.each([
    ["<!doctype html><html><head><title>t</title></head><body>x</body></html>", /<head><script data-tim-bridge>/],
    ["<html lang=ja><body>x</body></html>", /<html lang=ja><script data-tim-bridge>/],
    ["<!DOCTYPE html><p>x</p>", /^<!DOCTYPE html><script data-tim-bridge>/],
    ["<p>x</p>", /^<script data-tim-bridge>/],
  ])("injects the bridge right after the opening tag in %s", (html, re) => expect(injectBridge(html)).toMatch(re));

  it("does not mistake <header> for <head>", () => {
    expect(injectBridge("<html><header>x</header></html>")).toMatch(/^<html><script data-tim-bridge>/);
  });

  it("keeps the doctype first so the page stays in standards mode", () => {
    expect(injectBridge("<!doctype html><p>x</p>").startsWith("<!doctype html>")).toBe(true);
  });

  it("keeps the original HTML intact", () => {
    const html = "<!doctype html><html><head><title>$&</title></head><body>x</body></html>";
    expect(injectBridge(html).replace(/<script data-tim-bridge>[\s\S]*?<\/script>/, "")).toBe(html);
  });
});

describe("BRIDGE_SCRIPT", () => {
  it("never closes its own script tag early", () => {
    expect(BRIDGE_SCRIPT).not.toMatch(/<\/script/i);
  });

  it("parses as JavaScript", () => {
    expect(() => new Function(BRIDGE_SCRIPT)).not.toThrow();
  });
});
