# PostgreSQL seq scan — index がない column の WHERE point lookup

**カテゴリ**: [計算量の無駄](../../docs/bottleneck-types.md#計算量の無駄)
**計算量の変化**: O(n) → O(log n)
**実測改善比**: 約 400× オーダー（PostgreSQL 16.14 / 1,000,000 行 / point lookup `WHERE email = '...'` で 433.7×。**selectivity に強く依存**し、low selectivity (2% hit) は 1.9× にとどまる。詳細は [実測値](#実測値参考) と [注意・例外](#注意例外とても重要) を参照）

## 問題

> Big-O 記法の前提は [docs/performance-basics.md](../../docs/performance-basics.md) を参照。

PostgreSQL（および他の RDBMS）で **index がない column を `WHERE` 句で point lookup する** と、planner が seq scan を選択し全行を線形に走査する。B-tree index がある同じ query は O(log n) で完了するため、大きい table では桁違いに差がつく。

各テーブルに B-tree index を貼っていれば 1 回の lookup は ~20 比較で済むが、index がなければ 100 万行すべてを `Filter` で評価する。この差は **RDBMS engine 固有 API ではなくデータ構造の選択** (B-tree vs 連続配列) に起因するアルゴリズム的問題で、MySQL / SQLite / MongoDB / Elasticsearch でも同じ構造で発生する ([他 DB / 言語での同問題](#他-db--言語での同問題) 参照)。

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

100 万行で `Buffers: shared hit=9854` (≈ 77MB) すべてを scan している。テーブルが大きいほど線形に遅くなる (1 億行なら ~1 秒以上)。

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

B-tree は **O(log n)** で目的の row に辿り着く。100 万行なら ~20 比較。`Buffers: shared hit=1 read=3` から、scan 対象が 4 ページ (= ~32 KB) で済んでいることが読み取れる。

## ベンチマーク

[計測ヘルパー](../../CONTRIBUTING.md#計測ヘルパー) は JavaScript ランタイム上の sync 関数向け。本パターンは **server-side の `EXPLAIN (ANALYZE, BUFFERS)` Execution Time** を計測対象とするため、bash + `docker exec ... psql` で直接計測する (client-server TCP / parse overhead を排除した pure な engine 内部コスト)。

### 環境セットアップ

```bash
# 1. PostgreSQL container を起動 (既に bap-pg-bench を別パターンで起動済なら skip)
docker run -d --name bap-pg-bench \
  -e POSTGRES_PASSWORD=bench -p 55432:5432 postgres:16-alpine

# 2. schema + 1,000,000 行 seed (新規 DB `bench_seqscan` を作成、orm 用 DB と隔離)
docker exec -i bap-pg-bench psql -U postgres < setup.sql
```

### bench 実行

```bash
bash bench.sh
```

`bench.sh` は以下を行う:
- Mode 1 (no secondary index) で Query A (point lookup) / B (low selectivity) を各 5 反復計測
- `CREATE INDEX users_email_idx` / `users_city_idx` を貼って `VACUUM ANALYZE`
- Mode 2 (with index) で同じ Query A / B を 5 反復計測
- 各組から初回 (cold cache) を捨てて 2-5 の中央値を出す
- 最後に `DROP INDEX` で初期状態に戻す (再実行可能)

### 計測コアロジック (bench.sh から抜粋)

```bash
# 5 反復、初回 cold cache を捨てて 2-5 の median
measure() {
  local label="$1"
  local sql="$2"
  local times=()
  for i in $(seq 1 5); do
    out=$(docker exec bap-pg-bench psql -U postgres -d bench_seqscan \
      -c "DISCARD ALL;" \
      -c "EXPLAIN (ANALYZE, BUFFERS) ${sql}")
    t=$(echo "${out}" | grep -E "Execution Time" | head -1 \
      | sed -E 's/.*Execution Time: ([0-9.]+) ms.*/\1/')
    [[ "${i}" -ne 1 ]] && times+=("${t}")
  done
  printf '%s\n' "${times[@]}" | sort -g | awk '
    { a[NR]=$1 } END { n=NR;
      if (n%2==1) print a[(n+1)/2]
      else        printf "%.4f\n", (a[n/2]+a[n/2+1])/2 }'
}
```

完成版は本ディレクトリ同梱の [`bench.sh`](./bench.sh) と [`setup.sql`](./setup.sql) を参照。

## 実測値（参考）

データ規模: 1,000,000 行 (`users(id BIGINT PK, email TEXT, city TEXT, created_at TIMESTAMP)`)、tokyo hit 20,000 (= 2% selectivity)。median は run 2-5 から取得 (run 1 = cold cache)。

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

**ratio: 1.9×** ❌ 9× 未達

> 結果は実行環境・ハードウェアによって変わります。同じ環境で改善前後を比較することが重要です。Issue #17 当初の計測 (388×) と本実装の計測 (433.7×) は ±20% 程度の幅で同オーダー。

## 注意・例外（とても重要）

本パターンは「index 追加で常に 9× 改善する」という主張ではない。**改善幅は selectivity (hit rate) と table の RAM-residency に強く依存する**。

| 条件 | index による改善幅 |
|---|---|
| **point lookup / unique value（Query A）** | 数十倍～数千倍（今回 **433×**） |
| **high selectivity（hit < 0.1%）** | 数倍～数百倍 |
| **moderate selectivity（hit 1-5%、今回 Query B = 2%）** | **1-3×**（heap fetch コストが支配的、bitmap index でも seq scan と差がつかない） |
| **low selectivity（hit > 30%）** | ~1× ないし逆転（planner も index を使わず seq scan を選ぶ） |

### 「9× 出ない」典型ケース

- **table 全体が `shared_buffers` に収まる** + **selectivity が moderate** の組み合わせ。今回の Query B (`city='tokyo'` 2%) はこのケース:
  - heap 77MB が shared_buffers 128MB に収まる → seq scan も全 in-memory
  - Bitmap Heap Scan も結局 `Heap Blocks: exact=9854` を再 fetch
  - 1.9× で benchmark-antipatterns の 9× 基準を満たさない
- **table が大きく I/O コストが seq scan に乗る** 環境では Query B のような low/moderate selectivity でも index 効果が大きく出る可能性がある (要再計測)

### 適用しない方が良いケース

- **すべての column に index を貼る**: 書き込みコスト (`INSERT` / `UPDATE` / `DELETE`) が線形に増える。index は read-heavy column に限る
- **selectivity が高すぎる column (boolean / status の 2-3 値)**: planner が index を無視して seq scan を選ぶことが多い
- **頻繁に変わる column を index にする**: index 再構築コストで write が劇的に遅くなる

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

引用 Tier は [docs/primary-sources.md](../../docs/primary-sources.md) 体系に従う（Tier 1: 公式 / spec、Tier 2: engine team、Tier 3: 信頼性ある二次、Tier 4: 理論）。

- **Tier 1 (PostgreSQL 公式)**: [Chapter 11. Indexes](https://www.postgresql.org/docs/current/indexes.html) — B-tree / Hash / GiST / SP-GiST / GIN / BRIN の使い分けと planner 動作根拠
- **Tier 1 (PostgreSQL 公式)**: [§11.2 Index Types](https://www.postgresql.org/docs/current/indexes-types.html) — 6 種類の index の operator サポートと使用例
- **Tier 1 (PostgreSQL 公式)**: [§14.1 Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html) — `EXPLAIN (ANALYZE, BUFFERS)` の plan 読み方
- **Tier 3 (信頼性ある二次)**: [Use The Index, Luke!](https://use-the-index-luke.com/) — SQL index と performance の体系的解説 (DB 横断、PostgreSQL / MySQL / Oracle / SQL Server)
- [カテゴリ解説: 計算量の無駄 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#計算量の無駄)
- [Issue #17](https://github.com/824ysuk/benchmark-antipatterns/issues/17) — 本パターンの元提案 (schema・seed・実測値の blueprint)
- [Issue #25](https://github.com/824ysuk/benchmark-antipatterns/issues/25) — cross-machine 再現性検証 (本 PR では Apple M5 Pro / Docker のみ計測、defer)
