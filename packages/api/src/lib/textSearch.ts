import { normalizeText } from "./htmlText.js";

/**
 * 中身はアップロードされた HTML 由来なので管理画面から見れば敵性の入力。
 * 3分割で返せば JSX の子として渡すしかなくなり、エスケープが保証される。
 */
export type Snippet = { before: string; match: string; after: string };

export type ScanResult = { count: number; snippets: Snippet[] };

const SNIPPET_RADIUS = 60;
const MAX_SNIPPETS = 3;

/** 保存時と同じ正規化を掛けないと、全角で打った語が半角の本文にヒットしない。 */
export function normalizeQuery(q: string): string {
  return normalizeText(q).toLowerCase();
}

/** 部分一致なので、日本語も分かち書きなしでそのまま引ける。 */
export function scanText(
  text: string,
  normalizedQuery: string,
  max = MAX_SNIPPETS,
): ScanResult {
  if (normalizedQuery === "" || text === "") return { count: 0, snippets: [] };

  // スニペットは元テキストから切り出すのでオフセットを保つ必要がある。
  // toLowerCase が長さを変える文字（İ など）が混ざったら大文字小文字を区別する。
  const lowered = text.toLowerCase();
  const haystack = lowered.length === text.length ? lowered : text;
  const needle =
    haystack === text ? normalizedQuery : normalizedQuery.toLowerCase();

  const snippets: Snippet[] = [];
  let count = 0;
  let from = 0;

  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count += 1;
    if (snippets.length < max) {
      snippets.push(makeSnippet(text, at, needle.length));
    }
    from = at + needle.length;
  }

  return { count, snippets };
}

export function makeSnippet(
  text: string,
  at: number,
  length: number,
  radius = SNIPPET_RADIUS,
): Snippet {
  return {
    before: text.slice(Math.max(0, at - radius), at),
    match: text.slice(at, at + length),
    after: text.slice(at + length, at + length + radius),
  };
}

/** タイトル一致を重く見るのは、ファイルを特定したい意図に近いため。 */
export function scoreHits(hits: {
  titleMatches: number;
  descriptionMatches: number;
  bodyMatches: number;
}): number {
  return (
    hits.bodyMatches +
    hits.titleMatches * 5 +
    hits.descriptionMatches * 2
  );
}
