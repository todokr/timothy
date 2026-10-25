import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Comment, FileInfo } from "../lib/api.js";
import { REVIEW_WORKFLOW } from "./instructions.js";
import { createServer, type ServerDeps } from "./server.js";

const ID = "01M5S269ZPZAQ65A57RD9VR76G";
const CID = "01JWABCDEFGHJKMNPQRSTVWXYZ";
const config = { apiEndpoint: "https://api.example.com" };
const izumi = { email: "izumi@example.com", name: "泉" };
const tanaka = { email: "tanaka@example.com", name: "田中" };

const fileInfo: FileInfo = {
  id: ID,
  title: "月次レポート",
  description: "",
  url: `https://tim.example.com/s/${ID}`,
  owner: izumi,
  expiresAt: null,
  latestVersion: 2,
  versions: [
    { version: 1, createdAt: "2026-10-01T00:00:00.000Z", uploadedBy: izumi },
    { version: 2, createdAt: "2026-10-02T00:00:00.000Z", uploadedBy: izumi },
  ],
};

const comments: Comment[] = [
  {
    id: "open1",
    version: 1,
    anchor: { type: "element", tag: "td", text: "日次", path: [0, 2, 1] },
    body: "週次にしてほしい",
    author: tanaka,
    createdAt: "2026-10-01T01:00:00.000Z",
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    replies: [
      {
        id: "r1",
        body: "v2 で直しました",
        author: izumi,
        viaAgent: true,
        createdAt: "2026-10-02T01:00:00.000Z",
      },
    ],
  },
  {
    id: "done1",
    version: 1,
    anchor: { type: "text", quote: "売上", prefix: "今月の", suffix: "は" },
    body: "単位を書いてほしい",
    author: tanaka,
    createdAt: "2026-10-01T02:00:00.000Z",
    resolved: true,
    resolvedBy: tanaka,
    resolvedAt: "2026-10-03T00:00:00.000Z",
    replies: [],
  },
];

let deps: ServerDeps;
let client: Client;

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };

const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as ToolResult;
const parse = (res: ToolResult) => JSON.parse(res.content[0].text);

beforeEach(async () => {
  deps = {
    readConfig: vi.fn().mockResolvedValue(config),
    readFile: vi.fn(),
    apiList: vi.fn(),
    apiGetFile: vi.fn().mockResolvedValue(fileInfo),
    apiGetContent: vi.fn(),
    apiListComments: vi.fn().mockResolvedValue(comments),
    apiReply: vi.fn(),
    apiUploadRevision: vi.fn(),
  } as unknown as ServerDeps;
  const server = createServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
});

describe("mcp server", () => {
  it("lists exactly the five tools and no resolve tool", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_file",
      "list_comments",
      "list_files",
      "reply_to_comment",
      "upload_revision",
    ]);
  });

  it("ships the review workflow as server instructions and as the address_comments prompt", async () => {
    expect(client.getInstructions()).toBe(REVIEW_WORKFLOW);
    const p = await client.getPrompt({ name: "address_comments", arguments: { file: "01F" } });
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0].role).toBe("user");
    expect(p.messages[0].content).toMatchObject({
      type: "text",
      text: expect.stringContaining(REVIEW_WORKFLOW),
    });
    expect((p.messages[0].content as { text: string }).text).toContain("対象のファイル: 01F");
  });

  it("lists only my files", async () => {
    vi.mocked(deps.apiList).mockResolvedValue([
      {
        id: ID,
        title: "月次レポート",
        url: fileInfo.url,
        createdAt: "2026-10-01T00:00:00.000Z",
        expiresAt: null,
        owner: izumi,
        latestVersion: 2,
      },
    ]);
    const res = await call("list_files");
    expect(deps.apiList).toHaveBeenCalledWith(config, { mine: true });
    expect(parse(res)).toEqual([
      {
        id: ID,
        title: "月次レポート",
        url: fileInfo.url,
        latestVersion: 2,
        createdAt: "2026-10-01T00:00:00.000Z",
        expiresAt: null,
      },
    ]);
  });

  it("returns HTML and versions for a share URL", async () => {
    vi.mocked(deps.apiGetContent).mockResolvedValue({ id: ID, version: 2, html: "<h1>v2</h1>" });
    const res = await call("get_file", { file: `https://tim.example.com/s/${ID}` });
    expect(res.isError).toBeFalsy();
    expect(deps.apiGetFile).toHaveBeenCalledWith(ID, config);
    expect(deps.apiGetContent).toHaveBeenCalledWith(ID, undefined, config);
    expect(parse(res)).toEqual({
      id: ID,
      title: "月次レポート",
      url: fileInfo.url,
      latestVersion: 2,
      versions: [
        { version: 1, createdAt: "2026-10-01T00:00:00.000Z" },
        { version: 2, createdAt: "2026-10-02T00:00:00.000Z" },
      ],
      version: 2,
      html: "<h1>v2</h1>",
    });
  });

  it("uses the v of a share URL when version is omitted", async () => {
    vi.mocked(deps.apiGetContent).mockResolvedValue({ id: ID, version: 1, html: "<h1>v1</h1>" });
    await call("get_file", { file: `https://tim.example.com/s/${ID}?v=1` });
    expect(deps.apiGetContent).toHaveBeenCalledWith(ID, 1, config);
  });

  it("prefers the explicit version over the v of a share URL", async () => {
    vi.mocked(deps.apiGetContent).mockResolvedValue({ id: ID, version: 2, html: "<h1>v2</h1>" });
    await call("get_file", { file: `https://tim.example.com/s/${ID}?v=1`, version: 2 });
    expect(deps.apiGetContent).toHaveBeenCalledWith(ID, 2, config);
  });

  it.each(["0", "-1", "abc", "1.5"])("ignores an invalid v=%s in a share URL", async (v) => {
    vi.mocked(deps.apiGetContent).mockResolvedValue({ id: ID, version: 2, html: "<h1>v2</h1>" });
    await call("get_file", { file: `https://tim.example.com/s/${ID}?v=${v}` });
    expect(deps.apiGetContent).toHaveBeenCalledWith(ID, undefined, config);
  });

  it("fetches the requested version", async () => {
    vi.mocked(deps.apiGetContent).mockResolvedValue({ id: ID, version: 1, html: "<h1>v1</h1>" });
    const res = await call("get_file", { file: ID, version: 1 });
    expect(deps.apiGetContent).toHaveBeenCalledWith(ID, 1, config);
    expect(parse(res).version).toBe(1);
  });

  it("hides element paths and resolved comments by default", async () => {
    const res = await call("list_comments", { file: ID });
    const out = parse(res);
    expect(out.file).toEqual({ id: ID, title: "月次レポート", latestVersion: 2 });
    expect(out.comments.map((c: { id: string }) => c.id)).toEqual(["open1"]);
    expect(out.comments[0].anchor).toEqual({ type: "element", tag: "td", text: "日次" });
    expect(out.comments[0]).toMatchObject({
      version: 1,
      author: "田中",
      createdAt: "2026-10-01T01:00:00.000Z",
      resolved: false,
      body: "週次にしてほしい",
    });
  });

  it("marks agent replies in the author name", async () => {
    const out = parse(await call("list_comments", { file: ID }));
    expect(out.comments[0].replies).toEqual([
      {
        author: "泉（agent 経由）",
        viaAgent: true,
        createdAt: "2026-10-02T01:00:00.000Z",
        body: "v2 で直しました",
      },
    ]);
  });

  it("includes resolved comments when asked", async () => {
    const out = parse(await call("list_comments", { file: ID, includeResolved: true }));
    expect(out.comments.map((c: { id: string }) => c.id)).toEqual(["open1", "done1"]);
    expect(out.comments[1].anchor).toEqual({
      type: "text",
      quote: "売上",
      prefix: "今月の",
      suffix: "は",
    });
  });

  it("replies to a comment", async () => {
    const reply = comments[0].replies[0];
    vi.mocked(deps.apiReply).mockResolvedValue({
      ...comments[0],
      replies: [reply, { ...reply, id: "r2" }],
    });
    const res = await call("reply_to_comment", {
      file: ID,
      commentId: CID,
      body: "v3 で直しました",
    });
    expect(deps.apiReply).toHaveBeenCalledWith(ID, CID, "v3 で直しました", config);
    expect(parse(res)).toEqual({ commentId: CID, replies: 2 });
  });

  it("names both the file and the comment when the reply target is not found", async () => {
    vi.mocked(deps.apiReply).mockRejectedValue(new Error(`Not found: ${ID}`));
    const res = await call("reply_to_comment", { file: ID, commentId: CID, body: "x" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe(`Not found: file ${ID} or comment ${CID}`);
  });

  it.each(["../resolve", "01C", "a/b", ""])(
    "rejects the malformed commentId %j without calling the API",
    async (commentId) => {
      const res = await call("reply_to_comment", { file: ID, commentId, body: "x" });
      expect(res.isError).toBe(true);
      expect(deps.apiReply).not.toHaveBeenCalled();
    }
  );

  it("uploads a revision from a local file", async () => {
    vi.mocked(deps.readFile).mockResolvedValue("<h1>x</h1>");
    vi.mocked(deps.apiUploadRevision).mockResolvedValue({ id: ID, version: 3, url: fileInfo.url });
    const res = await call("upload_revision", { file: ID, path: "/tmp/x.html" });
    expect(deps.readFile).toHaveBeenCalledWith("/tmp/x.html");
    expect(deps.apiUploadRevision).toHaveBeenCalledWith(ID, "<h1>x</h1>", config);
    expect(parse(res)).toEqual({ id: ID, version: 3, url: fileInfo.url });
  });

  it("uploads a revision from an HTML string", async () => {
    vi.mocked(deps.apiUploadRevision).mockResolvedValue({ id: ID, version: 3, url: fileInfo.url });
    await call("upload_revision", { file: ID, html: "<p>y</p>" });
    expect(deps.apiUploadRevision).toHaveBeenCalledWith(ID, "<p>y</p>", config);
  });

  it.each([[{}], [{ path: "/a", html: "<p>" }]])(
    "requires exactly one of path or html: %j",
    async (extra) => {
      const res = await call("upload_revision", { file: ID, ...extra });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("Specify exactly one of path or html");
      expect(deps.apiUploadRevision).not.toHaveBeenCalled();
    }
  );

  it("does not call the API when the local file cannot be read", async () => {
    vi.mocked(deps.readFile).mockRejectedValue(new Error("ENOENT"));
    const res = await call("upload_revision", { file: ID, path: "/nope.html" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Cannot read file: /nope.html");
    expect(deps.apiUploadRevision).not.toHaveBeenCalled();
  });

  it("rejects an empty html string without calling the API", async () => {
    const res = await call("upload_revision", { file: ID, html: "" });
    expect(res.isError).toBe(true);
    expect(deps.apiUploadRevision).not.toHaveBeenCalled();
  });

  it("rejects an empty path without calling the API", async () => {
    const res = await call("upload_revision", { file: ID, path: "" });
    expect(res.isError).toBe(true);
    expect(deps.readFile).not.toHaveBeenCalled();
    expect(deps.apiUploadRevision).not.toHaveBeenCalled();
  });

  it("does not call the API when the local file is empty", async () => {
    vi.mocked(deps.readFile).mockResolvedValue("");
    const res = await call("upload_revision", { file: ID, path: "/tmp/empty.html" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("Cannot upload an empty file: /tmp/empty.html");
    expect(deps.apiUploadRevision).not.toHaveBeenCalled();
  });

  it("passes the owner refusal through as an error result", async () => {
    vi.mocked(deps.apiUploadRevision).mockRejectedValue(
      new Error("Forbidden: Only the owner can upload revisions")
    );
    const res = await call("upload_revision", { file: ID, html: "<p>" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Forbidden: Only the owner can upload revisions");
  });

  it("returns the login hint instead of crashing when not logged in", async () => {
    vi.mocked(deps.apiListComments).mockRejectedValue(new Error("Not logged in. Run `tim login`."));
    const res = await call("list_comments", { file: ID });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Not logged in. Run `tim login`.");
    // サーバーは落ちずに次の呼び出しにも応答する
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(5);
  });

  it("asks for setup when no API endpoint is configured", async () => {
    vi.mocked(deps.readConfig).mockResolvedValue({});
    const res = await call("list_files");
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Run `tim setup` first");
    expect(deps.apiList).not.toHaveBeenCalled();
  });

  it("rejects an unparseable file reference", async () => {
    const res = await call("get_file", { file: "nope" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Invalid file: nope");
  });
});
