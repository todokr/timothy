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
 * 2 つの役割がある。
 * - `POST /auth/cli` では CSRF の関門。ブラウザは `Sec-Fetch-Site` を他サイトから
 *   詐称できないため、別サイトのフォームから CLI トークンを発行させる攻撃を止められる。
 * - 管理画面の API では、ヘッダを送らない `curl` / `node-fetch` を弾く摩擦。
 *   設定内容を理解しないままスクリプトや AI エージェントに変更されるのを防ぐ。
 *
 * ブラウザ以外のクライアントは `Sec-Fetch-Site` を自由に詐称できるため、
 * これだけで非ブラウザからの操作を防ぐことはできない。認証は別途 requireUser が担う。
 *
 * `Sec-Fetch-Mode` は条件に含めない。値は呼び出し側の `fetch()` の書き方に
 * 依存する（`mode: 'same-origin'` なら same-origin、既定なら cors）ため、
 * 特定の値を要求すると自分の管理画面を弾く事故になる。
 */
export function isSameOriginBrowserRequest(c: Context): boolean {
  return c.req.header("sec-fetch-site") === "same-origin";
}
