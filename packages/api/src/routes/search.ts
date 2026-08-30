import { Hono } from "hono";
import { resolveBaseUrl } from "../lib/files.js";
import { searchFiles } from "../lib/search.js";

const app = new Hono();

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

app.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q === "") {
    return c.json({ error: "Missing query parameter: q" }, 400);
  }

  const result = await searchFiles(q, resolveBaseUrl(c), parseLimit(c.req.query("limit")));

  return c.json({
    query: q,
    total: result.hits.length,
    pendingCount: result.pendingCount,
    results: result.hits.map((hit) => ({
      id: hit.id,
      title: hit.title,
      description: hit.description,
      url: hit.url,
      expiresAt: hit.expiresAt,
      createdAt: hit.createdAt,
      score: hit.score,
      snippets: hit.snippets,
    })),
  });
});

export default app;
