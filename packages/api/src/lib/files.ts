import type { Context } from "hono";
import { db } from "./firebase.js";

export const HTML_FILES_COLLECTION = "htmlFiles";

export type FileEntry = {
  id: string;
  title: string;
  description: string;
  url: string;
  /** ISO 8601。null は無期限。 */
  expiresAt: string | null;
  /** ISO 8601 */
  createdAt: string;
};

export function resolveBaseUrl(c: Context): string {
  const proto = c.req.header("x-forwarded-proto") ?? "http";
  const host = c.req.header("host") ?? "localhost";
  return `${proto}://${host}`;
}

export async function listFiles(baseUrl: string): Promise<FileEntry[]> {
  const snapshot = await db
    .collection(HTML_FILES_COLLECTION)
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      title: data.title,
      description: data.description,
      url: `${baseUrl}/s/${doc.id}`,
      expiresAt: data.expiresAt ? data.expiresAt.toDate().toISOString() : null,
      createdAt: data.createdAt.toDate().toISOString(),
    };
  });
}
