import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Credentials = { token: string };

// config.json（エンドポイントなど共有しても困らない設定）とは分ける。
// トークンはファイルの持ち主だけが読めるようにしたいので、権限を別に管理できる必要がある。
// テストで HOME を差し替えられるよう、パスは呼び出しのたびに組み立てる。
function credentialsPath(): string {
  return join(homedir(), ".config", "timothy", "credentials.json");
}

export async function readCredentials(): Promise<Credentials | null> {
  try {
    const parsed = JSON.parse(await readFile(credentialsPath(), "utf-8")) as { token?: unknown };
    return typeof parsed.token === "string" && parsed.token !== "" ? { token: parsed.token } : null;
  } catch {
    return null;
  }
}

export async function writeCredentials(credentials: Credentials): Promise<void> {
  const path = credentialsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ token: credentials.token }, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  // mode は新規作成時にしか効かない。既に緩い権限で存在するファイルも締め直す
  await chmod(path, 0o600);
}

export async function deleteCredentials(): Promise<void> {
  await rm(credentialsPath(), { force: true });
}
