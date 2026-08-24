import type { Context } from "hono";

/**
 * `c.req.json()` は Content-Type を見ずに本文を解釈するため、
 * `<form enctype="text/plain">` によるクロスオリジン投稿が
 * CORS プリフライトなしで到達してしまう。application/json を必須にして塞ぐ。
 */
export function isJsonContentType(header: string | undefined): boolean {
  if (!header) return false;
  return header.split(";")[0].trim().toLowerCase() === "application/json";
}

/**
 * ブラウザの管理画面から来たリクエストかどうか。
 *
 * **セキュリティ制御ではなく摩擦。** 認証が無いので `curl` からの操作を
 * 本当に防ぐことはできず、`Sec-Fetch-Site` は詐称できる。ヘッダを送らない
 * `curl` / `node-fetch` を弾くことで、設定内容を理解しないまま
 * スクリプトや AI エージェントに変更されるのを防ぐのが目的。
 *
 * `Sec-Fetch-Mode` は条件に含めない。値は呼び出し側の `fetch()` の書き方に
 * 依存する（`mode: 'same-origin'` なら same-origin、既定なら cors）ため、
 * 特定の値を要求すると自分の管理画面を弾く事故になる。
 */
export function isSameOriginBrowserRequest(c: Context): boolean {
  return c.req.header("sec-fetch-site") === "same-origin";
}
