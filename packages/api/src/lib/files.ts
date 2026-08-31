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
  /** 未取り込みなら undefined。古ければ作り直し対象。 */
  extractorVersion: number | undefined;
  /** 本文の文字数。0 なら抽出できるテキストが無かった。 */
  textLength: number;
  /** ベクトル化されたチャンク数。 */
  chunkCount: number;
};

/**
 * 取り込みの状態。
 *
 * - pending  … 本文が未取り込み、または抽出器が更新されて作り直しが要る
 * - textOnly … 本文はあるがベクトルが無い（埋め込み時にモデルが使えなかった）。
 *              キーワードでは引けるが意味検索には出てこない
 * - indexed  … 上記以外
 */
export type IndexState = "pending" | "textOnly" | "indexed";

export function indexStateOf(
  file: FileEntry,
  currentExtractorVersion: number,
): IndexState {
  if (
    file.extractorVersion === undefined ||
    file.extractorVersion < currentExtractorVersion
  ) {
    return "pending";
  }
  // 本文が空の文書（JS デモなど）は、チャンクが無くて当たり前。
  if (file.chunkCount === 0 && file.textLength > 0) return "textOnly";
  return "indexed";
}

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
      extractorVersion: data.extractorVersion,
      textLength: data.textLength ?? 0,
      chunkCount: data.chunkCount ?? 0,
    };
  });
}
