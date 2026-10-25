import { Command } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../mcp/server.js";

// 標準出力は JSON-RPC 専用。案内やログを書くなら標準エラー出力へ。
export const mcpCommand = new Command("mcp")
  .description("Run the timothy MCP server over stdio")
  .action(async () => {
    await createServer().connect(new StdioServerTransport());
  });
