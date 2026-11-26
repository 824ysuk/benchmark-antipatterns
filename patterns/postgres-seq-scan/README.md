# PostgreSQL seq scan — index がない column の WHERE point lookup

**カテゴリ**: [計算量の無駄](../../docs/bottleneck-types.md#計算量の無駄)
**計算量の変化**: O(n) → O(log n)
**実測改善比**: 再計測では 1 件検索が 434.3×、2% 一致が 2.1×（PostgreSQL 16.14、100 万行）。[実測値](#実測値参考)に初回掲載時と再計測の両方を記載。

## 問題

> Big-O 記法の前提は [docs/performance-basics.md](../../docs/performance-basics.md) を参照。

PostgreSQL（および他の RDBMS）で **index がない column を `WHERE` 句で point lookup する** と、planner が seq scan を選択し全行を線形に走査する。B-tree index がある同じ query は O(log n) で完了するため、大きい table では桁違いに差がつく。

このデータでは B-tree の探索で 1 件を取得でき、索引のない実行計画では 100 万行を `Filter` の対象にする。この差は **RDBMS engine 固有 API ではなくデータ構造の選択** (B-tree vs 連続配列) に起因するアルゴリズム的問題で、MySQL / SQLite / MongoDB / Elasticsearch でも走査と索引の違いとして現れることがある ([他 DB / 言語での同問題](#他-db--言語での同問題) 参照)。

## ❌ アンチパターン

「テーブルを作って `id` だけ PK にしたが、検索する column に index を貼り忘れた」ケース。`SELECT` は動作し正しい結果を返すため、テスト・動作確認では露見しにくい。

```sql
-- email column に index がない状態 (PK は id のみ)
SELECT * FROM users WHERE email = 'user-500000@example.com';
-- → Parallel Seq Scan: 14.31 ms (1M 行)
```

`EXPLAIN (ANALYZE, BUFFERS)` で plan を確認すると、planner は **全行を読みに行く**:

```
 Gather  (cost=1000.00..16062.43 rows=1 width=47) (actual time=25.540..28.076 rows=1 loops=1)
   Workers Planned: 2
   Workers Launched: 2
   Buffers: shared hit=9854
   ->  Parallel Seq Scan on users  (cost=0.00..15062.33 rows=1 width=47) (actual time=20.326..23.833 rows=0 loops=3)
         Filter: (email = 'user-500000@example.com'::text)
         Rows Removed by Filter: 333333
         Buffers: shared hit=9854
 Execution Time: 28.155 ms
```

100 万行で `Buffers: shared hit=9854` (≈ 77MB) すべてを scan している。走査行数はテーブル行数に比例する。実時間は I/O、並列度、キャッシュの影響を受ける。

## ✅ 改善後

頻繁に検索する column に B-tree index を 1 つ追加するだけで O(log n) lookup になる。

```sql
CREATE INDEX users_email_idx ON users (email);

SELECT * FROM users WHERE email = 'user-500000@example.com';
-- → Index Scan: 0.033 ms (1M 行)
```

```
 Index Scan using users_email_idx on users  (cost=0.42..8.44 rows=1 width=47) (actual time=0.041..0.042 rows=1 loops=1)
   Index Cond: (email = 'user-500000@example.com'::text)
   Buffers: shared hit=1 read=3
 Execution Time: 0.059 ms
```

B-tree は **O(log n)** で目的の row に辿り着く。`Buffers: shared hit=1 read=3` から、scan 対象が 4 ページ (= ~32 KB) で済んでいることが読み取れる。

## ベンチマーク

[計測ヘルパー](../../CONTRIBUTING.md#計測ヘルパー) は JavaScript ランタイム上の sync 関数向け。本パターンは **server-side の `EXPLAIN (ANALYZE, BUFFERS)` Execution Time** を計測対象とするため、bash + `docker exec ... psql` で直接計測する (client-server TCP / parse overhead を排除した pure な engine 内部コスト)。

### 環境セットアップ

```bash
# 1. PostgreSQL container を起動（既に検証用コンテナがあれば省略）
docker run -d --name bap-pg-bench \
  -e POSTGRES_PASSWORD=bench postgres:16-alpine

# 2. schema + 1,000,000 行 seed (新規 DB `bench_seqscan` を作成、空の検証専用コンテナで実行)
docker exec -i bap-pg-bench psql -v ON_ERROR_STOP=1 -U postgres < setup.sql
```

同じコンテナで再計測する場合はセットアップを省略し、`bench.sh` から実行します。別のコンテナ名を使う場合は `CONTAINER` を指定できます。

### bench 実行

```bash
bash bench.sh
# 反復回数を変えたい場合 (既定: 5 反復、初回を除いた 4 値の中央値):
RUNS=10 bash bench.sh
```

`bench.sh` は以下を行う:
- Mode 1 (no secondary index) で Query A (point lookup) / B（2% 一致） を各 5 反復計測
- `CREATE INDEX users_email_idx` / `users_city_idx` を貼って `VACUUM ANALYZE`
- Mode 2 (with index) で同じ Query A / B を 5 反復計測
- 各組から初回 を捨てて 2-5 の中央値を出す
- 最後に `DROP INDEX` で初期状態に戻す (再実行可能)

## 実測値（参考）

以下の実行計画と数値表は初回掲載時の測定です。今回の再計測結果を表の後に記載しています。

データ規模: 1,000,000 行 (`users(id BIGINT PK, email TEXT, city TEXT, created_at TIMESTAMP)`)、tokyo hit 20,000 (= 2% selectivity)。median は run 2-5 から取得 (run 1 は集計外)。

環境: macOS 26.5.1 (Darwin 25.5.0) / arm64 / Apple M5 Pro / PostgreSQL 16.14 (alpine, Docker) / `shared_buffers=128MB` (default) / `max_parallel_workers_per_gather=2` (default)。

### Query A: `WHERE email = '...'`（point lookup、1 行 hit）

| 戦略 | Plan top node | Buffers | run 2–5 中央値 |
|---|---|---|---|
| Mode 1 (no index) | Parallel Seq Scan (2 workers) | shared hit=9,854 | **14.31 ms** |
| Mode 2 (with index) | Index Scan using users_email_idx | shared hit=1, read=3 | **0.033 ms** |

**ratio: 433.7×** ✅ 9× を大きく超える

### Query B: `WHERE city = 'tokyo'`（low selectivity、20,000 行 hit = 2%）

| 戦略 | Plan top node | Buffers | run 2–5 中央値 |
|---|---|---|---|
| Mode 1 (no index) | Parallel Seq Scan (2 workers) | shared hit=9,854 | **13.53 ms** |
| Mode 2 (with index) | Bitmap Heap Scan ← Bitmap Index Scan | shared hit=9,854, read=19 | **7.13 ms** |

**ratio: 1.9×**（このケースは掲載基準の 9× 未達）

再計測（PostgreSQL 16.14 / Docker arm64、100 万行、run 2–5 の中央値）では A が 15.2010 → 0.0350 ms（434.3×）、B が 15.0885 → 7.2195 ms（2.1×）でした。

> 結果は実行環境・ハードウェアによって変わります。同じ環境で改善前後を比較することが重要です。Issue #17 当初の計測 (388×) と本実装の計測 (433.7×) は ±20% 程度の幅で同オーダー。

## 注意・例外

初回除外はコールドキャッシュの保証ではありません。PostgreSQL の共有バッファと OS キャッシュはセッションを作り直しても残ります。各モードの実行計画と `BUFFERS` を確認します。

インデックスの効果は一致行の割合、行の物理配置、テーブルと索引のサイズ、統計、キャッシュ状態に依存します。初回掲載時と再計測の両方で、1 件を返す A の改善幅が一致率 2% の B より大きくなりました。B では該当行が広い範囲のヒープページに分散していたため、Bitmap Heap Scan でも多数のページを読みます。一致率だけで一般的なしきい値は決まりません。

`ANALYZE` 後も Seq Scan が選ばれるときは、推定行数と実測行数、フィルタとインデックス条件の違いを確認します。索引の追加には書き込み時の保守と保存領域も必要です。

### 関連する Big-O 拡張

| データ構造 | lookup | 備考 |
|---|---|---|
| B-tree index (PG default) | O(log n) | 範囲 query にも対応 |
| Hash index | O(1) amortized average | 等価比較のみ、PG 10+ で WAL 対応 |
| BRIN | O(n / pages_per_range) (physical correlation 依存) | block range summary を順次走査する構造 (B-tree のような log lookup ではない)。`pages_per_range` 既定 128。データの物理順が key と相関するほど range skip が効く。巨大 sequential table 向け、低 storage |
| Seq scan | O(n) | index なし、または planner が選択 |

## 他 DB / 言語での同問題

| 環境 | 同パターン | 標準的解 |
|---|---|---|
| **MySQL / MariaDB** | 同じ | `CREATE INDEX` (B-tree) / InnoDB clustered index |
| **SQLite** | 同じ | `CREATE INDEX`、低 page size 環境では特に顕著 |
| **MongoDB** | 同じ | `db.users.createIndex({email: 1})` |
| **Elasticsearch** | mapping で `index: false` にすると同様 | mapping 設計時に決定 |
| **DynamoDB** | partition key / sort key 設計、GSI 追加 | スキャン回避がベストプラクティス |

これは「データ構造の選択」レベルの問題で、RDBMS / NoSQL / 全文検索 すべてに通底する。benchmark-antipatterns の既存 5 パターンと同じく **アルゴリズム的問題**。

## 参考


- [PostgreSQL 16 の実行計画・統計・索引](../../docs/primary-sources.md#データアクセスとキャッシュ)

引用 Tier は [docs/primary-sources.md](../../docs/primary-sources.md) 体系に従う（Tier 1: 公式 / spec、Tier 2: engine team、Tier 3: 信頼性ある二次、Tier 4: 理論）。

- **Tier 1 (PostgreSQL 公式)**: [Chapter 11. Indexes](https://www.postgresql.org/docs/current/indexes.html) — B-tree / Hash / GiST / SP-GiST / GIN / BRIN の使い分けと planner 動作根拠
- **Tier 1 (PostgreSQL 公式)**: [§11.2 Index Types](https://www.postgresql.org/docs/current/indexes-types.html) — 6 種類の index の operator サポートと使用例
- **Tier 1 (PostgreSQL 公式)**: [§14.1 Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html) — `EXPLAIN (ANALYZE, BUFFERS)` の plan 読み方
- **Tier 3 (信頼性ある二次)**: [Use The Index, Luke!](https://use-the-index-luke.com/) — SQL index と performance の体系的解説 (DB 横断、PostgreSQL / MySQL / Oracle / SQL Server)
- [カテゴリ解説: 計算量の無駄 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#計算量の無駄)
- [Issue #17](https://github.com/824ysuk/benchmark-antipatterns/issues/17) — 本パターンの元提案 (schema・seed・実測値の blueprint)
- [Issue #25](https://github.com/824ysuk/benchmark-antipatterns/issues/25) — cross-machine 再現性検証 (本 PR では Apple M5 Pro / Docker のみ計測、defer)
