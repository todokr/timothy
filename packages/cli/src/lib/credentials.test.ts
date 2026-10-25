import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
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

  it("replaces a looser existing file with a 0600 one", async () => {
    const dir = join(home, ".config", "timothy");
    const path = join(dir, "credentials.json");
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify({ token: "old" }));
    await chmod(path, 0o644);
    expect((await stat(path)).mode & 0o777).toBe(0o644);

    await writeCredentials({ token: "new" });

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readCredentials()).toEqual({ token: "new" });
    // 一時ファイルが残らない
    expect(await readdir(dir)).toEqual(["credentials.json"]);
  });

  it("creates the config directory with mode 0700 but leaves an existing one alone", async () => {
    await writeCredentials({ token: "abc" });
    const dir = join(home, ".config", "timothy");
    expect((await stat(dir)).mode & 0o777).toBe(0o700);

    await chmod(dir, 0o755);
    await writeCredentials({ token: "def" });
    expect((await stat(dir)).mode & 0o777).toBe(0o755);
  });

  it("deletes credentials and tolerates a missing file", async () => {
    await writeCredentials({ token: "abc" });
    await deleteCredentials();
    expect(await readCredentials()).toBeNull();
    await expect(deleteCredentials()).resolves.toBeUndefined();
  });

  it("returns null for a malformed file", async () => {
    await writeCredentials({ token: "abc" });
    await writeFile(join(home, ".config", "timothy", "credentials.json"), "{not json");
    expect(await readCredentials()).toBeNull();
  });
});
