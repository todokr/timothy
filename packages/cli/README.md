# timothy-cli

A CLI tool to upload LLM-generated HTML and share it via time-limited URLs. Only people who know the URL can view the file — no login required for viewers.

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
```

### List

```bash
tim list
```

```
ID                          TITLE             CREATED       EXPIRES
01JWXYZ...                  Monthly Report    2026-05-20    2026-05-27
01JWABC...                  Analysis          2026-05-18    2026-05-25
```

### Delete

```bash
tim delete <id>

# Skip confirmation
tim delete <id> --force
```

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
