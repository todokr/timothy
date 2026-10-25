import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteCredentials, readCredentials, writeCredentials } from "./credentials.js";

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "tim-cred-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

describe("credentials", () => {
  it("returns null when no credentials exist", async () => {
    expect(await readCredentials()).toBeNull();
  });

  it("writes credentials with mode 0600", async () => {
    await writeCredentials({ token: "abc" });
    const s = await stat(join(home, ".config", "timothy", "credentials.json"));
    expect(s.mode & 0o777).toBe(0o600);
    expect(await readCredentials()).toEqual({ token: "abc" });
  });

  it("tightens the mode when overwriting a looser file", async () => {
    await writeCredentials({ token: "abc" });
    await writeCredentials({ token: "def" });
    const s = await stat(join(home, ".config", "timothy", "credentials.json"));
    expect(s.mode & 0o777).toBe(0o600);
    expect(await readCredentials()).toEqual({ token: "def" });
  });

  it("deletes credentials and tolerates a missing file", async () => {
    await writeCredentials({ token: "abc" });
    await deleteCredentials();
    expect(await readCredentials()).toBeNull();
    await expect(deleteCredentials()).resolves.toBeUndefined();
  });

  it("returns null for a malformed file", async () => {
    await writeCredentials({ token: "abc" });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(home, ".config", "timothy", "credentials.json"), "{not json");
    expect(await readCredentials()).toBeNull();
  });
});
