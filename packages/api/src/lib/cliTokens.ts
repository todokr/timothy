import { createHash, randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import type { SessionUser } from "./session.js";
import { now } from "./time.js";

export const CLI_TOKENS_COLLECTION = "cliTokens";
export const CLI_TOKEN_TTL_DAYS = 90;

// 発行するトークンは 43 文字。余裕を持たせつつ、巨大なヘッダでハッシュ計算や Firestore を叩かせない上限
const MAX_TOKEN_LENGTH = 512;
// 発行するのは base64url だけなので、それ以外の文字を含むものは照合するまでもなく無効
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const BEARER_PREFIX = "Bearer ";

// Firestore が漏れても CLI として使えないよう、ドキュメント ID には平文ではなくハッシュを使う。
// トークンは 256 ビットの乱数なので、ソルトや遅いハッシュは要らない
function tokenDocId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenDoc(token: string) {
  return db.collection(CLI_TOKENS_COLLECTION).doc(tokenDocId(token));
}

/** CLI 用のトークンを発行して平文を返す。平文は保存しないので、呼び出し側が渡しそびれると二度と取り出せない */
export async function issueCliToken(user: SessionUser): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const createdAt = now();
  const expiresAt = new Date(createdAt.getTime() + CLI_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await tokenDoc(token).set({
    email: user.email,
    name: user.name,
    picture: user.picture,
    createdAt,
    expiresAt,
  });
  return token;
}

/** トークンに対応するユーザーを返す。無い・期限切れ・形が壊れているものは null */
export async function findCliTokenUser(token: string): Promise<SessionUser | null> {
  const snapshot = await tokenDoc(token).get();
  if (!snapshot.exists) return null;
  // 手作業での編集や将来のスキーマ変更で形が崩れたドキュメントを、認証済みとして通さない
  const data = snapshot.data() as Record<string, unknown> | undefined;
  if (!data) return null;
  const { email, name, picture, expiresAt } = data;
  if (typeof email !== "string" || email === "") return null;
  if (typeof name !== "string") return null;
  if (picture !== null && typeof picture !== "string") return null;
  if (!(expiresAt instanceof Timestamp)) return null;
  if (expiresAt.toMillis() <= now().getTime()) return null;
  return { email, name, picture };
}

export async function revokeCliToken(token: string): Promise<void> {
  await tokenDoc(token).delete();
}

/**
 * `Authorization: Bearer <token>` からトークンを取り出す。形が不正なら null（資格情報なしとして扱う）。
 * requireUser と DELETE /auth/cli-token の両方で使い、判定がずれないようにしている。
 */
export function readBearerToken(header: string | undefined): string | null {
  if (!header || !header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length);
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  if (!TOKEN_PATTERN.test(token)) return null;
  return token;
}
