import { Command } from "commander";
import { apiLogoutToken } from "../lib/api.js";
import { readConfig } from "../lib/config.js";
import { deleteCredentials, readCredentials } from "../lib/credentials.js";
import { bold, color, green } from "../lib/color.js";

export const logoutCommand = new Command("logout")
  .description("Revoke the CLI token and remove saved credentials")
  .action(async () => {
    const config = await readConfig();
    if (!config.apiEndpoint) {
      process.stderr.write("Error: run `tim setup` first\n");
      process.exit(1);
    }

    // サーバー側の失効に失敗しても（オフライン・既に失効済みなど）手元の削除は必ず行う。
    // 失敗を理由にトークンがローカルに残り続けるほうが害が大きい。
    if (await readCredentials()) {
      try {
        await apiLogoutToken(config as Required<typeof config>);
      } catch {
        process.stderr.write("Warning: could not revoke the token on the server\n");
      }
    }
    await deleteCredentials();
    process.stdout.write(`${color("✓", green, bold)} Logged out\n`);
  });
