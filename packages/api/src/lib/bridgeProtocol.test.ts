import { describe, it, expect } from "vitest";
import { BRIDGE_MESSAGES } from "./bridgeProtocol.js";

describe("BRIDGE_MESSAGES", () => {
  it("defines every message type once with the tim: prefix", () => {
    const values = Object.values(BRIDGE_MESSAGES);
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v).toMatch(/^tim:[a-z-]+$/);
  });
});
