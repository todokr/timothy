/**
 * DOM パーサは入れない。必要なのは構造ではなく文字の集合で、
 * linkedom / jsdom は Lambda のコールドスタートに重すぎるため。
 */

/** 上げると既存のテキストが未インデックス扱いになり、作り直される。 */
export const CURRENT_EXTRACTOR_VERSION = 1;

/** Firestore の 1 MiB ドキュメント上限に対して十分な余裕を取った切り詰め幅。 */
export const MAX_TEXT_BYTES = 200_000;

export type Extracted = {
  title: string;
  description: string;
  text: string;
  truncated: boolean;
};

// 量指定子をネストさせない。1 MB 級の入力で破滅的バックトラックを起こすため。
const DROP_BLOCKS = [
  /<!--[\s\S]*?-->/g,
  // title / description は別途スコアリングするので、本文に残すと二重に数える。
  /<head\b[^>]*>[\s\S]*?<\/head\s*>/gi,
  // </head> が省略された文書向けの保険。
  /<title\b[^>]*>[\s\S]*?<\/title\s*>/gi,
  /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
  /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,
  /<svg\b[^>]*>[\s\S]*?<\/svg\s*>/gi,
  /<template\b[^>]*>[\s\S]*?<\/template\s*>/gi,
  /<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi,
];

// 空白にすると段落が繋がってしまうので改行にする。
const BLOCK_BOUNDARY =
  /<\/?(?:p|div|section|article|header|footer|h[1-6]|li|tr|td|th|blockquote|pre|table|thead|tbody|ul|ol|br|hr)\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  yen: "¥",
  copy: "©",
  reg: "®",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

const TITLE_RE = /<title[^>]*>([^<]*)<\/title>/i;
const DESCRIPTION_RES = [
  /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
  /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
];

function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(body.slice(2), 16);
      return isValidCodePoint(code) ? String.fromCodePoint(code) : whole;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return isValidCodePoint(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

function isValidCodePoint(code: number): boolean {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff;
}

/**
 * 保存するのは正規化後の形だけ。全角/半角が揃ううえ、マッチ位置が
 * 保存テキストとズレないのでスニペットを切り出せる。クエリ側にも同じものを掛ける。
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** UTF-8 換算 maxBytes に収まるところで、コードポイント境界を守って切る。 */
export function truncateUtf8(
  input: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const encoder = new TextEncoder();
  if (encoder.encode(input).length <= maxBytes) {
    return { text: input, truncated: false };
  }

  // サロゲートペアを割らないよう、コードポイント単位で積む。
  let bytes = 0;
  let end = 0;
  for (const ch of input) {
    const size = encoder.encode(ch).length;
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += ch.length;
  }
  return { text: input.slice(0, end), truncated: true };
}

export function extractText(html: string): Extracted {
  const title = decodeEntities(TITLE_RE.exec(html)?.[1] ?? "").trim();

  let description = "";
  for (const re of DESCRIPTION_RES) {
    const matched = re.exec(html);
    if (matched?.[1]) {
      description = decodeEntities(matched[1]).trim();
      break;
    }
  }

  let body = html;
  for (const re of DROP_BLOCKS) {
    body = body.replace(re, " ");
  }

  body = body.replace(BLOCK_BOUNDARY, "\n");
  // 削除ではなく空白に。<td>foo</td><td>bar</td> が foobar に潰れると、
  // 存在しない語が検索にヒットしてしまう。
  body = body.replace(/<[^>]*>/g, " ");

  const normalized = normalizeText(decodeEntities(body));
  const { text, truncated } = truncateUtf8(normalized, MAX_TEXT_BYTES);

  return { title, description, text, truncated };
}
