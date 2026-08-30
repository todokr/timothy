/** 埋め込みの粒度。日本語で 800 文字は概ね 800〜1,200 トークンで、8,192 の窓に収まる。 */
export const CHUNK_SIZE = 800;

/** 境界をまたぐ文が両側のチャンクから消えないようにする重なり。 */
export const CHUNK_OVERLAP = 150;

/** 1ファイルが検索結果とインデックス作成時間を占有しすぎないための上限。 */
export const MAX_CHUNKS_PER_FILE = 40;

/** 区切りを探す範囲。これを超えて遡るとチャンクが短くなりすぎる。 */
const BREAK_WINDOW = 200;

// 優先度の高い順。段落 > 改行 > 文末。
const BREAK_PATTERNS = ["\n\n", "\n", "。", "．", ". "];

/** 文字数ベースで分割する。日本語には空白区切りのトークン化が使えないため。 */
export function chunkText(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  if (trimmed.length <= CHUNK_SIZE) return [trimmed];

  const chunks: string[] = [];
  let start = 0;

  while (start < trimmed.length && chunks.length < MAX_CHUNKS_PER_FILE) {
    const hardEnd = Math.min(start + CHUNK_SIZE, trimmed.length);
    const end =
      hardEnd === trimmed.length
        ? hardEnd
        : safeBoundary(trimmed, findBreak(trimmed, start, hardEnd));

    const chunk = trimmed.slice(start, end).trim();
    if (chunk !== "") chunks.push(chunk);

    if (end >= trimmed.length) break;
    // 重なりを取りつつ、必ず前進させる（前進しないと無限ループになる）。
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }

  return chunks;
}

/** hardEnd の手前 BREAK_WINDOW 文字から、いちばん優先度の高い区切りを探す。 */
function findBreak(text: string, start: number, hardEnd: number): number {
  const floor = Math.max(start + 1, hardEnd - BREAK_WINDOW);
  for (const pattern of BREAK_PATTERNS) {
    const at = text.lastIndexOf(pattern, hardEnd - pattern.length);
    if (at >= floor) return at + pattern.length;
  }
  return hardEnd;
}

/** サロゲートペアの途中で切らない。 */
function safeBoundary(text: string, index: number): number {
  const code = text.charCodeAt(index);
  const isLowSurrogate = code >= 0xdc00 && code <= 0xdfff;
  return isLowSurrogate ? index + 1 : index;
}
