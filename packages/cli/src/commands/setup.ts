import { createInterface } from "readline";
import { Command } from "commander";
import { writeConfig } from "../lib/config.js";
import { bold, color, green } from "../lib/color.js";

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const DEFAULT_ENDPOINT = "https://timothy-api.pooh.dev";

export const setupCommand = new Command("setup")
  .description("Save API endpoint to ~/.config/timothy/config.json")
  .action(async () => {
    const apiEndpoint = await prompt(`API endpoint [${DEFAULT_ENDPOINT}]: `);
    await writeConfig({
      apiEndpoint: apiEndpoint || DEFAULT_ENDPOINT,
    });
    process.stdout.write(`${color("✓", green, bold)} Saved config\n`);
  });
