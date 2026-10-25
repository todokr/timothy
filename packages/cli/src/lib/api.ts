import type { Config } from "./config.js";
import { readCredentials } from "./credentials.js";

export type UploadPayload = {
  title: string;
  description: string;
  /** null は無期限。 */
  ttlDays: number | null;
};

export type UploadInitResponse = {
  id: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  url: string;
  /** ISO 8601。null は無期限。 */
  expiresAt: string | null;
};

export type UploadResponse = {
  id: string;
  url: string;
  /** ISO 8601。null は無期限。 */
  expiresAt: string | null;
};

export type FileEntry = {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  /** ISO 8601。null は無期限。 */
  expiresAt: string | null;
  /** 所有者なし（認証導入前のファイル）は null。 */
  owner: { email: string; name: string } | null;
  latestVersion: number;
};

export type RevisionResponse = { id: string; version: number; url: string };

const LOGIN_HINT = "Not logged in. Run `tim login`.";

/** 資格情報が無ければ API を呼ぶ前に案内する。無駄な往復を避け、401 と同じ文言にそろえる。 */
async function authHeaders(): Promise<Record<string, string>> {
  const credentials = await readCredentials();
  if (!credentials) throw new Error(LOGIN_HINT);
  return { Authorization: `Bearer ${credentials.token}` };
}

async function assertOk(res: Response): Promise<void> {
  if (res.status === 401) throw new Error(LOGIN_HINT);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${body}`);
  }
}

export async function apiUpload(
  payload: UploadPayload,
  html: string,
  config: Config
): Promise<UploadResponse> {
  const initRes = await fetch(`${config.apiEndpoint}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  await assertOk(initRes);
  const init = (await initRes.json()) as UploadInitResponse;

  const putRes = await fetch(init.uploadUrl, {
    method: "PUT",
    headers: init.uploadHeaders,
    body: html,
  });
  if (!putRes.ok) {
    const body = await putRes.text().catch(() => "");
    throw new Error(`Storage upload failed ${putRes.status}: ${body}`);
  }

  return { id: init.id, url: init.url, expiresAt: init.expiresAt };
}

/** 修正版の発行・確定。403 は理由が複数あるので、応答の error をそのまま見せる。 */
async function assertRevisionOk(res: Response): Promise<void> {
  if (res.status === 403) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(`Forbidden: ${body?.error ?? "not allowed"}`);
  }
  await assertOk(res);
}

export async function apiUploadRevision(
  fileId: string,
  html: string,
  config: Config
): Promise<RevisionResponse> {
  const headers = { "Content-Type": "application/json", ...(await authHeaders()) };
  const base = `${config.apiEndpoint}/files/${fileId}/versions`;

  const issueRes = await fetch(base, { method: "POST", headers, body: "{}" });
  await assertRevisionOk(issueRes);
  const issued = (await issueRes.json()) as {
    uploadId: string;
    uploadUrl: string;
    uploadHeaders: Record<string, string>;
  };

  const putRes = await fetch(issued.uploadUrl, {
    method: "PUT",
    headers: issued.uploadHeaders,
    body: html,
  });
  if (!putRes.ok) {
    const body = await putRes.text().catch(() => "");
    throw new Error(`Storage upload failed ${putRes.status}: ${body}`);
  }

  const commitRes = await fetch(`${base}/${issued.uploadId}/commit`, {
    method: "POST",
    headers,
    body: "{}",
  });
  await assertRevisionOk(commitRes);
  return (await commitRes.json()) as RevisionResponse;
}

export async function apiList(
  config: Config,
  opts: { mine?: boolean } = {}
): Promise<FileEntry[]> {
  const query = opts.mine ? "?owner=me" : "";
  const res = await fetch(`${config.apiEndpoint}/files${query}`, {
    headers: await authHeaders(),
  });
  await assertOk(res);
  const { files } = (await res.json()) as { files: FileEntry[] };
  return files;
}

export async function apiDelete(id: string, config: Config): Promise<void> {
  const res = await fetch(`${config.apiEndpoint}/files/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (res.status === 403) {
    throw new Error("Forbidden: you are not the owner of this file");
  }
  await assertOk(res);
}

/** CLI 用トークンをサーバー側で失効させる。 */
export async function apiLogoutToken(config: Config): Promise<void> {
  const res = await fetch(`${config.apiEndpoint}/auth/cli-token`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  await assertOk(res);
}
