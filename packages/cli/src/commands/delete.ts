import { createInterface } from "node:readline";
import { Command } from "commander";
import { apiDelete } from "../lib/api.js";
import { readConfig } from "../lib/config.js";

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y");
    });
  });
}

export const deleteCommand = new Command("delete")
  .description("Delete an uploaded file by ID")
  .argument("<id>", "File ID to delete")
  .option("--force", "Skip confirmation prompt")
  .action(async (id: string, options: { force?: boolean }) => {
    const config = await readConfig();
    if (!config.apiEndpoint) {
      process.stderr.write("Error: run `tim setup` first\n");
      process.exit(1);
    }

    if (!options.force) {
      const ok = await confirm(`Delete ${id}? [y/N] `);
      if (!ok) {
        process.stdout.write("Cancelled.\n");
        return;
      }
    }

    try {
      await apiDelete(id, config as Required<typeof config>);
      process.stdout.write(`Deleted ${id}\n`);
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });
