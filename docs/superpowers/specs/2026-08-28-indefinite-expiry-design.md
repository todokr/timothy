# 有効期間「無期限」の追加

## 背景

Timothy はアップロードした HTML を有効期限付き URL で共有する。現状の有効期間は
`ttlDays`（正の整数、既定 7 日）でのみ指定でき、期限を設けない選択肢がない。

期限を切りたくない用途（恒久的に参照するレポートなど）では、期限が来るたびに
再アップロードして URL を配り直す必要がある。ここに「無期限」を追加する。

無期限の選択に運用側のガード（環境変数による opt-in など）は設けない。セルフホストで
利用者を運用者が把握している前提のため、常に選択できる。

## データモデル

Firestore `htmlFiles` ドキュメントの `expiresAt` に **`null` を保存したものを無期限とする**。

既存ドキュメントは Timestamp のまま変わらないため、マイグレーションは不要。

フィールドを書かない（欠落させる）形は採らない。欠落は保存漏れやマイグレーション失敗と
区別がつかず、`/s/:id` が無言で期限なし配信になる事故を招く。無期限は明示的な `null` で表す。

## API 契約

### `POST /upload`

`ttlDays` の型を `正の整数 | null` に拡張する。`null` が無期限を意味する。

`parseUploadRequest` の検証:

- `ttlDays` キーの存在は引き続き必須（欠落は 400）
- `null` は受理する
- `0`・負数・非整数・数値以外は従来どおり 400

無期限のとき、Firestore に保存する `expiresAt` は `null`。レスポンスの `expiresAt` は
`string | null`。

### `GET /files`

`FileEntry.expiresAt` の型を `string | null` にする。`listFiles` は保存値が `null` なら
`null` を返す（`data.expiresAt.toDate()` を呼ばない）。

## 配信 `/s/:id`

`expiresAt` が `null` のときは期限判定をスキップし、410 を返さない。

`buildHeaders` の第 2 引数を `Date | null` に変更する。`cacheControlValue` は:

- `no-store` … 従来どおり `no-store`（変更なし）
- `public` / `private` かつ期限あり … 従来どおり残り秒数を `max-age` に入れる
- `public` / `private` かつ無期限 … **`max-age=86400`（1 日）固定**

無期限では期限切れ後の配信という問題が消えるため残り秒数の計算は不要だが、`max-age` を
省くとブラウザや中間キャッシュがヒューリスティックに期間を決めてしまう。削除
（`DELETE /files/:id`）した後に古いキャッシュから配信され続ける窓を読める長さに抑える
ため、1 日を固定値として入れる。

## CLI

### `tim upload`

`--ttl <days|never>` に拡張する。`never` を渡すと `ttlDays: null` を送信する。

あわせて日数のローカル検証を追加する。現状 `parseInt("abc", 10)` の `NaN` がそのまま
API に送られて 400 になるため、`never` 以外で正の整数にならない値は CLI 側で
`exit 1` にする。

成功時の出力に有効期限を併記する:

```
✓ Uploaded: https://.../s/01J...  (expires: 2026-09-04)
✓ Uploaded: https://.../s/01J...  (expires: never)
```

URL を配る前に無期限かどうかを確認できるようにするため。

### `tim list`

`FileEntry.expiresAt` が `null` の行は EXPIRES 列に `never` と表示する。

## Web UI

### アップロードフォーム

「有効期間（日）」の数値入力の下にチェックボックス「無期限にする」を追加する。

チェック ON の間は数値入力を `disabled` にし、`required` を外す。矛盾した入力状態を
UI の側で作れなくする。

送信時、チェック ON なら `ttlDays: null`、OFF なら従来どおり `Number(ttlInput.value)` を送る。

### 一覧テーブル

- 「有効期限」セル … `expiresAt` が `null` なら「無期限」、それ以外は従来どおり `formatJst`
- `isExpired(iso: string | null, nowMs)` … `null` は常に `false`（期限切れ扱いにしない）

## テスト

- `parseUploadRequest` … `ttlDays: null` を受理し、`0` / 負数 / 非整数 / 文字列を拒否する
- `serve` … `expiresAt: null` のドキュメントが 200 を返す（410 にならない）
- `buildHeaders` … `expiresAt` が `null` かつ `cacheControl: "public"` で
  `public, max-age=86400` を返す。`no-store` は `null` でも `no-store` のまま
- `listFiles` … `expiresAt: null` の保存値を `null` として返す
- Web UI … `isExpired(null, nowMs)` が `false`
- CLI … `--ttl never` が `ttlDays: null` を送る。`--ttl abc` / `--ttl 0` が exit 1

## 対象外

- 既存ファイルの有効期限をあとから変更する機能（無期限化・期限付与）
- 無期限ファイルの一括棚卸しや警告表示
