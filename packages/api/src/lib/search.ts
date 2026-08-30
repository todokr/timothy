import { listFiles, type FileEntry } from "./files.js";
import { loadTexts } from "./textIndex.js";
import { epochMills, isExpired } from "./time.js";
import { normalizeQuery, scanText, scoreHits, type Snippet } from "./textSearch.js";

export type SearchHit = FileEntry & {
  score: number;
  snippets: Snippet[];
};

export type SearchResult = {
  query: string;
  hits: SearchHit[];
  /** 本文がまだ取り込まれていない生存ファイルの件数。UI のボタンに出す。 */
  pendingCount: number;
};

const DEFAULT_LIMIT = 50;

/**
 * Firestore に部分一致の手段が無い（LIKE は無く >= は前方一致のみ）ため、
 * 数百件規模では全件をメモリに載せて走査する。
 */
export async function searchFiles(
  rawQuery: string,
  baseUrl: string,
  limit = DEFAULT_LIMIT,
): Promise<SearchResult> {
  const query = normalizeQuery(rawQuery);

  const files = await listFiles(baseUrl);
  const nowMs = epochMills();
  const live = files.filter((file) => !isExpired(file.expiresAt, nowMs));

  if (query === "") {
    return { query, hits: [], pendingCount: 0 };
  }

  const { texts, pending } = await loadTexts(live.map((file) => file.id));

  const hits: SearchHit[] = [];
  for (const file of live) {
    const stored = texts.get(file.id);
    const body =
      stored === undefined ? { count: 0, snippets: [] } : scanText(stored, query);
    const titleMatches = scanText(file.title, query, 0).count;
    const descriptionMatches = scanText(file.description ?? "", query, 0).count;

    if (body.count === 0 && titleMatches === 0 && descriptionMatches === 0) {
      continue;
    }

    hits.push({
      ...file,
      score: scoreHits({
        titleMatches,
        descriptionMatches,
        bodyMatches: body.count,
      }),
      snippets: body.snippets,
    });
  }

  // listFiles は createdAt 降順なので、安定ソートに任せれば同点は新しい順になる。
  hits.sort((a, b) => b.score - a.score);

  return { query, hits: hits.slice(0, limit), pendingCount: pending.length };
}
