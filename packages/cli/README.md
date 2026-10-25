# timothy-cli

A CLI tool to upload LLM-generated HTML and share it via time-limited URLs. Viewing a shared URL, uploading, listing and deleting all require a Google login on an allowed email domain (run `tim login` once for the CLI).

Requires a self-hosted instance of `@timothy/api`. See the [repository README](https://github.com/incident-buddy/timothy-cli) for self-hosting instructions.

## Installation

```bash
npm install -g timothy-cli
```

Or run without installing:

```bash
npx timothy-cli <command>
```

## Usage

### Setup

Save your API endpoint (run once):

```bash
tim setup
# API endpoint [https://api.timothy.example.com]: https://your-api.example.com
```

Configuration is stored in `~/.config/timothy/config.json`.

### Login

Log in with Google through your browser (the API admin decides which email domains are allowed):

```bash
tim login
# ✓ Logged in
```

The CLI token is stored in `~/.config/timothy/credentials.json` (mode 0600). If the browser does not open, visit the URL printed in the terminal. `tim logout` revokes the token on the server and deletes the saved credentials.

Without a login, commands fail with `Not logged in. Run \`tim login\`.` Browser-only users need nothing but a Google login.

### Upload

```bash
# Upload a file
tim upload report.html

# Upload with a custom title and TTL (days)
tim upload report.html --title "Monthly Report" --ttl 30

# Upload with no expiry
tim upload report.html --ttl never

# Pipe from stdin
llm generate report | tim upload --stdin --title "Generated Report"

# Upload a revision to an existing share (file ID or share URL)
tim upload report-v2.html --to <id|url>
```

A revision keeps the same URL and shows up as a new version (`v2`, `v3`, ...). Only the person who first uploaded the file can upload revisions, and the title and expiry carry over from the original, so `--title` and `--ttl` cannot be combined with `--to`. Files with no recorded owner cannot be revised. `tim list` prefixes each title with its latest version (`v<N>`).

### List

```bash
tim list

# Only files you own
tim list --mine
```

```
URL                         TITLE             OWNER              CREATED       EXPIRES
https://.../s/01JWXYZ...    v1 Monthly Report alice@example.com  2026-05-20    2026-05-27
https://.../s/01JWABC...    v1 Analysis       -                  2026-05-18    2026-05-25
```

Files with no recorded owner (uploaded before login existed) show `-`.

### Delete

Only the owner can delete a file; otherwise the command fails with `Forbidden: you are not the owner of this file`.

```bash
tim delete <id>

# Skip confirmation
tim delete <id> --force
```

## MCP server (`tim mcp`)

`tim mcp` runs an MCP server over stdio so an agent such as Claude Code can read review comments on your shared pages, reply to them and upload a revised version. It uses the endpoint and credentials saved by `tim setup` and `tim login`, so run both first (otherwise tool calls fail with `Not logged in. Run \`tim login\`.`).

Register it with Claude Code:

```bash
claude mcp add timothy -- tim mcp
```

Other MCP clients take the same command in their server config:

```json
{"command": "tim", "args": ["mcp"]}
```

Then ask the agent, for example: "timothy の https://your-api.example.com/s/01JWXYZ... のコメントを見て直して" ("look at the comments on this timothy page and fix them"). The same workflow is available as the prompt `address_comments` (argument `file`: a file ID or share URL) and is also sent as the server's instructions.

In every tool, `file` is a file ID (ULID) or a share URL.

| Tool | What it does |
|---|---|
| `list_files` | Lists the files you uploaded (like `tim list --mine`) |
| `get_file` | Returns the file info (title, version list) and the stored HTML. `version` defaults to the `?v=` of a share URL if present, otherwise the latest |
| `list_comments` | Returns comments across all versions. Unresolved only by default; `includeResolved: true` adds resolved ones |
| `reply_to_comment` | Replies to a comment (`file`, `commentId`, `body` of 1 to 10,000 characters) |
| `upload_revision` | Uploads a revision and returns the new version number and URL. Pass the HTML as either `path` (a local file) or `html` (a string), not both |

Notes:

- Comments cannot be resolved, and new comments cannot be created, through `tim mcp`. Resolving is left to the reviewer.
- Replies are recorded as coming from an agent and show up as "（agent 経由）" on the shared page.
- `get_file` returns the stored HTML as uploaded; the bridge script injected at serve time is not included.
- Element comments carry `tag` and `text` but no DOM `path` (a path refers to the DOM after scripts ran and does not match the stored HTML). Whether a comment is outdated is not reported; the agent compares it against the latest HTML.
- `upload_revision` follows the same rule as `tim upload --to`: only the owner can upload a revision.
- `upload_revision` resolves `path` relative to the MCP server process's working directory, so pass an absolute path.

## Publishing (maintainers)

Build and publish to npm:

```bash
# From the repository root
cd packages/cli

# Dry run — verify tarball contents before publishing
npm pack --dry-run

# Publish (unscoped package, public by default)
npm publish
```

To bump the version before publishing:

```bash
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0
npm version major   # 0.1.0 → 1.0.0
```

`prepublishOnly` runs `pnpm run build` automatically, so the `dist/` is always up to date when publishing.

## License

EPL-2.0
