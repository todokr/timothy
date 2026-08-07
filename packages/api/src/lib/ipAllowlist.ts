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
 * 信頼するプロキシ段数を返す。
 *
 * `XFF_TRUSTED_HOPS` が未設定・数値でない・1 未満のときは 1 にフォールバックする。
 */
function trustedHops(): number {
  const parsed = parseInt(process.env.XFF_TRUSTED_HOPS ?? "", 10);
  if (Number.isNaN(parsed) || parsed < 1) return 1;
  return parsed;
}

/**
 * `X-Forwarded-For` から信頼できるクライアント IP を取り出す。
 *
 * クライアントが送ってきた `X-Forwarded-For` の末尾に、前段のプロキシが
 * 「実際に観測した接続元 IP」を 1 段ずつ追記していく。つまり末尾から数えて
 * `XFF_TRUSTED_HOPS` 個目のエントリだけが信頼でき、それより前は
 * クライアント側で自由に偽装できるため使ってはならない。
 *
 * 既定値の 1 は、素の Cloud Run サービス（`*.run.app`）や Lambda Function URL の
 * ように 1 段だけ追記される構成に対応する。Google Cloud Load Balancer や
 * Cloud Armor を前段に置く場合は 2 を設定する。
 *
 * エントリ数が信頼段数より少ない場合、設定したプロキシを通っていないリクエスト
 * なので信頼できない。`null` を返して呼び出し側の 403 パスに倒す。
 */
export function getClientIp(c: Context): string | null {
  const forwarded = c.req.header("x-forwarded-for");
  if (!forwarded) return null;

  const hops = trustedHops();
  const entries = forwarded.split(",").map((entry) => entry.trim());
  if (entries.length < hops) return null;
  return entries[entries.length - hops];
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
