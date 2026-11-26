# ORM ネスト include のカルテシアン爆発

**カテゴリ**: [計算量の無駄](../../docs/bottleneck-types.md#計算量の無駄)
**比較対象**: PostgreSQL 側での関連集約と、テーブル別取得後のアプリ側組み立て
**実測改善比**: 35.5×（外部キー列に索引なし）、1.9×（索引あり）

## 問題

> Big-O 記法の前提は [docs/performance-basics.md](../../docs/performance-basics.md) を参照。

複数の to-many を平坦な JOIN で読み込むと、親の列が子の組み合わせごとに複製される。たとえば 1 親に子 A が 20 件、子 B が 10 件あれば、両方を結合した平坦な結果は 200 行になる。

Prisma の PostgreSQL 向け `join` は `LATERAL` と JSON 集約を使う。この例では親の行が 15,000 行返るというモデルは当てはまらない。比較対象は DB での相関サブクエリと集約の負荷、および `query` が行うテーブル別取得とアプリ側での組み立ての負荷。

## ❌ アンチパターン

```typescript
// 親 = User、子 = Order (to-many)、孫 = OrderItem (to-many)、ひ孫 = ItemReview (to-many)
const users = await prisma.user.findMany({
  include: {
    orders: {
      include: {
        items: {
          include: { reviews: true },
        },
      },
    },
  },
});
// relationJoins を有効にした Prisma 6.19.3 では既定が join。
```

## ✅ 改善後

各テーブルへ独立 SELECT を発行し、Map で in-memory に join する。

まず `relationLoadStrategy: "query"` で同じ結果を返すクエリを比較する。

```typescript
// `previewFeatures = ["relationJoins"]` を schema.prisma に追記が必要（このベンチの Prisma 6.19.3）
const users = await prisma.user.findMany({
  relationLoadStrategy: "query",
  include: { orders: { include: { items: { include: { reviews: true } } } } },
});
```

**Fallback**: preview を使えない場合の手動 preload。Node 20 互換、ORM 横断的に再利用できる形。

```typescript
const users    = await prisma.user.findMany();
const orders   = await prisma.order.findMany({ where: { userId:  { in: users.map(u => u.id) } } });
const items    = await prisma.orderItem.findMany({ where: { orderId: { in: orders.map(o => o.id) } } });
const reviews  = await prisma.itemReview.findMany({ where: { itemId:  { in: items.map(i => i.id) } } });

const reviewsByItem = new Map();
for (const r of reviews) {
  const arr = reviewsByItem.get(r.itemId);
  if (arr) arr.push(r); else reviewsByItem.set(r.itemId, [r]);
}
// itemsByOrder / ordersByUser も同じパターンで構築
```

## ベンチマーク

Prisma 6.19.3 と PostgreSQL 16 を使います。空の検証専用 DB を用意し、`DATABASE_URL` に接続文字列を設定してください。Node.js 22.18 以降を使い、このパターンのディレクトリから実行します。

```sh
bench_dir=$(mktemp -d)
cp schema.prisma seed.cjs bench.cjs "$bench_dir"
cd "$bench_dir"
npm install --save-exact prisma@6.19.3 @prisma/client@6.19.3
npx prisma db push --schema schema.prisma
node seed.cjs
node bench.cjs
```

同じ並び順を指定し、各反復で両戦略のネストした結果が一致することを確認します。2 回ウォームアップした後、実行順を交互にして各 10 回計測します。外部キー列のインデックスが性能差に与える影響を見るには、同じ DB で次を適用して再計測します。

```sql
CREATE INDEX ON "Order" ("userId");
CREATE INDEX ON "OrderItem" ("orderId");
CREATE INDEX ON "ItemReview" ("itemId");
ANALYZE;
```

## 実測値（参考）

データ規模は 100 User / 1,000 Order / 5,000 Item / 15,000 Review です。

Node.js 24.22.2 / Prisma 6.19.3 / PostgreSQL 16.14、Linux arm64（Docker on Apple M5 Pro）。各戦略につきウォームアップ 2 回、計測 10 回。

| 外部キー列の索引 | join 中央値 | query 中央値 | 中央値の比 |
|---|---:|---:|---:|
| なし | 1,512.60 ms | 42.55 ms | 35.5× |
| 3 列に追加 | 90.79 ms | 48.07 ms | 1.9× |

過去に掲載していた手動 preload の 41× は組み立て前の取得時間との比較でした。上の表では同じネスト結果を組み立てる戦略同士を比較しています。

## 注意・例外

- `relationJoins` を有効にした Prisma 6.19.3 では `join` が既定です。比較は両戦略を明示して行います。
- `query` はテーブルごとに取得してクライアントで組み立てます。関連キーの索引、データの偏り、DB との往復コストによって優劣が変わります。
- 平坦な JOIN では兄弟の to-many 同士でも行が掛け合わされます。Prisma の `LATERAL` と JSON 集約では、生成 SQL と実行計画で膨張した行や反復走査を特定します。

## 他言語での同等パターン

| ORM / 言語 | 同問題 | 公式解 |
|---|---|---|
| Rails ActiveRecord | `eager_load` で `LEFT OUTER JOIN` → 行 multiplied out | [`preload` で per-association query に分割](https://guides.rubyonrails.org/active_record_querying.html) |
| SQLAlchemy | `joinedload()` で行 duplicate | [`selectinload()`（公式が「to-many は generally best」と明記）](https://docs.sqlalchemy.org/en/20/orm/queryguide/relationships.html) |
| Hibernate / JPA | 同問題 | [`MultipleBagFetchException` で同階層複数 bag は runtime 拒否](https://vladmihalcea.com/hibernate-multiplebagfetchexception/) |
| TypeORM | 同問題 | [`relationLoadStrategy: "query"`](https://typeorm.io/docs/working-with-entity-manager/find-options/) |

Rails の語彙が最も明確で、Prisma `include`（default）は Rails の `eager_load` 相当、`relationLoadStrategy: "query"` は `preload` 相当。

## 参考

- [Prisma と SQLAlchemy の公式資料](../../docs/primary-sources.md#データアクセスとキャッシュ)

引用 Tier は [docs/primary-sources.md](../../docs/primary-sources.md) 体系に従う（Tier 1: 公式 / spec、Tier 2: engine team、Tier 3: 信頼性ある二次、Tier 4: 理論）。

- **Tier 3**: [The best way to fix the Hibernate MultipleBagFetchException — Vlad Mihalcea](https://vladmihalcea.com/hibernate-multiplebagfetchexception/) — Hibernate での同型問題と解決策の解説（Java/Hibernate コミュニティの定番参照）
- **Tier 1**: [Choosing the Best Join Strategy in Prisma ORM — Prisma Blog](https://www.prisma.io/blog/prisma-orm-now-lets-you-choose-the-best-join-strategy-preview) — Prisma 公式 blog (relationJoins と application-level join の比較)
- **Tier 3**: [prisma/prisma#23139 — Postgres Query Performance Suffering with relationJoins toggled on](https://github.com/prisma/orm/issues/23139) — relationJoins の性能問題のコミュニティ報告
- **Tier 3**: [prisma/prisma#22596 — High Performance Overhead with relationJoins preview feature in Nested Joins](https://github.com/prisma/orm/issues/22596) — Nested Joins での性能オーバーヘッド報告
- **Tier 4**: [Cartesian explosion — Wikipedia](https://en.wikipedia.org/wiki/Cartesian_explosion) — カルテシアン爆発概念の理論的背景
- [カテゴリ解説: 計算量の無駄 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#計算量の無駄)
