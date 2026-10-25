import type { DocumentData } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { HTML_FILES_COLLECTION } from "./files.js";
import { canRevise } from "./ownership.js";
import type { SessionUser } from "./session.js";
import { fileExists } from "./storage.js";
import { now } from "./time.js";

export const VERSIONS_SUBCOLLECTION = "versions";

export type FileVersion = {
  number: number;
  storagePath: string;
  createdAt: Date;
  /** v1 で所有者の記録がないときは null。 */
  uploader: { email: string; name: string } | null;
};

/** 最新の版番号。latestVersion を持たない（修正されていない）ファイルは 1。 */
export function latestVersionOf(data: DocumentData): number {
  const v = data.latestVersion;
  return Number.isInteger(v) && v > 0 ? v : 1;
}

/** URL の版指定を解釈する。指定なしは最新、不正または存在しない番号は null。 */
export function parseVersionParam(raw: string | undefined, latest: number): number | null {
  if (raw === undefined) return latest;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const n = Number(raw);
  return n <= latest ? n : null;
}

function versionRef(fileId: string, n: number) {
  return db
    .collection(HTML_FILES_COLLECTION)
    .doc(fileId)
    .collection(VERSIONS_SUBCOLLECTION)
    .doc(String(n));
}

function toVersion(n: number, data: DocumentData): FileVersion {
  return {
    number: n,
    storagePath: data.storagePath,
    createdAt: data.createdAt.toDate(),
    uploader: data.uploaderEmail
      ? { email: data.uploaderEmail as string, name: (data.uploaderName as string) ?? "" }
      : null,
  };
}

/** v1 は親ドキュメントに残っている情報から組み立てる（移行を要しない）。 */
function firstVersion(data: DocumentData): FileVersion {
  return toVersion(1, {
    storagePath: data.storagePath,
    createdAt: data.createdAt,
    uploaderEmail: data.ownerEmail,
    uploaderName: data.ownerName,
  });
}

export async function getVersion(
  fileId: string,
  data: DocumentData,
  n: number
): Promise<FileVersion | null> {
  if (n === 1) return firstVersion(data);
  const snap = await versionRef(fileId, n).get();
  return snap.exists ? toVersion(n, snap.data()!) : null;
}

/** v1 を先頭に、番号の昇順。 */
export async function listVersions(fileId: string, data: DocumentData): Promise<FileVersion[]> {
  const snap = await db
    .collection(HTML_FILES_COLLECTION)
    .doc(fileId)
    .collection(VERSIONS_SUBCOLLECTION)
    .get();
  const revisions = snap.docs
    .map((doc) => toVersion(Number(doc.id), doc.data()))
    .sort((a, b) => a.number - b.number);
  return [firstVersion(data), ...revisions];
}

export function isUploadId(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

export function revisionPrefix(fileId: string): string {
  return `timothy-files/${fileId}/`;
}

export function revisionStoragePath(fileId: string, uploadId: string): string {
  return `${revisionPrefix(fileId)}rev-${uploadId}.html`;
}

export type RevisionDenial = "gone" | "no_owner" | "forbidden";

/** 修正版を追加できない理由。追加できるなら null。期限切れを所有者の確認より先に見る。 */
export function revisionDenial(
  user: SessionUser,
  data: DocumentData,
  nowMs: number = Date.now()
): RevisionDenial | null {
  const expiresAt = data.expiresAt?.toDate?.() as Date | undefined;
  if (expiresAt && expiresAt.getTime() <= nowMs) return "gone";
  if (!data.ownerEmail) return "no_owner";
  if (!canRevise(user, data)) return "forbidden";
  return null;
}

export type CommitResult =
  | { ok: true; version: number }
  | { ok: false; reason: "not_found" | RevisionDenial | "content_missing" };

/**
 * アップロード済みの修正版を新しい版として確定する。
 * 同じ uploadId の再実行は同じ番号を返す（冪等）。採番は親の latestVersion を
 * トランザクションで読み書きするので、同時に確定しても番号は重複しない。
 */
export async function commitRevision(p: {
  fileId: string;
  uploadId: string;
  user: SessionUser;
}): Promise<CommitResult> {
  const { fileId, uploadId, user } = p;
  const parentRef = db.collection(HTML_FILES_COLLECTION).doc(fileId);

  const parent = await parentRef.get();
  if (!parent.exists) return { ok: false, reason: "not_found" };
  const denied = revisionDenial(user, parent.data()!);
  if (denied) return { ok: false, reason: denied };

  const storagePath = revisionStoragePath(fileId, uploadId);
  if (!(await fileExists(storagePath))) return { ok: false, reason: "content_missing" };

  return db.runTransaction(async (tx): Promise<CommitResult> => {
    // 確認から書き込みまでの間に削除・期限切れ・所有者変更が起きうるので読み直す
    const fresh = await tx.get(parentRef);
    if (!fresh.exists) return { ok: false, reason: "not_found" };
    const data = fresh.data()!;
    const denial = revisionDenial(user, data);
    if (denial) return { ok: false, reason: denial };

    const versions = parentRef.collection(VERSIONS_SUBCOLLECTION);
    const existing = await tx.get(versions.where("storagePath", "==", storagePath).limit(1));
    if (!existing.empty) return { ok: true, version: Number(existing.docs[0].id) };

    const n = latestVersionOf(data) + 1;
    tx.create(versions.doc(String(n)), {
      number: n,
      storagePath,
      createdAt: now(),
      uploaderEmail: user.email,
      uploaderName: user.name,
    });
    tx.update(parentRef, { latestVersion: n });
    return { ok: true, version: n };
  });
}
