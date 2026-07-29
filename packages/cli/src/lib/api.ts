import type { Config } from "./config.js";

export type UploadPayload = {
  title: string;
  description: string;
  ttlDays: number;
};

export type UploadInitResponse = {
  id: string;
  uploadUrl: string;
  uploadHeaders: Record<string, string>;
  url: string;
  expiresAt: string;
};

export type UploadResponse = {
  id: string;
  url: string;
  expiresAt: string;
};

export type FileEntry = {
  id: string;
  title: string;
  createdAt: string;
  expiresAt: string;
};

function authHeaders(apiKey: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function assertOk(res: Response): Promise<void> {
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
    headers: authHeaders(config.apiKey),
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

export async function apiList(config: Config): Promise<FileEntry[]> {
  const res = await fetch(`${config.apiEndpoint}/files`, {
    headers: authHeaders(config.apiKey),
  });
  await assertOk(res);
  const { files } = await res.json() as { files: FileEntry[] };
  return files;
}

export async function apiDelete(id: string, config: Config): Promise<void> {
  const res = await fetch(`${config.apiEndpoint}/files/${id}`, {
    method: "DELETE",
    headers: authHeaders(config.apiKey),
  });
  await assertOk(res);
}
