import type { SessionUser } from "./session.js";

/**
 * 削除・ヘッダ設定を許すかどうか。
 *
 * ownerEmail を持たないのは所有者の記録を始める前にアップロードされたファイル。
 * 誰のものか分からないものを誰も消せなくすると片付けられなくなるため、誰でも扱えるままにする。
 * メールアドレスの大文字小文字は同一人物でも揺れうるので無視して比べる。
 */
export function canManage(user: SessionUser, data: { ownerEmail?: string | null }): boolean {
  if (!data.ownerEmail) return true;
  return data.ownerEmail.toLowerCase() === user.email.toLowerCase();
}

/**
 * 修正版の追加を許すかどうか。
 *
 * canManage と違い、所有者の記録がないファイルは誰にも許さない。
 * 修正は他人の公開物を差し替える操作であり、持ち主不明のものを誰でも書き換えられるのは危険なため。
 */
export function canRevise(user: SessionUser, data: { ownerEmail?: string | null }): boolean {
  if (!data.ownerEmail) return false;
  return data.ownerEmail.toLowerCase() === user.email.toLowerCase();
}
