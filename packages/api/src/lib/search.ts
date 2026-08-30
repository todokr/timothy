import { listFiles, type FileEntry } from "./files.js";
import { loadTexts } from "./textIndex.js";
import { epochMills, isExpired } from "./time.js";
import { normalizeQuery, scanText, scoreHits, type Snippet } from "./textSearch.js";
import { searchVectors } from "./vectorSearch.js";

export type SearchHit = FileEntry & {
  score: number;
  snippets: Snippet[];
  /** 意味の近さで拾ったチャンク。キーワードが本文に無くても文脈を出せる。 */
  semanticSnippet: string | null;
};

export type SearchResult = {
  query: string;
  hits: SearchHit[];
  /** 本文がまだ取り込まれていない生存ファイルの件数。UI のボタンに出す。 */
  pendingCount: number;
  /** 埋め込みが使えずキーワードのみで応答したか。 */
  keywordOnly: boolean;
};

const DEFAULT_LIMIT = 50;

/**
 * RRF の定数。順位だけを見るので、マッチ数とコサイン距離という
 * 比較不能なスケールを一度も突き合わせずに済む。
 */
const RRF_K = 60;

type Ranked = { fileId: string; snippets: Snippet[]; semantic: string | null };

/**
 * Firestore に部分一致の手段が無い（LIKE は無く >= は前方一致のみ）ため、
 * 数百件規模ではキーワード側は htmlFileTexts を全件読んで走査する。
 * 意味検索は findNearest に任せ、両者の順位を RRF で融合する。
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
    return { query, hits: [], pendingCount: 0, keywordOnly: false };
  }

  const liveIds = new Set(live.map((file) => file.id));
  const [{ texts, pending }, vectorHits] = await Promise.all([
    loadTexts(live.map((file) => file.id)),
    searchVectors(rawQuery.trim(), liveIds),
  ]);

  const keywordRanking = rankByKeyword(live, texts, query);
  const vectorRanking = rankByVector(vectorHits);

  const fused = fuse(keywordRanking, vectorRanking);
  const byId = new Map(live.map((file) => [file.id, file]));

  const hits: SearchHit[] = [];
  for (const [fileId, entry] of fused) {
    const file = byId.get(fileId);
    if (file === undefined) continue;
    hits.push({
      ...file,
      score: entry.score,
      snippets: entry.snippets,
      semanticSnippet: entry.semantic,
    });
  }

  hits.sort((a, b) => b.score - a.score);

  return {
    query,
    hits: hits.slice(0, limit),
    pendingCount: pending.length,
    keywordOnly: vectorHits === null,
  };
}

function rankByKeyword(
  live: FileEntry[],
  texts: Map<string, string>,
  query: string,
): Ranked[] {
  const scored: Array<Ranked & { score: number }> = [];

  for (const file of live) {
    const stored = texts.get(file.id);
    const body =
      stored === undefined ? { count: 0, snippets: [] } : scanText(stored, query);
    const titleMatches = scanText(file.title, query, 0).count;
    const descriptionMatches = scanText(file.description ?? "", query, 0).count;

    if (body.count === 0 && titleMatches === 0 && descriptionMatches === 0) {
      continue;
    }

    scored.push({
      fileId: file.id,
      snippets: body.snippets,
      semantic: null,
      score: scoreHits({
        titleMatches,
        descriptionMatches,
        bodyMatches: body.count,
      }),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** ファイルごとにいちばん近いチャンクだけを残して順位を作る。 */
function rankByVector(
  hits: Awaited<ReturnType<typeof searchVectors>>,
): Ranked[] {
  if (hits === null) return [];

  const best = new Map<string, { text: string; distance: number }>();
  for (const hit of hits) {
    const current = best.get(hit.fileId);
    if (current === undefined || hit.distance < current.distance) {
      best.set(hit.fileId, { text: hit.text, distance: hit.distance });
    }
  }

  return [...best.entries()]
    .sort((a, b) => a[1].distance - b[1].distance)
    .map(([fileId, chunk]) => ({
      fileId,
      snippets: [],
      semantic: chunk.text,
    }));
}

type Fused = {
  score: number;
  snippets: Snippet[];
  semantic: string | null;
};

/** Reciprocal Rank Fusion。片方にしか出ない文書はその分だけ加点されない。 */
function fuse(keyword: Ranked[], vector: Ranked[]): Map<string, Fused> {
  const fused = new Map<string, Fused>();

  const add = (ranked: Ranked[]): void => {
    ranked.forEach((entry, index) => {
      const contribution = 1 / (RRF_K + index + 1);
      const current = fused.get(entry.fileId);
      if (current === undefined) {
        fused.set(entry.fileId, {
          score: contribution,
          snippets: entry.snippets,
          semantic: entry.semantic,
        });
        return;
      }
      current.score += contribution;
      current.snippets = current.snippets.length > 0 ? current.snippets : entry.snippets;
      current.semantic ??= entry.semantic;
    });
  };

  add(keyword);
  add(vector);
  return fused;
}
