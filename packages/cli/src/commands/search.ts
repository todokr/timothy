import { Command } from "commander";
import { apiSearch, type SearchHit } from "../lib/api.js";
import { bold, color, yellow } from "../lib/color.js";
import { readConfig } from "../lib/config.js";

const DEFAULT_LIMIT = 20;

function parseLimit(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    process.stderr.write(`Error: --limit must be a positive integer\n`);
    process.exit(1);
  }
  return parsed;
}

/** スニペットを1行にまとめ、マッチ部分だけ色を付ける。 */
function formatSnippet(hit: SearchHit): string[] {
  return hit.snippets.map((snippet) => {
    const before = snippet.before.replace(/\n/g, " ");
    const after = snippet.after.replace(/\n/g, " ");
    return `    …${before}${color(snippet.match, yellow)}${after}…`;
  });
}

export const searchCommand = new Command("search")
  .description("Search the contents of uploaded files")
  .argument("<query>", "text to search for")
  .option("-n, --limit <count>", "maximum number of results", String(DEFAULT_LIMIT))
  .option("--json", "print the raw JSON response")
  .action(async (query: string, opts: { limit: string; json?: boolean }) => {
    const config = await readConfig();
    if (!config.apiEndpoint) {
      process.stderr.write("Error: run `tim setup` first\n");
      process.exit(1);
    }

    const response = await apiSearch(
      query,
      parseLimit(opts.limit),
      config as Required<typeof config>
    );

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
      return;
    }

    if (response.pendingCount > 0) {
      process.stderr.write(
        `warning: ${response.pendingCount} file(s) are not indexed yet and were not searched. ` +
          `Open the web UI to index them.\n`
      );
    }

    if (response.results.length === 0) {
      process.stdout.write(`No files matched "${query}".\n`);
      return;
    }

    for (const hit of response.results) {
      process.stdout.write(`${color(hit.title, bold)}\n`);
      process.stdout.write(`  ${hit.url}\n`);
      for (const line of formatSnippet(hit)) {
        process.stdout.write(`${line}\n`);
      }
      process.stdout.write("\n");
    }
  });
