# ログインと所有者 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** timothy の Web 画面・共有ページ・API を Google ログイン必須にし、ファイルに所有者を持たせ、削除とヘッダ設定を所有者に限る。CLI は `tim login` で同じアカウントの資格情報を持つ。

**Architecture:** API はプロセス内に状態を持たない（Cloud Run と Lambda の両対応）。ブラウザのセッションは `node:crypto` の HMAC で署名した Cookie、CLI の資格情報は API が発行するランダムなトークンを Firestore にハッシュで保存する。Google とは OIDC の認可コードフロー（PKCE 付き）でやり取りし、ID トークンはトークンエンドポイントから直接受け取るので署名検証は行わず、クレームだけを検証する（OIDC Core §3.1.3.7）。

**Tech Stack:** Hono（`hono/cookie`）、firebase-admin（Firestore）、node:crypto、vitest、commander。新しい依存は追加しない。

**Spec:** `docs/superpowers/specs/2026-10-25-html-comments-design.md`（本計画は「アカウントと権限」節と、「アップロードされた HTML の隔離」節の `allow-same-origin` 廃止を実装する）

本計画は 4 本のうちの 1 本目。後続は「版」「コメント」「MCP」で、いずれも本計画の `SessionUser` / `getUser(c)` / `canManage()` を使う。

## Global Constraints

- 許可ドメインは環境変数 `ALLOWED_EMAIL_DOMAINS`（カンマ区切り）。コードにドメインを書かない。
- `ALLOWED_EMAIL_DOMAINS`・`GOOGLE_OAUTH_CLIENT_ID`・`GOOGLE_OAUTH_CLIENT_SECRET`・`SESSION_SECRET` のどれかが未設定なら起動を拒否する。
- 判定は ID トークンの `hd` クレームと `email_verified === true`。
- ログイン不要なのは `/health` と `/auth/*` だけ。`/auth/*` にも `ipAllowlistMiddleware` はかける。
- `ALLOWED_IPS` はそのまま残し、ログインと併用する。
- 未ログイン時: `/`・`/s/*`・`/files/:id/headers/edit` は `302 /auth/login?next=<元のパスとクエリ>`。`/upload`・`/files`・`/files/*`（上記の edit 以外）は `401 {"error":"Unauthorized"}`。
- 削除・ヘッダ設定の変更は所有者のみ。`ownerEmail` を持たない既存ファイルはログインした人全員。
- 一覧は全員分を返し、所有者を含める。`?owner=me` で自分の分に絞れる。
- `allow-same-origin` と `ALLOW_UNSANDBOXED_CONTENT` を廃止する。保存済み設定に含まれていても配信時に無視する。
- サーバー側にプロセス内状態を持たない。
- コードのコメント・エラーメッセージの言語と書き方は既存ファイルに合わせる（コメントは日本語、API のエラーは英語）。

## Review Focus

1. `next` パラメータによるオープンリダイレクト（`//evil.example`、`https://evil.example`、`/\evil.example`）。安全でなければ `/` に落とす。→ Task 4
2. 版指定などのクエリがログインの往復で失われない（`/s/01ABC?v=2` で未ログイン → ログイン後に `/s/01ABC?v=2`）。→ Task 4
3. 個人 Gmail（`hd` なし）や `email_verified: false` のアカウントはドメインが合っていても拒否する。→ Task 3
4. 失効させた CLI トークン、期限切れの CLI トークンは 401。→ Task 5
5. `ownerEmail` の無い既存ファイルは誰でも削除できる。所有者のいるファイルは他人が消そうとすると 403 で、Storage も Firestore も消えない。→ Task 6

---

## File Structure

API（`packages/api/src/`）

| ファイル | 責務 |
|---|---|
| `lib/signedCookie.ts`（新規） | HMAC 署名付きの値の発行と検証（期限付き） |
| `lib/authConfig.ts`（新規） | 認証関連の環境変数の読み込みと起動時チェック |
| `lib/google.ts`（新規） | Google OIDC: 認可 URL、コード交換、ID トークンのクレーム検証 |
| `lib/session.ts`（新規） | `SessionUser` 型とセッション Cookie の読み書き |
| `lib/auth.ts`（新規） | 認証ミドルウェア、`getUser(c)`、`safeNextPath()` |
| `lib/cliTokens.ts`（新規） | CLI トークンの発行・照合・失効（Firestore） |
| `lib/ownership.ts`（新規） | 所有者判定 `canManage()` |
| `routes/auth.tsx`（新規） | `/auth/login`・`/auth/callback`・`/auth/logout`・`/auth/cli`・`/auth/cli-token` |
| `test/auth.ts`（新規） | テスト用のユーザー・セッション Cookie・`withUser()` |
| `lib/responseHeaders.ts` | `allow-same-origin` と `public` の廃止 |
| `lib/files.ts` | `FileEntry` に所有者を追加 |
| `routes/upload.ts`・`list.ts`・`delete.ts`・`headers.ts`・`web.tsx`・`webScript.ts` | 所有者の保存・絞り込み・権限チェック・表示 |
| `index.ts`・`server.ts`・`lambda.ts` | ミドルウェアの配線と起動時チェック |

CLI（`packages/cli/src/`）

| ファイル | 責務 |
|---|---|
| `lib/credentials.ts`（新規） | `~/.config/timothy/credentials.json`（0600）の読み書き |
| `commands/login.ts`・`logout.ts`（新規） | `tim login` / `tim logout` |
| `lib/api.ts` | 全リクエストに `Authorization: Bearer`、401 の案内、一覧の所有者 |
| `commands/list.ts` | `--mine` と所有者の列 |

---

### Task 1: `allow-same-origin` と `Cache-Control: public` の廃止

ログインを入れた瞬間から、同一オリジンで動く HTML は閲覧者のセッションを使え、`public` は共有キャッシュに認証済みの中身を載せうる。どちらも認証より先に塞ぐ。

**Files:**
- Modify: `packages/api/src/lib/responseHeaders.ts`
- Modify: `packages/api/src/routes/web.tsx`（ヘッダ設定画面の該当選択肢・説明）
- Modify: `.gitignore`（`.superpowers/` を追加）
- Test: `packages/api/src/lib/responseHeaders.test.ts`

**Interfaces:**
- Produces: `availableSandboxTokens(): readonly SandboxToken[]` は常に `allow-same-origin` を含まない。`CACHE_CONTROL_VALUES = ["no-store", "private"] as const`。`unsandboxedContentAllowed()` と `GATED_SANDBOX_TOKENS` は削除。

- [ ] **Step 1: 失敗するテストを書く**

```ts
it("never offers allow-same-origin, even with the old env var set", () => {
  process.env.ALLOW_UNSANDBOXED_CONTENT = "true";
  expect(availableSandboxTokens()).not.toContain("allow-same-origin");
});
it("rejects allow-same-origin in new settings", () => {
  expect(parseSettings({ sandbox: ["allow-scripts", "allow-same-origin"] }).ok).toBe(false);
});
it("drops allow-same-origin from stored settings when serving", () => {
  const { csp } = buildHeaders({ sandbox: ["allow-scripts", "allow-same-origin"] }, null);
  expect(csp).not.toContain("allow-same-origin");
});
it("rejects cacheControl public in new settings", () => {
  expect(parseSettings({ cacheControl: "public" }).ok).toBe(false);
});
it("serves stored cacheControl public as private", () => {
  const { cacheControl } = buildHeaders({ cacheControl: "public" as never }, null);
  expect(cacheControl).toMatch(/^private/);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `pnpm --filter @timothy/api test -- responseHeaders` / Expected: 上の 5 件が FAIL

- [ ] **Step 3: 実装** — `SANDBOX_TOKEN_RISK` から `allow-same-origin` を消し、`buildCsp` は保存値を `availableSandboxTokens()` で絞る（既にそうなっていれば維持）。`cacheControlValue` は保存値 `"public"` を `"private"` として扱う。ヘッダ設定画面から該当の選択肢と `ALLOW_UNSANDBOXED_CONTENT` の説明を消す。

- [ ] **Step 4: 通過を確認** — Run: `pnpm --filter @timothy/api test` / Expected: PASS（既存テストで `allow-same-origin` / `public` を期待していたものは本タスクの意図に合わせて書き換える）

- [ ] **Step 5: Commit** — `git commit -m "fix(api): allow-same-origin と Cache-Control public を廃止する"`

---

### Task 2: 署名付き Cookie と認証設定

**Files:**
- Create: `packages/api/src/lib/signedCookie.ts`、`packages/api/src/lib/authConfig.ts`
- Modify: `packages/api/vitest.config.ts`（`test.env` にテスト用の値）、`.env.example`
- Test: `packages/api/src/lib/signedCookie.test.ts`、`packages/api/src/lib/authConfig.test.ts`

**Interfaces:**
- Produces:
  - `signValue(payload: Record<string, unknown>, secret: string, ttlSeconds: number, nowMs?: number): string` — `base64url(JSON) + "." + base64url(HMAC-SHA256)`。JSON に `exp`（epoch 秒）を入れる。
  - `verifyValue<T>(token: string, secret: string, nowMs?: number): T | null` — 署名不一致・形式不正・期限切れは `null`。比較は `crypto.timingSafeEqual`。
  - `type AuthConfig = { clientId: string; clientSecret: string; sessionSecret: string; allowedDomains: string[]; publicBaseUrl: string | null }`
  - `loadAuthConfig(env?: NodeJS.ProcessEnv): AuthConfig` — 必須 4 変数のどれかが空なら、欠けている変数名を全部並べた `Error` を投げる。`ALLOWED_EMAIL_DOMAINS` は trim して空要素を捨て、小文字化する。`PUBLIC_BASE_URL` は任意（末尾 `/` を除く）。
  - `assertAuthConfig(): void` — `loadAuthConfig()` を呼ぶだけ（起動時用）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// signedCookie.test.ts
it("round-trips a payload", () => {
  const t = signValue({ email: "a@x.com" }, "s", 60, 0);
  expect(verifyValue<{ email: string }>(t, "s", 1000)?.email).toBe("a@x.com");
});
it("rejects a tampered payload", () => { /* payload 部を書き換えた token → null */ });
it("rejects a different secret", () => { expect(verifyValue(signValue({}, "s", 60), "t")).toBeNull(); });
it("rejects an expired value", () => { expect(verifyValue(signValue({}, "s", 60, 0), "s", 61_000)).toBeNull(); });
it("rejects malformed input", () => { expect(verifyValue("garbage", "s")).toBeNull(); });

// authConfig.test.ts
it("lists every missing variable", () => {
  expect(() => loadAuthConfig({})).toThrow(/ALLOWED_EMAIL_DOMAINS.*GOOGLE_OAUTH_CLIENT_ID.*GOOGLE_OAUTH_CLIENT_SECRET.*SESSION_SECRET/s);
});
it("treats a blank domain list as missing", () => {
  expect(() => loadAuthConfig({ ...full, ALLOWED_EMAIL_DOMAINS: " , " })).toThrow(/ALLOWED_EMAIL_DOMAINS/);
});
it("normalizes domains", () => {
  expect(loadAuthConfig({ ...full, ALLOWED_EMAIL_DOMAINS: " Example.com ,b.org" }).allowedDomains).toEqual(["example.com", "b.org"]);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `pnpm --filter @timothy/api test -- signedCookie authConfig` / Expected: FAIL（モジュールが無い）
- [ ] **Step 3: 実装** — 上記シグネチャ。`vitest.config.ts` の `test.env` に `GOOGLE_OAUTH_CLIENT_ID=test-client`、`GOOGLE_OAUTH_CLIENT_SECRET=test-secret`、`SESSION_SECRET=test-session-secret`、`ALLOWED_EMAIL_DOMAINS=example.com` を入れる（`vitest.integration.config.ts` にも同じ値）。`.env.example` に 5 変数（`PUBLIC_BASE_URL` は任意と注記）を追加。
- [ ] **Step 4: 通過を確認** — Run: `pnpm --filter @timothy/api test` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(api): 署名付き Cookie と認証設定の読み込みを追加"`

---

### Task 3: Google OIDC クライアント

**Files:**
- Create: `packages/api/src/lib/google.ts`
- Test: `packages/api/src/lib/google.test.ts`

**Interfaces:**
- Consumes: `AuthConfig`（Task 2）
- Produces:
  - `type IdClaims = { iss: string; aud: string; exp: number; email: string; email_verified: boolean; hd?: string; name?: string; picture?: string }`
  - `buildAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string; codeChallenge: string; hostedDomain: string | null }): string` — `https://accounts.google.com/o/oauth2/v2/auth`、`response_type=code`、`scope=openid email profile`、`code_challenge_method=S256`。`hostedDomain` は許可ドメインが 1 つのときだけ `hd` に入れる（ログイン画面の候補を絞るためで、判定には使わない）。
  - `createPkcePair(): { verifier: string; challenge: string }`
  - `exchangeCode(p: { code: string; codeVerifier: string; redirectUri: string; config: AuthConfig; fetchFn?: typeof fetch }): Promise<string>` — `https://oauth2.googleapis.com/token` に POST し `id_token` を返す。200 以外・`id_token` 欠落は `Error`。
  - `parseIdTokenClaims(idToken: string, clientId: string, nowMs?: number): IdClaims` — ペイロードを base64url デコード。`iss` が `https://accounts.google.com` か `accounts.google.com`、`aud === clientId`、`exp` が未来であることを確認し、違えば `Error`。
  - `isAllowedAccount(claims: IdClaims, allowedDomains: string[]): boolean` — `email_verified === true` かつ `hd`（小文字化）が許可ドメインに含まれ、かつ `email` のドメイン部も一致する。

- [ ] **Step 1: 失敗するテストを書く**

```ts
const base = { iss: "https://accounts.google.com", aud: "cid", exp: 2_000_000_000, email: "a@example.com", email_verified: true, hd: "example.com" };
const token = (c: object) => `h.${Buffer.from(JSON.stringify(c)).toString("base64url")}.s`;

it("accepts a verified account in an allowed domain", () => {
  expect(isAllowedAccount(parseIdTokenClaims(token(base), "cid", 0), ["example.com"])).toBe(true);
});
it("rejects a personal Gmail account (no hd)", () => {
  const { hd, ...gmail } = { ...base, email: "a@gmail.com" };
  expect(isAllowedAccount(gmail as IdClaims, ["gmail.com"])).toBe(false);
});
it("rejects an unverified email", () => {
  expect(isAllowedAccount({ ...base, email_verified: false }, ["example.com"])).toBe(false);
});
it("rejects another domain", () => {
  expect(isAllowedAccount({ ...base, hd: "other.com", email: "a@other.com" }, ["example.com"])).toBe(false);
});
it("rejects a wrong audience", () => { expect(() => parseIdTokenClaims(token({ ...base, aud: "x" }), "cid", 0)).toThrow(); });
it("rejects an expired token", () => { expect(() => parseIdTokenClaims(token(base), "cid", 2_000_000_001_000)).toThrow(); });
it("rejects a foreign issuer", () => { expect(() => parseIdTokenClaims(token({ ...base, iss: "https://evil" }), "cid", 0)).toThrow(); });
it("returns id_token from the token endpoint", async () => {
  const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id_token: "abc" })));
  expect(await exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "r", config, fetchFn })).toBe("abc");
  // 送信本文に client_secret / code_verifier / grant_type=authorization_code が入っていること
});
it("throws when the token endpoint fails", async () => { /* 400 応答 → reject */ });
```

- [ ] **Step 2: 失敗を確認** — Run: `pnpm --filter @timothy/api test -- google` / Expected: FAIL
- [ ] **Step 3: 実装** — 上記シグネチャ。`createPkcePair` は 32 バイト乱数の base64url と、その SHA-256 の base64url。
- [ ] **Step 4: 通過を確認** — Run: 同上 / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(api): Google OIDC のコード交換とクレーム検証を追加"`

---

### Task 4: セッション、認証ミドルウェア、ブラウザのログイン

**Files:**
- Create: `packages/api/src/lib/session.ts`、`packages/api/src/lib/auth.ts`、`packages/api/src/routes/auth.tsx`、`packages/api/src/test/auth.ts`
- Modify: `packages/api/src/index.ts`、`packages/api/src/server.ts`、`packages/api/src/lambda.ts`
- Modify（認証を通すための修正のみ）: `packages/api/src/index.test.ts`、`routes/*.test.ts` のうちアプリ全体を叩くもの
- Test: `packages/api/src/lib/auth.test.ts`、`packages/api/src/routes/auth.test.ts`

**Interfaces:**
- Consumes: Task 2・3 の全関数
- Produces:
  - `type SessionUser = { email: string; name: string; picture: string | null }`（後続計画のコメント表示が `name`・`picture` を使う）
  - `SESSION_COOKIE = "tim_session"`、`SESSION_TTL_SECONDS = 7 * 24 * 60 * 60`
  - `setSessionCookie(c: Context, user: SessionUser, config: AuthConfig): void` — `HttpOnly; SameSite=Lax; Path=/`、`Secure` はリクエストの proto が https のときだけ
  - `readSessionCookie(c: Context, config: AuthConfig): SessionUser | null`、`clearSessionCookie(c: Context): void`
  - `type AppEnv = { Variables: { user: SessionUser } }`
  - `requireUser(onMissing: "redirect" | "json"): MiddlewareHandler<AppEnv>` — 既に `user` がセットされていれば何もしない（同じパスに 2 つ重なっても安全にするため）。Cookie → `Authorization: Bearer`（Task 5 で追加）の順に探す。
  - `getUser(c: Context<AppEnv>): SessionUser`
  - `safeNextPath(next: string | undefined): string` — `/` で始まり、`//` と `/\` で始まらないものだけ通す。それ以外は `"/"`。
  - `redirectUri(c: Context, config: AuthConfig): string` — `config.publicBaseUrl ?? resolveBaseUrl(c)` + `/auth/callback`
  - テスト用: `TEST_USER: SessionUser`、`sessionCookieHeader(user?: SessionUser): string`（`"tim_session=<署名値>"`）、`withUser<E>(sub: Hono<AppEnv>, user?: SessionUser): Hono` — `user` をセットしてから `sub` に渡すラッパー

ルート:
- `GET /auth/login?next=` — PKCE と `state` を作り、`{ state, verifier, next }` を `signValue` で 10 分の `tim_oauth` Cookie に入れて Google へ 302
- `GET /auth/callback?code=&state=` — `tim_oauth` を検証し `state` を照合、コードを交換、`isAllowedAccount` で判定。通れば `setSessionCookie` して `safeNextPath(next)` へ 302。ドメイン外・未検証は 403 の HTML（「このアカウントではログインできません」とログアウトのリンク）。`state` 不一致・Cookie 無しは 400。
- `POST /auth/logout` — `clearSessionCookie` して `/` へ 302（ログアウト後は Google ログインへ戻るだけなので、ページ側には「ログアウト」ボタンだけ置く）

配線（`index.ts`、順序が意味を持つのでこの順で書く）:

```ts
app.use("/auth/*", ipAllowlistMiddleware);
app.use("/", requireUser("redirect"));
app.use("/s/*", requireUser("redirect"));
app.use("/files/:id/headers/edit", requireUser("redirect"));  // /files/* の json より先
app.use("/upload", requireUser("json"));
app.use("/files", requireUser("json"));
app.use("/files/*", requireUser("json"));
app.route("/auth", authRoute);
```

起動時チェック: `server.ts` と `lambda.ts` の先頭で `assertAuthConfig()` を呼ぶ（`index.ts` はテストから import されるので入れない）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// lib/auth.test.ts
it.each(["/s/01ABC?v=2", "/", "/files/01ABC/headers/edit"])("keeps a safe path %s", (p) => {
  expect(safeNextPath(p)).toBe(p);
});
it.each(["//evil.example", "/\\evil.example", "https://evil.example", "evil", "", undefined])("falls back to / for %s", (p) => {
  expect(safeNextPath(p as string | undefined)).toBe("/");
});

// index.test.ts に追加
it("redirects an anonymous browser on /s/:id to login, keeping the query", async () => {
  const res = await app.request("/s/01ABC?v=2");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/auth/login?next=%2Fs%2F01ABC%3Fv%3D2");
});
it("redirects the header edit page rather than returning JSON", async () => {
  expect((await app.request("/files/01ABC/headers/edit")).status).toBe(302);
});
it.each([["/files", "GET"], ["/upload", "POST"], ["/files/01ABC", "DELETE"], ["/files/01ABC/headers", "PUT"]])(
  "returns 401 JSON for anonymous %s %s", async (path, method) => {
    const res = await app.request(path, { method });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
it("keeps /health open", async () => { expect((await app.request("/health")).status).toBe(200); });
it("applies the IP allowlist to /auth/*", async () => { /* 既存の allowlist describe に /auth/login を追加し 403 */ });
it("rejects a session cookie signed with another secret", async () => { /* 401 */ });

// routes/auth.test.ts（exchangeCode をモック）
it("login sets tim_oauth and redirects to Google with PKCE", async () => { /* location が accounts.google.com、code_challenge_method=S256 */ });
it("callback signs in an allowed account and returns to next", async () => {
  // tim_oauth を next=/s/01ABC?v=2 で用意 → 302 /s/01ABC?v=2、Set-Cookie に tim_session
});
it("callback refuses an account outside the allowed domains with 403", async () => { /* Set-Cookie に tim_session が無い */ });
it("callback rejects a state mismatch with 400", async () => {});
it("logout clears the session", async () => { /* Set-Cookie: tim_session=; Max-Age=0 */ });
```

- [ ] **Step 2: 失敗を確認** — Run: `pnpm --filter @timothy/api test` / Expected: 新規テストが FAIL
- [ ] **Step 3: 実装** — 上記インターフェースと配線。`/auth/callback` の 403 ページは `web.tsx` の `Layout` を再利用できるよう `Layout` を export する。
- [ ] **Step 4: 既存テストを認証付きに直す** — `index.test.ts` の「without ALLOWED_IPS」など、成功を期待するリクエストに `cookie: sessionCookieHeader()` を付ける。サブアプリ単体のテストは変更不要（ミドルウェアは `index.ts` にあるため）。
- [ ] **Step 5: 通過を確認** — Run: `pnpm --filter @timothy/api test && pnpm --filter @timothy/api test:coverage` / Expected: PASS、カバレッジ閾値を満たす
- [ ] **Step 6: Commit** — `git commit -m "feat(api): Google ログインと認証ミドルウェアを追加"`

---

### Task 5: CLI トークン（発行・照合・失効）

**Files:**
- Create: `packages/api/src/lib/cliTokens.ts`
- Modify: `packages/api/src/lib/auth.ts`（Bearer の受け付け）、`packages/api/src/routes/auth.tsx`
- Test: `packages/api/src/lib/cliTokens.test.ts`、`packages/api/src/routes/auth.test.ts`

**Interfaces:**
- Consumes: `SessionUser`、`requireUser`、`readSessionCookie`（Task 4）
- Produces:
  - `CLI_TOKENS_COLLECTION = "cliTokens"`、`CLI_TOKEN_TTL_DAYS = 90`
  - `issueCliToken(user: SessionUser): Promise<string>` — 32 バイト乱数の base64url を返す。Firestore にはドキュメント ID を SHA-256（hex）にして `{ email, name, picture, createdAt, expiresAt }` を保存。平文は保存しない。
  - `findCliTokenUser(token: string): Promise<SessionUser | null>` — 無い・期限切れは `null`
  - `revokeCliToken(token: string): Promise<void>`

ルート:
- `GET /auth/cli?port=&state=` — ブラウザのセッション必須（無ければ `/auth/login?next=` へ）。`port` は 1024〜65535 の整数、`state` は 16〜128 文字の `[A-Za-z0-9_-]`。不正なら 400。「`<email>` として CLI にログインします」と `POST` ボタンだけのページを返す（ログイン済みユーザーを踏ませてトークンを発行させる攻撃を防ぐため、GET では発行しない）。
- `POST /auth/cli` — フォームの `port`・`state` を再検証し、`Sec-Fetch-Site: same-origin` を要求（`isSameOriginBrowserRequest`）。`issueCliToken` して `http://127.0.0.1:<port>/callback?token=<token>&state=<state>` へ 302。
- `DELETE /auth/cli-token` — Bearer 必須。そのトークンを失効させて 204。

- [ ] **Step 1: 失敗するテストを書く**

```ts
it("accepts a valid bearer token on /files", async () => { /* findCliTokenUser をモック → 200 */ });
it("returns 401 for a revoked token", async () => { /* findCliTokenUser → null → 401 */ });
it("treats an expired token as missing", async () => { /* expiresAt が過去のドキュメント → findCliTokenUser が null */ });
it("stores only the hash", async () => { /* set に渡された doc id が token と異なり、data に token が含まれない */ });
it("GET /auth/cli shows a confirmation page and issues nothing", async () => { /* issueCliToken 未呼び出し */ });
it("GET /auth/cli rejects an out-of-range port", async () => { /* port=80 → 400 */ });
it("POST /auth/cli redirects to the loopback with token and state", async () => {
  // location が http://127.0.0.1:53682/callback?token=...&state=abc...
});
it("POST /auth/cli refuses a cross-site request", async () => { /* sec-fetch-site: cross-site → 403 */ });
it("DELETE /auth/cli-token revokes the presented token", async () => {});
```

- [ ] **Step 2: 失敗を確認** — Run: `pnpm --filter @timothy/api test -- cliTokens auth` / Expected: FAIL
- [ ] **Step 3: 実装** — `requireUser` は Cookie が無ければ `authorization` ヘッダの `Bearer ` を `findCliTokenUser` で照合する。`/auth/cli-token` は `/auth/*` にあり `requireUser` が掛からないので、ルート内で同じ照合をする。
- [ ] **Step 4: 通過を確認** — Run: `pnpm --filter @timothy/api test` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(api): CLI 用トークンの発行と Bearer 認証を追加"`

---

### Task 6: 所有者の保存、一覧、削除・ヘッダ設定の権限

**Files:**
- Create: `packages/api/src/lib/ownership.ts`
- Modify: `packages/api/src/lib/files.ts`、`routes/upload.ts`、`routes/list.ts`、`routes/delete.ts`、`routes/headers.ts`、`routes/web.tsx`、`routes/webScript.ts`、`routes/webStyles.ts`
- Test: `lib/ownership.test.ts`、`routes/upload.test.ts`、`routes/delete.test.ts`、`routes/headers.test.ts`、`routes/web.test.ts`、`index.test.ts`（一覧）

**Interfaces:**
- Consumes: `AppEnv`、`getUser`、`withUser`、`TEST_USER`（Task 4）
- Produces:
  - Firestore `htmlFiles` に `ownerEmail: string`、`ownerName: string` を追加（新規アップロード時のみ。既存は欠落のまま）
  - `FileEntry` に `owner: { email: string; name: string } | null` を追加
  - `listFiles(baseUrl: string, opts?: { ownerEmail?: string }): Promise<FileEntry[]>` — 絞り込みはメモリ上で行う（複合インデックスを増やさないため）
  - `canManage(user: SessionUser, data: { ownerEmail?: string | null }): boolean` — `ownerEmail` が無ければ `true`、あれば一致（大文字小文字を無視）
  - `GET /files?owner=me`、`GET /?mine=1`
  - 所有者でない削除・ヘッダ変更は `403 {"error":"Forbidden"}`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// ownership.test.ts
it("lets anyone manage a legacy file without an owner", () => { expect(canManage(TEST_USER, {})).toBe(true); });
it("lets the owner manage, ignoring case", () => { expect(canManage(TEST_USER, { ownerEmail: TEST_USER.email.toUpperCase() })).toBe(true); });
it("refuses someone else", () => { expect(canManage(TEST_USER, { ownerEmail: "other@example.com" })).toBe(false); });

// upload.test.ts
it("records the uploader as owner", async () => { /* set に ownerEmail / ownerName が入る */ });

// delete.test.ts（withUser(app) 経由に切り替え）
it("refuses to delete someone else's file and touches nothing", async () => {
  // ownerEmail: other@example.com → 403、deleteFile も docRef.delete も呼ばれない
});
it("deletes a legacy file without an owner", async () => { /* 200 */ });

// headers.test.ts
it("refuses to change headers of someone else's file", async () => { /* 403、update 未呼び出し */ });

// list（index.test.ts か list のテスト）
it("returns everyone's files with owners", async () => {});
it("filters to the caller's files with ?owner=me", async () => {});

// web.test.ts
it("shows the owner column and hides delete / header buttons on others' files", async () => {});
it("shows only the caller's files with ?mine=1", async () => {});
```

- [ ] **Step 2: 失敗を確認** — Run: `pnpm --filter @timothy/api test` / Expected: 新規テストが FAIL
- [ ] **Step 3: 実装** — 権限チェックは `delete.ts` ではドキュメント取得直後・Storage 削除より前、`headers.ts` では `isSameOriginBrowserRequest` の後に置く。`headers.ts` のログに `actor: user.email` を足す（「誰が」を残せなかった旧コメントは更新する）。Web 一覧は所有者の列と「自分のファイルだけ」のリンク（`?mine=1` の切り替え）、右上にログイン中のメールアドレスとログアウトボタン。
- [ ] **Step 4: 通過を確認** — Run: `pnpm --filter @timothy/api test && pnpm --filter @timothy/api test:coverage` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(api): ファイルの所有者を記録し、削除とヘッダ設定を所有者に限る"`

---

### Task 7: CLI の `tim login` / `tim logout` と認証付きリクエスト

**Files:**
- Create: `packages/cli/src/lib/credentials.ts`、`packages/cli/src/commands/login.ts`、`packages/cli/src/commands/logout.ts`
- Modify: `packages/cli/src/lib/api.ts`、`packages/cli/src/commands/list.ts`・`upload.ts`・`delete.ts`、`packages/cli/src/index.ts`
- Modify: `README.md`、`packages/cli/README.md`、`packages/api/README.md`
- Test: `packages/cli/src/lib/credentials.test.ts`、`packages/cli/src/commands/login.test.ts`、`packages/cli/src/lib/api.test.ts`

**Interfaces:**
- Consumes: API の `GET /auth/cli`・`DELETE /auth/cli-token`・`GET /files?owner=me`・`FileEntry.owner`（Task 5・6）
- Produces:
  - `readCredentials(): Promise<{ token: string } | null>`、`writeCredentials(c: { token: string }): Promise<void>`（ファイルモード 0600）、`deleteCredentials(): Promise<void>` — パスは `~/.config/timothy/credentials.json`（`config.json` とは分ける）
  - `startLoopback(state: string, timeoutMs?: number): Promise<{ port: number; token: Promise<string> }>` — `127.0.0.1` の空きポートで待ち受け、`/callback` の `state` が一致したら `token` を解決し、ブラウザに「ログインしました。このタブは閉じて構いません」を返す。不一致は 400 で無視して待ち続ける。既定のタイムアウトは 5 分。
  - `api.ts` の全関数は `Authorization: Bearer <token>` を付ける。資格情報が無い、または 401 のときは `Error("Not logged in. Run \`tim login\`.")`
  - `apiList(config, opts?: { mine?: boolean })`、`FileEntry.owner`
  - `tim login` — `startLoopback` → ブラウザで `${apiEndpoint}/auth/cli?port=&state=` を開く（macOS は `open`、Linux は `xdg-open`、Windows は `start`。開けなければ URL を表示）→ トークンを保存して「✓ Logged in」
  - `tim logout` — `DELETE /auth/cli-token`（失敗しても続行）→ 資格情報を削除
  - `tim list --mine`、一覧に OWNER の列（所有者なしは `-`）

- [ ] **Step 1: 失敗するテストを書く**

```ts
// credentials.test.ts（HOME を一時ディレクトリに向ける）
it("writes credentials with mode 0600", async () => { /* stat の mode & 0o777 === 0o600 */ });
it("returns null when no credentials exist", async () => {});

// login.test.ts
it("resolves the token when the callback carries the right state", async () => {
  const { port, token } = await startLoopback("s".repeat(32));
  await fetch(`http://127.0.0.1:${port}/callback?token=abc&state=${"s".repeat(32)}`);
  expect(await token).toBe("abc");
});
it("ignores a callback with the wrong state", async () => { /* 400、token は未解決のまま */ });
it("times out", async () => { /* timeoutMs: 50 → reject */ });

// api.test.ts（fetch をモック）
it("sends the bearer token", async () => {});
it("turns a 401 into a login hint", async () => { await expect(apiList(config)).rejects.toThrow(/tim login/); });
it("passes owner=me for --mine", async () => {});
```

- [ ] **Step 2: 失敗を確認** — Run: `pnpm --filter timothy-cli test` / Expected: FAIL
- [ ] **Step 3: 実装** — 上記インターフェース。README は「必要なもの」に Google ログインと `tim login` を、「セルフホスティング」に OAuth クライアントの作り方（承認済みリダイレクト URI に `<公開 URL>/auth/callback`）と 5 つの環境変数を、`ALLOW_UNSANDBOXED_CONTENT` と `allow-same-origin` の記述の削除を反映する。`packages/api/README.md` の「API にアプリケーションレベルの認証はない」注意書きを書き換える。
- [ ] **Step 4: 通過を確認** — Run: `pnpm test && pnpm lint` / Expected: PASS
- [ ] **Step 5: 手で通しを確認** — Firebase エミュレータと `pnpm dev:api` を起動し（OAuth クライアントは開発用のものを `.env` に設定）、ブラウザでログイン → 一覧 → アップロード → `tim login` → `tim list --mine` → `tim logout` → `tim list` が「tim login」を案内することを確認する
- [ ] **Step 6: Commit** — `git commit -m "feat(cli): tim login / logout を追加し、API 呼び出しを認証付きにする"`
