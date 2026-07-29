import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";

export type Config = {
  apiEndpoint: string;
};

const configPath = join(homedir(), ".config", "timothy", "config.json");

export async function readConfig(): Promise<Partial<Config>> {
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw) as Partial<Config>;
  } catch {
    return {};
  }
}

export async function writeConfig(config: Partial<Config>): Promise<void> {
  const existing = await readConfig();
  const merged = { ...existing, ...config };
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(merged, null, 2), "utf-8");
}
