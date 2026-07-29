import { Hono } from "hono";
import { db } from "../lib/firebase.js";
import { UPLOAD_CONTENT_TYPE, generateSignedUploadUrl } from "../lib/storage.js";
import { ulid } from "ulid";
import { addSeconds, now } from "../lib/time.js";

const STORAGE_BASE_PATH = "timothy-files";
const HTML_FILES_COLLECTION = "htmlFiles";

type UploadInput = {
  title: string;
  description: string;
  ttlDays: number;
};

type ParseResult = { ok: true; data: UploadInput } | { ok: false; error: string };

export function parseUploadRequest(body: unknown): ParseResult {
  if (
    typeof body !== "object" ||
    body === null ||
    !("title" in body) ||
    !("description" in body) ||
    !("ttlDays" in body)
  ) {
    return { ok: false, error: "Missing required fields: title, description, ttlDays" };
  }

  const { title, description, ttlDays } = body as Record<string, unknown>;

  if (typeof title !== "string" || title.length === 0) {
    return { ok: false, error: "title must be a non-empty string" };
  }
  if (typeof description !== "string") {
    return { ok: false, error: "description must be a string" };
  }
  if (typeof ttlDays !== "number" || !Number.isInteger(ttlDays) || ttlDays <= 0) {
    return { ok: false, error: "ttlDays must be a positive integer" };
  }

  return { ok: true, data: { title, description, ttlDays } };
}

const app = new Hono();

app.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = parseUploadRequest(body);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400);
  }
  const { title, description, ttlDays } = parsed.data;

  const id = ulid();
  const storagePath = `${STORAGE_BASE_PATH}/${id}.html`;
  const expiresAt = addSeconds(now(), ttlDays * 24 * 60 * 60);

  const uploadUrl = await generateSignedUploadUrl(storagePath);

  const proto = c.req.header("x-forwarded-proto") ?? "http";
  const host = c.req.header("host") ?? "localhost";
  const url = `${proto}://${host}/s/${id}`;

  await db.collection(HTML_FILES_COLLECTION).doc(id).set({
    title,
    description,
    storagePath,
    expiresAt,
    createdAt: now(),
  });

  return c.json({
    id,
    uploadUrl,
    uploadHeaders: { "Content-Type": UPLOAD_CONTENT_TYPE },
    url,
    expiresAt: expiresAt.toISOString(),
  });
});

export default app;
