/** `--ttl` に渡すと無期限になる値。表示にも同じ語を使う。 */
export const INDEFINITE_TTL = "never";

/** 有効期限の表示。null は無期限。 */
export function formatExpiry(expiresAt: string | null): string {
  return expiresAt === null ? INDEFINITE_TTL : expiresAt.slice(0, 10);
}
