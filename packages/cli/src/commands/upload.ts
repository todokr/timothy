import { readFile } from "fs/promises";
import { Command } from "commander";
import { apiUpload, apiUploadRevision } from "../lib/api.js";
import { readConfig } from "../lib/config.js";
import { extractDescription, extractTitle } from "../lib/html.js";
import { INDEFINITE_TTL, formatExpiry } from "../lib/expiry.js";
import { bold, color, green } from "../lib/color.js";

type TtlResult = { ok: true; ttlDays: number | null } | { ok: false; error: string };

/**
 * `--ttl` の値を API の ttlDays に変換する。`never` は無期限を表す null。
 *
 * parseInt は "abc" を NaN、"7days" を 7 として返すため、そのまま API に
 * 送ると分かりにくい 400 になる。数字だけの表記かどうかをここで確かめる。
 */
export function parseTtlOption(value: string): TtlResult {
  if (value === INDEFINITE_TTL) return { ok: true, ttlDays: null };

  if (!/^\d+$/.test(value)) {
    return { ok: false, error: `--ttl must be a positive integer or "${INDEFINITE_TTL}"` };
  }
  const ttlDays = Number(value);
  if (ttlDays <= 0) {
    return { ok: false, error: `--ttl must be a positive integer or "${INDEFINITE_TTL}"` };
  }
  return { ok: true, ttlDays };
}

const ULID = "[0-9A-HJKMNP-TV-Z]{26}";

/**
 * `--to` の値からファイル ID を取り出す。ULID そのものか、`/s/<ID>` を含む URL
 * （`?v=` 付きも可）を受け付け、どちらでもなければ null。
 */
export function parseFileRef(value: string): string | null {
  if (new RegExp(`^${ULID}$`).test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.pathname.match(new RegExp(`/s/(${ULID})(?:/|$)`))?.[1] ?? null;
}

export const uploadCommand = new Command("upload")
  .description("Upload an HTML file and get a signed URL")
  .argument("[file]", "HTML file to upload")
  .option("--stdin", "Read HTML from stdin instead of a file")
  .option("--title <title>", "Override title (default: extracted from <title> tag)")
  .option("--ttl <days|never>", 'Signed URL TTL in days, or "never" for no expiry', "7")
  .option("--to <id|url>", "Upload a revision to an existing share (file ID or share URL)")
  .action(async function (
    this: Command,
    file: string | undefined,
    opts: { stdin?: boolean; title?: string; ttl: string; to?: string }
  ) {
    // --to は元のタイトルと有効期限を引き継ぐので、併用は受け付けない。
    // --ttl は既定値があるため、明示指定かどうかを値の出どころで見分ける。
    let fileRef: string | null = null;
    if (opts.to !== undefined) {
      if (opts.title !== undefined || this.getOptionValueSource("ttl") === "cli") {
        process.stderr.write(
          "Error: --title and --ttl cannot be used with --to (a revision keeps the original title and expiry)\n"
        );
        process.exit(1);
      }
      fileRef = parseFileRef(opts.to);
      if (!fileRef) {
        process.stderr.write("Error: --to must be a file ID or a share URL\n");
        process.exit(1);
      }
    }

    // 入力を読む前に落とす。stdin を読み切ってからオプション不正で終了すると、
    // パイプ元の処理が丸ごと無駄になる。
    const ttl = parseTtlOption(opts.ttl);
    if (!ttl.ok) {
      process.stderr.write(`Error: ${ttl.error}\n`);
      process.exit(1);
    }

    let html: string;
    if (opts.stdin) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      html = Buffer.concat(chunks).toString("utf-8");
    } else if (file) {
      html = await readFile(file, "utf-8");
    } else {
      process.stderr.write("Error: specify a file or --stdin\n");
      process.exit(1);
    }

    if (fileRef) {
      const config = await readConfig();
      if (!config.apiEndpoint) {
        process.stderr.write("Error: run `tim setup` first\n");
        process.exit(1);
      }
      try {
        const result = await apiUploadRevision(fileRef, html, config as Required<typeof config>);
        process.stdout.write(`${color("✓", green, bold)} Uploaded v${result.version}: ${result.url}\n`);
      } catch (err) {
        process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
      }
      return;
    }

    const title = opts.title ?? extractTitle(html) ?? "Untitled";
    const description = extractDescription(html) ?? "";

    const config = await readConfig();
    if (!config.apiEndpoint) {
      process.stderr.write("Error: run `tim setup` first\n");
      process.exit(1);
    }

    try {
      const result = await apiUpload(
        { title, description, ttlDays: ttl.ttlDays },
        html,
        config as Required<typeof config>
      );
      process.stdout.write(
        `${color("✓", green, bold)} Uploaded: ${result.url}  (expires: ${formatExpiry(result.expiresAt)})\n`
      );
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });
