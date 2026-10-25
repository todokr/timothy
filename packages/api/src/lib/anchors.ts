export const ANCHOR_LIMITS = { quote: 1000, context: 32, elementText: 200, pathDepth: 64, pathIndex: 100000 } as const;

export type TextAnchor = { type: "text"; quote: string; prefix: string; suffix: string };
export type ElementAnchor = { type: "element"; tag: string; text: string; path: number[] };
export type Anchor = TextAnchor | ElementAnchor;

type Result = { ok: true; anchor: Anchor } | { ok: false; error: string };

// localName を想定する。HTML は小文字、SVG は clipPath などの大文字混じりがある。
const TAG_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function hasOnlyKeys(raw: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(raw).every((k) => keys.includes(k));
}

function isString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

export function parseAnchor(raw: unknown): Result {
  if (!isRecord(raw)) return { ok: false, error: "anchor must be an object" };

  if (raw.type === "text") {
    if (!hasOnlyKeys(raw, ["type", "quote", "prefix", "suffix"])) {
      return { ok: false, error: "anchor has unexpected fields" };
    }
    if (typeof raw.quote !== "string") return { ok: false, error: "anchor.quote must be a string" };
    const quote = raw.quote.replace(/\s+/g, " ").trim();
    if (quote.length < 1 || quote.length > ANCHOR_LIMITS.quote) {
      return { ok: false, error: `anchor.quote must be 1 to ${ANCHOR_LIMITS.quote} characters` };
    }
    if (!isString(raw.prefix, ANCHOR_LIMITS.context) || !isString(raw.suffix, ANCHOR_LIMITS.context)) {
      return { ok: false, error: `anchor.prefix and anchor.suffix must be strings of at most ${ANCHOR_LIMITS.context} characters` };
    }
    return { ok: true, anchor: { type: "text", quote, prefix: raw.prefix, suffix: raw.suffix } };
  }

  if (raw.type === "element") {
    if (!hasOnlyKeys(raw, ["type", "tag", "text", "path"])) {
      return { ok: false, error: "anchor has unexpected fields" };
    }
    if (typeof raw.tag !== "string" || !TAG_PATTERN.test(raw.tag)) {
      return { ok: false, error: "anchor.tag is invalid" };
    }
    if (!isString(raw.text, ANCHOR_LIMITS.elementText)) {
      return { ok: false, error: `anchor.text must be a string of at most ${ANCHOR_LIMITS.elementText} characters` };
    }
    const path = raw.path;
    if (
      !Array.isArray(path) ||
      path.length > ANCHOR_LIMITS.pathDepth ||
      !path.every((n) => Number.isInteger(n) && n >= 0 && n <= ANCHOR_LIMITS.pathIndex)
    ) {
      return { ok: false, error: "anchor.path must be an array of non-negative integers within limits" };
    }
    return { ok: true, anchor: { type: "element", tag: raw.tag, text: raw.text, path: path as number[] } };
  }

  return { ok: false, error: 'anchor.type must be "text" or "element"' };
}
