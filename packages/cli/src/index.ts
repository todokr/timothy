#!/usr/bin/env node
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { deleteCommand } from "./commands/delete.js";
import { listCommand } from "./commands/list.js";
import { searchCommand } from "./commands/search.js";
import { setupCommand } from "./commands/setup.js";
import { uploadCommand } from "./commands/upload.js";

const program = new Command();
program
  .name("tim")
  .description("Upload LLM-generated HTML and share via time-limited URLs")
  .version(pkg.version);

program.addCommand(setupCommand);
program.addCommand(uploadCommand);
program.addCommand(listCommand);
program.addCommand(searchCommand);
program.addCommand(deleteCommand);

await program.parseAsync();
