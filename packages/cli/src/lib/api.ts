import type { Config } from "./config.js";

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
};

const jsonHeaders: Record<string, string> = {
  "Content-Type": "application/json",
};

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
    headers: jsonHeaders,
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

  // アップロード自体は成功しているので警告に留める
  // （古い API を新しい CLI から叩く場合もここを通る）。
  try {
    const indexRes = await fetch(
      `${config.apiEndpoint}/files/${encodeURIComponent(init.id)}/index`,
      { method: "POST" }
    );
    if (!indexRes.ok) {
      process.stderr.write(
        `warning: failed to index file contents (HTTP ${indexRes.status}). Search may not find this file until it is re-indexed.\n`
      );
    }
  } catch {
    process.stderr.write(
      "warning: failed to index file contents. Search may not find this file until it is re-indexed.\n"
    );
  }

  return { id: init.id, url: init.url, expiresAt: init.expiresAt };
}

export async function apiList(config: Config): Promise<FileEntry[]> {
  const res = await fetch(`${config.apiEndpoint}/files`);
  await assertOk(res);
  const { files } = (await res.json()) as { files: FileEntry[] };
  return files;
}

export async function apiDelete(id: string, config: Config): Promise<void> {
  const res = await fetch(`${config.apiEndpoint}/files/${id}`, {
    method: "DELETE",
  });
  await assertOk(res);
}
