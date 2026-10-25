import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Command } from "commander";
import { readConfig } from "../lib/config.js";
import { writeCredentials } from "../lib/credentials.js";
import { bold, color, green } from "../lib/color.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
// API が発行するトークンは base64url のみ。それ以外が来たら偽物として扱う
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

// 外部リソースを読まない最小の HTML。URL にトークンが載っているので、
// Referrer-Policy と Cache-Control でトークンの漏れと再利用を防ぐ
const SUCCESS_HTML = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Timothy</title></head>
<body><p>ログインしました。このタブは閉じて構いません。</p></body></html>`;

/**
 * 127.0.0.1 の空きポートでブラウザからのリダイレクトを待ち受ける。
 *
 * state が合わない呼び出しは無視して待ち続ける。同じマシン上の別プロセスや
 * 悪意あるページから偽のトークンを流し込まれないようにするため。
 */
export function startLoopback(
  state: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<{ port: number; token: Promise<string> }> {
  return new Promise((resolveStart, rejectStart) => {
    let resolveToken!: (token: string) => void;
    let rejectToken!: (err: Error) => void;
    const token = new Promise<string>((resolve, reject) => {
      resolveToken = resolve;
      rejectToken = reject;
    });
    let timer: NodeJS.Timeout | undefined;

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const received = url.searchParams.get("token");
      if (url.searchParams.get("state") !== state || received === null || !TOKEN_PATTERN.test(received)) {
        res.writeHead(400, { "Cache-Control": "no-store" }).end("Bad request");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
        Connection: "close",
      });
      res.end(SUCCESS_HTML, () => {
        clearTimeout(timer);
        server.close();
        server.closeAllConnections();
        resolveToken(received);
      });
    });

    server.once("error", rejectStart);
    // 127.0.0.1 だけに bind する。0.0.0.0 だと同じネットワークの他人が叩ける
    server.listen(0, "127.0.0.1", () => {
      timer = setTimeout(() => {
        server.close();
        server.closeAllConnections();
        rejectToken(new Error("Login timed out. Run `tim login` again."));
      }, timeoutMs);
      timer.unref?.();
      resolveStart({ port: (server.address() as AddressInfo).port, token });
    });
  });
}

function openBrowser(url: string): void {
  // Windows の `start` は cmd 経由になり、URL 中の & がコマンド区切りとして解釈される。
  // シェルを通さない rundll32 で開く
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    // コマンドが無い環境では error が飛ぶ。URL は別途表示しているので握りつぶす
    child.on("error", () => {});
    child.unref();
  } catch {
    // 同上
  }
}

export const loginCommand = new Command("login")
  .description("Log in with Google through your browser")
  .action(async () => {
    const config = await readConfig();
    if (!config.apiEndpoint) {
      process.stderr.write("Error: run `tim setup` first\n");
      process.exit(1);
    }

    const state = randomBytes(32).toString("base64url");
    const { port, token } = await startLoopback(state);
    const url = `${config.apiEndpoint}/auth/cli?port=${port}&state=${state}`;

    process.stdout.write(`Opening your browser to log in. If it does not open, visit:\n${url}\n`);
    openBrowser(url);

    try {
      await writeCredentials({ token: await token });
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
    process.stdout.write(`${color("✓", green, bold)} Logged in\n`);
  });
