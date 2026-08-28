import { Command } from "commander";
import { apiList } from "../lib/api.js";
import { readConfig } from "../lib/config.js";
import { formatExpiry } from "../lib/expiry.js";

export const listCommand = new Command("list")
  .description("List uploaded files")
  .action(async () => {
    const config = await readConfig();
    if (!config.apiEndpoint) {
      process.stderr.write("Error: run `tim setup` first\n");
      process.exit(1);
    }

    const files = await apiList(config as Required<typeof config>);
    if (files.length === 0) {
      process.stdout.write("No files uploaded yet.\n");
      return;
    }

    const urlW = Math.max("URL".length, ...files.map((f) => f.url.length)) + 2;
    const titleW = 32;
    const dateW = 12;
    const header = `${"URL".padEnd(urlW)}${"TITLE".padEnd(titleW)}${"CREATED".padEnd(dateW)}EXPIRES`;
    process.stdout.write(`${header}\n`);
    for (const f of files) {
      const created = f.createdAt.slice(0, 10);
      const expires = formatExpiry(f.expiresAt);
      const title = f.title.length > titleW - 2 ? `${f.title.slice(0, titleW - 3)}…` : f.title;
      const row = `${f.url.padEnd(urlW)}${title.padEnd(titleW)}${created.padEnd(dateW)}${expires}`;
      process.stdout.write(`${row}\n`);
    }
  });
