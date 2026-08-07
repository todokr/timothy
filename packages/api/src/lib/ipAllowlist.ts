import type { Context, Next } from "hono";

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

function isInCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes("/")) return ip === cidr;
  const [range, bits] = cidr.split("/");
  const mask = bits === "0" ? 0 : (~0 << (32 - parseInt(bits, 10))) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(range) & mask);
}

/**
 * `X-Forwarded-For` から信頼できるクライアント IP を取り出す。
 *
 * Cloud Run / Google Cloud Load Balancer / Lambda Function URL は、クライアントが
 * 送ってきた `X-Forwarded-For` の末尾に「実際に観測した接続元 IP」を追記する。
 * つまり先頭のエントリは完全にクライアント側で偽装できるため使ってはならず、
 * 信頼できるのは末尾から 2 番目のエントリ（末尾はロードバランサ自身の IP）。
 *
 * エントリが 1 つしかない場合、それがプラットフォームの追記した値そのものなので採用する。
 */
export function getClientIp(c: Context): string | null {
  const forwarded = c.req.header("x-forwarded-for");
  if (!forwarded) return null;

  const entries = forwarded.split(",");
  if (entries.length === 1) return entries[0].trim();
  return entries[entries.length - 2].trim();
}

export async function ipAllowlistMiddleware(c: Context, next: Next): Promise<void | Response> {
  const raw = process.env.ALLOWED_IPS ?? "";
  if (raw.trim()) {
    const allowlist = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const clientIp = getClientIp(c);

    if (!clientIp || !allowlist.some((entry) => isInCidr(clientIp, entry))) {
      return c.json({ error: "Forbidden" }, 403);
    }
  }

  await next();
}
