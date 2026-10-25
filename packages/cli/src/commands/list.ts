import { Command } from "commander";
import { apiList } from "../lib/api.js";
import { readConfig } from "../lib/config.js";
import { formatExpiry } from "../lib/expiry.js";

export const listCommand = new Command("list")
  .description("List uploaded files")
  .option("--mine", "Show only files you own")
  .action(async (opts: { mine?: boolean }) => {
    const config = await readConfig();
    if (!config.apiEndpoint) {
      process.stderr.write("Error: run `tim setup` first\n");
      process.exit(1);
    }

    let files;
    try {
      files = await apiList(config as Required<typeof config>, { mine: opts.mine });
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
    if (files.length === 0) {
      process.stdout.write("No files uploaded yet.\n");
      return;
    }

    const urlW = Math.max("URL".length, ...files.map((f) => f.url.length)) + 2;
    const titleW = 32;
    const dateW = 12;
    // 所有者なし（認証導入前のファイル）は "-"
    const ownerOf = (f: (typeof files)[number]) => f.owner?.email ?? "-";
    const ownerW = Math.max("OWNER".length, ...files.map((f) => ownerOf(f).length)) + 2;
    const header = `${"URL".padEnd(urlW)}${"TITLE".padEnd(titleW)}${"OWNER".padEnd(ownerW)}${"CREATED".padEnd(dateW)}EXPIRES`;
    process.stdout.write(`${header}\n`);
    for (const f of files) {
      const created = f.createdAt.slice(0, 10);
      const expires = formatExpiry(f.expiresAt);
      // 版の番号を先頭に付ける。切り詰めは番号を含めた幅で行う。
      const labeled = `v${f.latestVersion ?? 1} ${f.title}`;
      const title = labeled.length > titleW - 2 ? `${labeled.slice(0, titleW - 3)}…` : labeled;
      const row = `${f.url.padEnd(urlW)}${title.padEnd(titleW)}${ownerOf(f).padEnd(ownerW)}${created.padEnd(dateW)}${expires}`;
      process.stdout.write(`${row}\n`);
    }
  });
