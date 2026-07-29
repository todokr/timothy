#!/usr/bin/env node
import { Command } from "commander";
import { deleteCommand } from "./commands/delete.js";
import { listCommand } from "./commands/list.js";
import { setupCommand } from "./commands/setup.js";
import { uploadCommand } from "./commands/upload.js";

const program = new Command();
program
  .name("tim")
  .description("Upload LLM-generated HTML and share via time-limited URLs")
  .version("0.1.1");

program.addCommand(setupCommand);
program.addCommand(uploadCommand);
program.addCommand(listCommand);
program.addCommand(deleteCommand);

await program.parseAsync();
