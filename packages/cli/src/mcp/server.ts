import { readFile } from "fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };
import { parseFileRef } from "../commands/upload.js";
import {
  apiGetContent,
  apiGetFile,
  apiList,
  apiListComments,
  apiReply,
  apiUploadRevision,
  type Anchor,
  type Comment,
} from "../lib/api.js";
import { type Config, readConfig } from "../lib/config.js";
import { REVIEW_WORKFLOW } from "./instructions.js";

/** テストで API と設定・ファイルの読み込みを差し替えるための依存。 */
export type ServerDeps = {
  readConfig: typeof readConfig;
  readFile: (path: string) => Promise<string>;
  apiList: typeof apiList;
  apiGetFile: typeof apiGetFile;
  apiGetContent: typeof apiGetContent;
  apiListComments: typeof apiListComments;
  apiReply: typeof apiReply;
  apiUploadRevision: typeof apiUploadRevision;
};

const defaultDeps: ServerDeps = {
  readConfig,
  readFile: (path) => readFile(path, "utf-8"),
  apiList,
  apiGetFile,
  apiGetContent,
  apiListComments,
  apiReply,
  apiUploadRevision,
};

const fileArg = z.string().describe("ファイルの ID（ULID）か共有 URL");

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** ツールの例外を isError の結果に変える。サーバーは落とさない。 */
async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

/** 共有 URL の ?v= が正の整数ならその版の番号を返す。ID だけ・不正な値なら undefined。 */
function versionFromUrl(file: string): number | undefined {
  try {
    const v = new URL(file).searchParams.get("v");
    if (v !== null && /^[1-9][0-9]*$/.test(v)) return Number(v);
  } catch {
    // URL でなければ（ID だけなど）版の指定は無い。
  }
  return undefined;
}

function toFileId(file: string): string {
  const id = parseFileRef(file);
  if (!id) throw new Error(`Invalid file: ${file}`);
  return id;
}

// 要素の path は JS 実行後の DOM での位置で、保存された HTML とは対応しないので返さない。
function toAnchor(anchor: Anchor) {
  if (anchor.type === "text") {
    return { type: "text", quote: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix };
  }
  return { type: "element", tag: anchor.tag, text: anchor.text };
}

function toComment(c: Comment) {
  return {
    id: c.id,
    version: c.version,
    anchor: toAnchor(c.anchor),
    author: c.author.name,
    createdAt: c.createdAt,
    resolved: c.resolved,
    body: c.body,
    replies: c.replies.map((r) => ({
      author: r.viaAgent ? `${r.author.name}（agent 経由）` : r.author.name,
      viaAgent: r.viaAgent,
      createdAt: r.createdAt,
      body: r.body,
    })),
  };
}

export function createServer(overrides: Partial<ServerDeps> = {}): McpServer {
  const deps: ServerDeps = { ...defaultDeps, ...overrides };

  async function config(): Promise<Config> {
    const c = await deps.readConfig();
    if (!c.apiEndpoint) throw new Error("Run `tim setup` first");
    return c as Config;
  }

  const server = new McpServer(
    { name: "timothy", version: pkg.version },
    { instructions: REVIEW_WORKFLOW }
  );

  server.registerTool(
    "list_files",
    { description: "自分がアップロードしたファイルの一覧を返す。" },
    () =>
      run(async () => {
        const files = await deps.apiList(await config(), { mine: true });
        return files.map((f) => ({
          id: f.id,
          title: f.title,
          url: f.url,
          latestVersion: f.latestVersion ?? 1,
          createdAt: f.createdAt,
          expiresAt: f.expiresAt,
        }));
      })
  );

  server.registerTool(
    "get_file",
    {
      description:
        "ファイルの情報（タイトル・版の一覧）と、保存された HTML を返す。version を省くと最新版。配信用に差し込まれたもの（ブリッジスクリプトなど）は含まない。",
      inputSchema: {
        file: fileArg,
        version: z.number().int().positive().optional().describe("取得する版の番号。省くと、共有 URL の ?v= があればその版、なければ最新版"),
      },
    },
    ({ file, version }) =>
      run(async () => {
        const id = toFileId(file);
        const c = await config();
        const v = version ?? versionFromUrl(file);
        const [info, content] = await Promise.all([
          deps.apiGetFile(id, c),
          deps.apiGetContent(id, v, c),
        ]);
        return {
          id: info.id,
          title: info.title,
          url: info.url,
          latestVersion: info.latestVersion,
          versions: info.versions.map((v) => ({ version: v.version, createdAt: v.createdAt })),
          version: content.version,
          html: content.html,
        };
      })
  );

  server.registerTool(
    "list_comments",
    {
      description:
        "ファイルに付いたコメントを、全部の版の分まとめて返す。各コメントには付けた版と対象（文字範囲なら quote・prefix・suffix、要素なら tag・text）が入る。既定では未解決のものだけ。",
      inputSchema: {
        file: fileArg,
        includeResolved: z
          .boolean()
          .optional()
          .describe("true なら解決済みのコメントも含める。既定は false"),
      },
    },
    ({ file, includeResolved }) =>
      run(async () => {
        const id = toFileId(file);
        const c = await config();
        const [info, comments] = await Promise.all([
          deps.apiGetFile(id, c),
          deps.apiListComments(id, c),
        ]);
        return {
          file: { id: info.id, title: info.title, latestVersion: info.latestVersion },
          comments: comments.filter((cm) => includeResolved || !cm.resolved).map(toComment),
        };
      })
  );

  server.registerTool(
    "reply_to_comment",
    {
      description: "コメントに返信する。返信は agent 経由として記録される。コメントを解決にはしない。",
      inputSchema: {
        file: fileArg,
        commentId: z
          .string()
          .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "commentId must be a ULID")
          .describe("返信するコメントの ID（list_comments の id）"),
        body: z.string().min(1).max(10_000).describe("返信の本文（1〜10,000 文字）"),
      },
    },
    ({ file, commentId, body }) =>
      run(async () => {
        const id = toFileId(file);
        const c = await config();
        try {
          const comment = await deps.apiReply(id, commentId, body, c);
          return { commentId, replies: comment.replies.length };
        } catch (err) {
          // API はファイルが無いときもコメントが無いときも 404 を返すので、どちらもありうると伝える。
          if (err instanceof Error && err.message.startsWith("Not found:")) {
            throw new Error(`Not found: file ${id} or comment ${commentId}`);
          }
          throw err;
        }
      })
  );

  server.registerTool(
    "upload_revision",
    {
      description:
        "ファイルに修正版をアップロードし、新しい版の番号と URL を返す。本文は path（手元の HTML ファイルのパス。MCP サーバーの作業ディレクトリからの相対で解決されるので、絶対パスで渡す）か html（HTML の文字列）のどちらか 1 つで渡す。所有者だけが上げられる。",
      inputSchema: {
        file: fileArg,
        path: z.string().min(1).optional().describe("修正版の HTML ファイルのパス"),
        html: z.string().min(1).optional().describe("修正版の HTML の文字列"),
      },
    },
    ({ file, path, html }) =>
      run(async () => {
        const id = toFileId(file);
        if ((path === undefined) === (html === undefined)) {
          throw new Error("Specify exactly one of path or html");
        }
        const c = await config();
        let body: string;
        if (path !== undefined) {
          try {
            body = await deps.readFile(path);
          } catch {
            throw new Error(`Cannot read file: ${path}`);
          }
          if (body.length === 0) throw new Error(`Cannot upload an empty file: ${path}`);
        } else {
          body = html as string;
        }
        return deps.apiUploadRevision(id, body, c);
      })
  );

  server.registerPrompt(
    "address_comments",
    {
      description: "ファイルに付いたレビューコメントに対応する手順を示す。",
      argsSchema: { file: fileArg },
    },
    ({ file }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: `${REVIEW_WORKFLOW}\n\n対象のファイル: ${file}` },
        },
      ],
    })
  );

  return server;
}
