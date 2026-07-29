import { readFile } from "fs/promises";
import { Command } from "commander";
import { apiUpload } from "../lib/api.js";
import { readConfig } from "../lib/config.js";
import { extractDescription, extractTitle } from "../lib/html.js";
import { bold, color, green } from "../lib/color.js";

export const uploadCommand = new Command("upload")
  .description("Upload an HTML file and get a signed URL")
  .argument("[file]", "HTML file to upload")
  .option("--stdin", "Read HTML from stdin instead of a file")
  .option("--title <title>", "Override title (default: extracted from <title> tag)")
  .option("--ttl <days>", "Signed URL TTL in days", "7")
  .action(async (file: string | undefined, opts: { stdin?: boolean; title?: string; ttl: string }) => {
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

    const title = opts.title ?? extractTitle(html) ?? "Untitled";
    const description = extractDescription(html) ?? "";
    const ttlDays = parseInt(opts.ttl, 10);

    const config = await readConfig();
    if (!config.apiKey || !config.apiEndpoint) {
      process.stderr.write("Error: run `tim setup` first\n");
      process.exit(1);
    }

    const result = await apiUpload({ title, description, ttlDays }, html, config as Required<typeof config>);
    process.stdout.write(`${color("✓", green, bold)} Uploaded: ${result.url}\n`);
  });
