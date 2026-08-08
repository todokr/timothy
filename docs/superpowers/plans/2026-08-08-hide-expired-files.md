# ページ名変更と期限切れファイルの非表示 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理画面の表示名を `Timothy` から `Tim` に変え、一覧から有効期限を過ぎたファイルを除く。

**Architecture:** 表示だけを変える。レコードも Cloud Storage のオブジェクトも削除せず、`GET /files` の JSON も変えないので CLI の挙動は据え置き。期限切れの絞り込みは `web.tsx` のルートハンドラで行い、`FileTable` は受け取ったものをそのまま描画する純粋な描画コンポーネントに戻す。

**Tech Stack:** Hono 4 / hono/jsx / hono/css / TypeScript 6 (NodeNext) / vitest 4

## Global Constraints

- 設計書: `docs/superpowers/specs/2026-08-08-hide-expired-files-design.md`。矛盾があれば設計書が優先。
- 作業ブランチは `feature/web-ui`。すでにチェックアウト済み。
- TypeScript は `strict: true`、モジュールは `NodeNext`。**相対 import は必ず `.js` 拡張子を付ける**（`.tsx` を import する場合も `.js`）。
- テストファイル名は必ず `*.test.ts`。vitest の `include` が `src/**/*.test.ts` のため `.test.tsx` は実行されない。テストコード内で JSX は書かない。
- **DOM の要素 ID と、`data-delete-id` `data-copy-url` `data-row-error` `data-dragging` を変更してはならない。** `webScript.ts` のクライアント JS が参照している。
- **`packages/api/src/routes/webScript.ts` は変更しない。**
- **`packages/api/src/lib/files.ts` と `packages/api/src/routes/list.ts` は変更しない。** `GET /files` の JSON を変えると CLI が壊れる。
- UI の文言はすべて日本語。「まだファイルがありません」「有効期限内のファイルがありません」は設計書の表記どおりに使う。
- リポジトリ名、npm パッケージ名（`timothy-cli`）、README の製品名は変更しない。変えるのは管理画面の表示のみ。
- コマンドはリポジトリルートから実行する。ビルド `pnpm --filter @timothy/api run build`、テスト `pnpm --filter @timothy/api run test`、lint `pnpm lint`。3 つとも成功する状態を保つこと。
- **`.secretlintrc.json` などのセキュリティ設定を作成・変更してはならない。** コミットがフックに阻まれた場合は、設定を弱めるのではなく停止して報告すること。
- 着手前の全テスト件数は **98 件**（7 ファイル）。うち `packages/api/src/routes/web.test.ts` が 28 件。
- 着手前の `packages/api/src/routes/webStyles.ts` のエクスポートは **16 個**。

---

### Task 1: 管理画面の表示名を `Tim` にする

`web.tsx` に `Timothy` は 3 箇所ある。ブラウザのタブに出る `<title>`、成功時の `<h1>`、500 ページの `<h1>`。3 箇所とも `Tim` にする。

**Files:**
- Modify: `packages/api/src/routes/web.tsx`
- Modify: `packages/api/src/routes/web.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: なし（表示文字列のみ）

- [ ] **Step 1: 失敗するテストを書く**

Append to the `describe("GET /", ...)` block in `packages/api/src/routes/web.test.ts`:

```ts
  it("calls the page Tim, not Timothy", async () => {
    vi.mocked(listFiles).mockResolvedValue([]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("<title>Tim</title>");
    expect(html).toContain(">Tim</h1>");
    expect(html).not.toContain("Timothy");
  });

  it("calls the error page Tim too", async () => {
    vi.mocked(listFiles).mockRejectedValue(new Error("Firestore is down"));
    const html = await (await app.request("/")).text();
    expect(html).toContain("<title>Tim</title>");
    expect(html).toContain(">Tim</h1>");
    expect(html).not.toContain("Timothy");
  });
```

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `pnpm --filter @timothy/api run test src/routes/web.test.ts`

Expected: FAIL 2 件。どちらも `<title>Timothy</title>` のままなので `toContain("<title>Tim</title>")` で落ちる。

- [ ] **Step 3: 3 箇所を書き換える**

`packages/api/src/routes/web.tsx` の 54 行目付近:

```tsx
          <title>Tim</title>
```

171 行目付近（500 ページの分岐）と 180 行目付近（成功時）の 2 箇所:

```tsx
      <h1 class={headerClass}>Tim</h1>
```

- [ ] **Step 4: テストを実行して成功することを確認する**

Run: `pnpm --filter @timothy/api run test src/routes/web.test.ts`

Expected: PASS（30 件）

- [ ] **Step 5: `Timothy` が残っていないことを確認する**

Run: `grep -n "Timothy" packages/api/src/routes/web.tsx`

Expected: 1 件も出ない。

- [ ] **Step 6: ビルド・全テスト・lint を確認する**

Run: `pnpm --filter @timothy/api run build && pnpm --filter @timothy/api run test && pnpm lint`

Expected: すべて成功（100 件）

- [ ] **Step 7: コミット**

```bash
git add packages/api/src/routes/web.tsx packages/api/src/routes/web.test.ts
git commit -m "feat(api): rename the web UI page from Timothy to Tim"
```

---

### Task 2: 期限切れを一覧から除き、空状態の文言を分ける

ルートハンドラで期限切れを絞り、`FileTable` を純粋な描画コンポーネントに戻す。あわせて空状態の文言を状況で分ける。

**Files:**
- Modify: `packages/api/src/routes/web.tsx`
- Modify: `packages/api/src/routes/web.test.ts`

**Interfaces:**
- Consumes: `isExpired(iso: string, nowMs: number): boolean`（`web.tsx` 内の既存関数、変更しない）
- Produces: `FileTable` の props が `{ files: FileEntry[]; emptyMessage: string }` になる。`nowMs` は無くなる。

- [ ] **Step 1: 差し替えるテストを書き換える**

`packages/api/src/routes/web.test.ts` の 2 件を**置き換える**。

`it("marks expired files with a badge", ...)` を次に差し替える:

```ts
  it("hides expired files from the list", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry({ id: "01OLD", title: "Expired Report", expiresAt: "2000-01-01T00:00:00.000Z" }),
    ]);
    const html = await (await app.request("/")).text();
    expect(html).not.toContain("Expired Report");
    expect(html).not.toContain('data-delete-id="01OLD"');
  });
```

`it("does not mark live files as expired", ...)` を次に差し替える:

```ts
  it("keeps live files and drops only the expired ones", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry({ id: "01LIVE", title: "Live Report", expiresAt: "2099-01-01T00:00:00.000Z" }),
      entry({ id: "01OLD", title: "Expired Report", expiresAt: "2000-01-01T00:00:00.000Z" }),
    ]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("Live Report");
    expect(html).toContain('data-delete-id="01LIVE"');
    expect(html).not.toContain("Expired Report");
    expect(html).not.toContain('data-delete-id="01OLD"');
  });
```

続けて `describe("GET /", ...)` の中に 1 件追加する:

```ts
  // 全件が期限切れのときに「まだファイルがありません」を出すと、
  // 昨日アップロードした利用者がデータを失ったと誤解する。
  it("distinguishes an empty collection from an all-expired one", async () => {
    vi.mocked(listFiles).mockResolvedValue([
      entry({ id: "01OLD", expiresAt: "2000-01-01T00:00:00.000Z" }),
    ]);
    const html = await (await app.request("/")).text();
    expect(html).toContain("有効期限内のファイルがありません");
    expect(html).not.toContain("まだファイルがありません");
  });
```

既存の `it("renders the empty state when there are no files", ...)` は**そのまま残す**。`listFiles` が 0 件のときは引き続き「まだファイルがありません」が出る。

- [ ] **Step 2: テストを実行して失敗することを確認する**

Run: `pnpm --filter @timothy/api run test src/routes/web.test.ts`

Expected: FAIL 3 件。現状は期限切れも描画され、全件期限切れでもテーブルが出る。

- [ ] **Step 3: `FileTable` から期限切れの扱いを外す**

`packages/api/src/routes/web.tsx` の `FileTable` を次に差し替える。変更点は (a) props から `nowMs` を外して `emptyMessage` を受け取る、(b) 空状態の文言を props から出す、(c) `expired` の算出・`data-expired` 属性・「期限切れ」バッジを削除する:

```tsx
function FileTable(props: { files: FileEntry[]; emptyMessage: string }) {
  if (props.files.length === 0) {
    return (
      <div class={emptyClass}>
        <p>{props.emptyMessage}</p>
      </div>
    );
  }

  return (
    <div class={tableWrapClass}>
      <table class={tableClass}>
        <thead>
          <tr>
            <th>タイトル</th>
            <th>説明</th>
            <th>共有</th>
            <th>有効期限</th>
            <th>作成日時</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {props.files.map((file) => (
            <tr key={file.id}>
              <td>{file.title}</td>
              <td>{file.description}</td>
              <td>
                <div class={shareCellClass}>
                  <a
                    class={ghostButtonClass}
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    開く
                  </a>
                  <button type="button" class={ghostButtonClass} data-copy-url={file.url}>
                    URL をコピー
                  </button>
                </div>
              </td>
              <td>{formatJst(file.expiresAt)}</td>
              <td>{formatJst(file.createdAt)}</td>
              <td>
                <button type="button" class={dangerButtonClass} data-delete-id={file.id}>
                  削除
                </button>
                <span class={rowErrorClass} data-row-error></span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`badgeClass` を使う箇所が無くなるので、`webStyles.js` からの import 一覧からも `badgeClass` を外す。

- [ ] **Step 4: ルートハンドラでフィルタして文言を決める**

`packages/api/src/routes/web.tsx` の `app.get("/")` の成功側を次に差し替える:

```tsx
  const nowMs = Date.now();
  const live = files.filter((file) => !isExpired(file.expiresAt, nowMs));

  // 取得は出来たが全件期限切れ、という状態を「まだファイルがありません」と
  // 表示するとデータが消えたように読めるため、文言を分ける。
  const emptyMessage =
    files.length === 0 ? "まだファイルがありません" : "有効期限内のファイルがありません";

  return c.html(
    <Layout withScript>
      <h1 class={headerClass}>Tim</h1>
      <UploadForm />
      <FileTable files={live} emptyMessage={emptyMessage} />
    </Layout>
  );
```

500 側の分岐は変更しない。

- [ ] **Step 5: テストを実行して成功することを確認する**

Run: `pnpm --filter @timothy/api run test src/routes/web.test.ts`

Expected: PASS（31 件）

- [ ] **Step 6: ビルド・全テスト・lint を確認する**

Run: `pnpm --filter @timothy/api run build && pnpm --filter @timothy/api run test && pnpm lint`

Expected: すべて成功（101 件）。`badgeClass` の import を外し忘れると lint か tsc が未使用で落ちる。

- [ ] **Step 7: コミット**

```bash
git add packages/api/src/routes/web.tsx packages/api/src/routes/web.test.ts
git commit -m "feat(api): hide expired files from the web UI list"
```

---

### Task 3: 使われなくなったスタイルを削除する

期限切れの行が描画されなくなったので、その表示のためだけにあるスタイルを消す。

**Files:**
- Modify: `packages/api/src/routes/webStyles.ts`

**Interfaces:**
- Consumes: なし
- Produces: `webStyles.ts` のエクスポートが 16 個から 15 個になる（`badgeClass` が消える）。

- [ ] **Step 1: `badgeClass` を削除する**

`packages/api/src/routes/webStyles.ts` から `export const badgeClass = css\`...\`;` の定義を丸ごと削除する。154 行目付近にある。

- [ ] **Step 2: `tableClass` から期限切れの淡色指定を削除する**

`packages/api/src/routes/webStyles.ts` の `tableClass` から次のブロックを削除する。コメント行も一緒に消すこと:

```
  /* 期限切れは日時だけ淡くする。タイトルと説明は読めるまま残す。 */
  tr[data-expired="true"] td:nth-child(4),
  tr[data-expired="true"] td:nth-child(5) {
    color: var(--gray-500);
  }
```

`td:nth-child(4), td:nth-child(5)` に `font-variant-numeric: tabular-nums` と `color: var(--gray-700)` を当てているブロックは**残す**。日時の桁揃えは期限切れとは無関係。

- [ ] **Step 3: 参照が残っていないことを確認する**

Run:

```bash
grep -rn "badgeClass\|data-expired" packages/api/src/
```

Expected: 1 件も出ない。出た場合は消し忘れ。

- [ ] **Step 4: エクスポート数を確認する**

Run: `grep -c "^export const" packages/api/src/routes/webStyles.ts`

Expected: `15`

- [ ] **Step 5: ビルド・全テスト・lint を確認する**

Run: `pnpm --filter @timothy/api run build && pnpm --filter @timothy/api run test && pnpm lint`

Expected: すべて成功（101 件）

- [ ] **Step 6: コミット**

```bash
git add packages/api/src/routes/webStyles.ts
git commit -m "refactor(api): drop the expired-row badge and its styling"
```

---

### Task 4: 実画面で確認する

自動テストは構造しか見ていないので、実際に描画して確認する。コードの変更は原則不要。崩れが見つかった場合のみ調整する。

**Files:**
- Modify: `packages/api/src/routes/webStyles.ts` または `packages/api/src/routes/web.tsx`（崩れが見つかった場合のみ）

**Interfaces:**
- Consumes: Task 1〜3 の全成果
- Produces: なし

- [ ] **Step 1: Firebase エミュレータを起動する**

バックグラウンドで実行し、`All emulators ready` が出るまで待つ:

```bash
PATH="/opt/homebrew/opt/openjdk/bin:$PATH" npx -y firebase-tools emulators:start --only firestore,storage --project demo-test
```

Java は PATH に無いが `/opt/homebrew/opt/openjdk/bin` に入っている。`firebase` CLI は未インストールなので `npx` で取得する。

- [ ] **Step 2: 確認用データを投入する**

次を `/private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/seed-hide.mts` に書く。拡張子は `.mts` にすること（このディレクトリに `package.json` が無く、`.ts` だと tsx が CJS 扱いしてトップレベル `await` が使えない）:

```ts
import { db } from "/Users/shunsuke.tadokoro/work/timothy-cli/packages/api/src/lib/firebase.js";

const days = (n: number) => new Date(Date.now() + n * 86400000);

const fixtures = [
  { id: "01LIVE1", title: "月次レポート", description: "2026 年 7 月の集計結果", expiresAt: days(7), createdAt: days(-1) },
  { id: "01LIVE2", title: "説明なしのファイル", description: "", expiresAt: days(30), createdAt: days(-2) },
  { id: "01OLD1", title: "先月のレポート", description: "これは一覧に出てはいけない", expiresAt: days(-3), createdAt: days(-30) },
  { id: "01OLD2", title: "先々月のレポート", description: "これも出てはいけない", expiresAt: days(-40), createdAt: days(-60) },
];

for (const f of fixtures) {
  await db.collection("htmlFiles").doc(f.id).set({
    title: f.title,
    description: f.description,
    storagePath: `timothy-files/${f.id}.html`,
    expiresAt: f.expiresAt,
    createdAt: f.createdAt,
  });
}
console.log("seeded");
```

実行:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=demo-test \
FIREBASE_STORAGE_BUCKET=demo-test.appspot.com \
npx tsx /private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/seed-hide.mts
```

- [ ] **Step 3: 開発サーバーを起動する**

バックグラウンドで実行し、`Server running on http://localhost:3000` が出るまで待つ:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 STORAGE_EMULATOR_HOST=http://127.0.0.1:9199 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 FIREBASE_PROJECT_ID=demo-test \
FIREBASE_STORAGE_BUCKET=demo-test.appspot.com PORT=3000 pnpm dev:api
```

ポート 3000 が使用中なら `lsof -ti:3000 | xargs kill -9` で解放してから起動する。

- [ ] **Step 4: 一覧を確認する**

```bash
agent-browser set viewport 1440 1100
agent-browser open http://localhost:3000/
agent-browser screenshot /private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/hide-list.png
```

撮った画像を Read して、次を目視で確認する:

- 見出しが `Tim` になっている
- 表示されている行が「月次レポート」「説明なしのファイル」の 2 件だけ
- 「先月のレポート」「先々月のレポート」が出ていない
- 「期限切れ」バッジがどこにも出ていない
- 日時の列が淡色になっている行が無い（全行が通常色）
- 日時の桁が揃っている

`GET /files` は全件返したままであることも確認する:

```bash
curl -s http://localhost:3000/files | grep -c '"id"'
```

Expected: `4`（CLI 側は据え置き）

- [ ] **Step 5: 全件期限切れの空状態を確認する**

有効な 2 件を消して、期限切れだけが残る状態を作る:

```bash
curl -s -X DELETE http://localhost:3000/files/01LIVE1
curl -s -X DELETE http://localhost:3000/files/01LIVE2
agent-browser open http://localhost:3000/
agent-browser screenshot /private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/hide-all-expired.png
```

「有効期限内のファイルがありません」が出て、「まだファイルがありません」が出ていないことを画像で確認する。

- [ ] **Step 6: 本当に空のときの文言を確認する**

```bash
curl -s -X DELETE "http://127.0.0.1:8080/emulator/v1/projects/demo-test/databases/(default)/documents"
agent-browser open http://localhost:3000/
agent-browser screenshot /private/tmp/claude-502/-Users-shunsuke-tadokoro-work-timothy-cli/464dd1c6-dc6f-4d6a-85e1-4f0636e7cc9b/scratchpad/hide-empty.png
```

「まだファイルがありません」が出ることを画像で確認する。

- [ ] **Step 7: ブラウザのタブ名を確認する**

```bash
agent-browser get title
```

Expected: `Tim`

- [ ] **Step 8: 後片付け**

```bash
lsof -ti:3000 | xargs kill
```

エミュレータのプロセスも止める。一時スクリプトとスクリーンショットはリポジトリ外に置いてあること、`git status` が clean であることを確認する。

- [ ] **Step 9: 調整した場合のみコミット**

崩れを直した場合のみコミットする。調整が不要だった場合はコミットせず、確認結果を報告すること。

---

## 完了条件

- [ ] `pnpm --filter @timothy/api run build` が成功する
- [ ] `pnpm --filter @timothy/api run test` が成功する（101 件）
- [ ] `pnpm lint` が 0 errors
- [ ] `packages/api/src/` に `Timothy` `badgeClass` `data-expired` が残っていない
- [ ] `webStyles.ts` のエクスポートが 15 個
- [ ] `GET /files` の JSON が全件を返す（CLI 互換）
- [ ] 一覧に期限切れが出ない
- [ ] 全件期限切れのとき「有効期限内のファイルがありません」、0 件のとき「まだファイルがありません」
