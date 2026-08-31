import { logger } from "./logger.js";

/**
 * bekko をこのプロセス内で動かす。API キーも外部サービスも要らない。
 * 出力は L2 正規化済みなので、コサイン類似度がそのまま内積になる。
 */
export const EMBEDDING_MODEL =
  process.env.EMBEDDING_MODEL ?? "hotchpotch/bekko-embedding-v1-a8m";

/**
 * firestore.indexes.json のベクトルインデックスと一致していること。
 * 次元の違うモデルに差し替えるときは、そちらの dimension も変える。
 */
export const EMBEDDING_DIM = 384;

/**
 * transformers.js の既定のキャッシュ先は node_modules の中で、
 * pnpm のレイアウトに依存する。イメージに焼き込むときはここを明示して、
 * ビルド時と実行時で同じ場所を指すようにする。
 */
const CACHE_DIR = process.env.EMBEDDING_CACHE_DIR;

type Extractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

// モデルのロードは数百 ms かかるうえ数百 MB 常駐するので、
// プロセスごとに一度だけ。リクエストごとに作ってはいけない。
let extractorPromise: Promise<Extractor> | null = null;

function loadExtractor(): Promise<Extractor> {
  extractorPromise ??= import("@huggingface/transformers").then(
    ({ env, pipeline }) => {
      if (CACHE_DIR !== undefined) {
        env.cacheDir = CACHE_DIR;
        // 焼き込んだ重みだけを使う。起動時に外へ取りに行かせない。
        env.allowRemoteModels = false;
      }
      return pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "fp32" });
    },
  ) as Promise<Extractor>;
  return extractorPromise;
}

/**
 * 埋め込めなかったときは null を返す。検索はキーワードだけで成立するので、
 * モデルが無いことで 500 にしてはいけない。
 */
export async function embed(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  try {
    const extractor = await loadExtractor();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  } catch (error) {
    // 次のリクエストで再試行できるよう、失敗したロードは覚えておかない。
    extractorPromise = null;
    logger.error({ err: error }, "embedding failed");
    return null;
  }
}

export async function embedOne(text: string): Promise<number[] | null> {
  const vectors = await embed([text]);
  return vectors?.[0] ?? null;
}
