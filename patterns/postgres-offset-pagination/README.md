# PostgreSQL の深い OFFSET ページング

**カテゴリ**：[計算量の無駄](../../docs/bottleneck-types.md#計算量の無駄)\
**走査量の変化**：OFFSET を k、ページサイズを p とすると、k+p 件の読み出し → B-tree の境界探索 + p 件の読み出し\
**実測改善比**：約 1,888×（PostgreSQL 16.14、100 万行、OFFSET 900,000、サーバー内実行時間の中央値）

## 問題

`OFFSET` で飛ばす行もサーバー内では計算される。索引に沿って並べ替えを省けても、深いページでは先頭から多数の行を読んで捨てる。

## ❌ アンチパターン

```sql
SELECT id FROM users ORDER BY id LIMIT 20 OFFSET 900000;
```

## ✅ 改善後

次ページへ進む API では、前ページ末尾のキーをカーソルとして渡す。この例の前ページ末尾は `900000`。

```sql
SELECT id FROM users WHERE id > 900000 ORDER BY id LIMIT 20;
```

両方とも主キーの B-tree を使う。前者は索引から 900,020 件を読み出し、後者は `id > 900000` の境界から 20 件を読み出す。

## ベンチマーク

[PostgreSQL seq scan の環境セットアップ](../postgres-seq-scan/#環境セットアップ)で 100 万行をロードし、リポジトリ直下から実行する。

```sh
docker exec -i bap-pg-bench psql -v ON_ERROR_STOP=1 -U postgres -d bench_seqscan < patterns/postgres-offset-pagination/bench.sql
```

固定データ上で先頭・深いページの結果が一致することを確認したあと、各クエリの実行計画と `Execution Time` を出す。

## 実測値（参考）

PostgreSQL 16.14 / Linux arm64（Docker on Apple M5 Pro）。初回を除く 5 回の中央値。投影は `id` のみで、すべて Index Only Scan。

| ページ | OFFSET | カーソル | 中央値の比 |
|---|---:|---:|---:|
| 先頭 20 件 | 0.014 ms | 0.013 ms | 約 1.1× |
| 900,000 件目の次から 20 件 | 39.648 ms | 0.021 ms | 約 1,888× |

深いページでは Index Only Scan の実測行数が 900,020 → 20、共有バッファのヒットが 2,463 → 4。クライアントへの転送時間は計測に含まない。

## 注意・例外

- カーソルには一意で安定した順序を使う。例えば `created_at` に同値があり得るなら `id` をタイブレーカーにし、`ORDER BY created_at, id` と境界条件を同じ順序にそろえる。
- 任意のページ番号に直接飛ぶ仕様では、対応する境界を別途取得する必要がある。浅いページには OFFSET の単純さが利点になる。
- 更新や削除のあるデータでは、複数のリクエストにまたがる一貫性を別途設計する。上の結果一致は固定データでの確認。

## 参考

- [PostgreSQL のページング、索引、実行計画の資料](../../docs/primary-sources.md#データアクセスとキャッシュ)
- [カテゴリ解説](../../docs/bottleneck-types.md#計算量の無駄)
