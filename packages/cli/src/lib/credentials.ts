import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  // 既存の config.json と同じディレクトリを共有するので、新規作成のときだけ 0700 にする
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // 既存ファイルが緩い権限でも、そこへ新しいトークンを書かない。
  // 0600 で作った一時ファイルに書いてから rename で置き換えれば、トークンが
  // 他のユーザーに読める状態で存在する瞬間がない（置き換え後は inode ごと新しい）。
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify({ token: credentials.token }, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

export async function deleteCredentials(): Promise<void> {
  await rm(credentialsPath(), { force: true });
}
