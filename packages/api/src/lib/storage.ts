import type { Bucket } from "@google-cloud/storage";
import { storage } from "./firebase.js";

export function getBucket(): Bucket {
  return storage.bucket();
}

export async function uploadHtml(
  storagePath: string,
  html: string
): Promise<void> {
  const bucket = getBucket();
  const file = bucket.file(storagePath);
  await file.save(html, { contentType: "text/html; charset=utf-8" });
}

export const UPLOAD_CONTENT_TYPE = "text/html; charset=utf-8";

const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;

export async function generateSignedUploadUrl(
  storagePath: string
): Promise<string> {
  const bucket = getBucket();
  const [url] = await bucket.file(storagePath).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + UPLOAD_URL_TTL_MS,
    contentType: UPLOAD_CONTENT_TYPE,
  });
  return url;
}

export async function getFileContent(storagePath: string): Promise<string> {
  const bucket = getBucket();
  const [contents] = await bucket.file(storagePath).download();
  return contents.toString("utf-8");
}

export async function deleteFile(storagePath: string): Promise<void> {
  const bucket = getBucket();
  await bucket.file(storagePath).delete();
}

/** Storage が「オブジェクトが無い」ことを示すエラーかどうか。 */
export function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === 404
  );
}
