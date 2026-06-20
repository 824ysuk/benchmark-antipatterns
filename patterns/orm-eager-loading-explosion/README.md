# ORM ネスト include のカルテシアン爆発

**カテゴリ**: [計算量の無駄](../../docs/bottleneck-types.md#計算量の無駄)
**計算量の変化**: O(n × m × l) → O(n + m + l)
**実測改善比**: 41×（Prisma 6.19 + PostgreSQL 16、参考値）

## 問題

> Big-O 記法の前提は [docs/performance-basics.md](../../docs/performance-basics.md) を参照。

ORM の `include` / `eager_load` を to-many リレーション 2 段以上にネストすると、内部 SQL の JOIN 結果が「親 × 子 × 孫 …」の **掛け算**で爆発する。これを **Cartesian explosion**（カルテシアン爆発）と呼ぶ。User=100, Order=10/user, Item=5/order, Review=3/item で `100 × 10 × 5 × 3 = 15,000` 行が中間結果として生成され、アプリ側で deduplicate して 100 User オブジェクトに hydrate する。User カラムは本来 100 件で済むが、JOIN 経由では中間で 150 倍に膨らむ。

各テーブルに独立 SELECT を発行して in-memory で join し直せば、行数は `n + m + l` に抑えられる。これは ORM 横断のアルゴリズム的問題で、Prisma 固有 API はトリガーに過ぎない。

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
// Prisma 6.x + PostgreSQL では LATERAL JOIN が発行され、
// 行数 = User × Order × Item × Review の掛け算で膨張する。
```

## ✅ 改善後

各テーブルへ独立 SELECT を発行し、Map で in-memory に join する。

**第一推奨**: `relationLoadStrategy: "query"` の 1 行追加。

```typescript
// `previewFeatures = ["relationJoins"]` を schema.prisma に追記が必要（2026-06 時点で preview）
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

既存パターンの `benchmark()` ヘルパー（[CONTRIBUTING.md](../../CONTRIBUTING.md#計測ヘルパー)）は sync 関数を想定するため、async な Prisma client では使えない。代わりに `process.hrtime.bigint()` ベースの async 対応 helper を bench.js 内に inline 定義する。本パターンは Docker + Prisma + PostgreSQL が必要で、1 コマンドで再現できる手順を以下に示す。

### 環境セットアップ

```bash
# 1. PostgreSQL を起動
docker run -d --name bap-pg-bench -e POSTGRES_PASSWORD=bench \
  -e POSTGRES_DB=bench -p 55432:5432 postgres:16-alpine

# 2. プロジェクト準備
mkdir bench && cd bench
npm init -y && npm i @prisma/client && npm i -D prisma
export DATABASE_URL_PG="postgresql://postgres:bench@localhost:55432/bench"

# 3. schema.prisma を配置（下記）してマイグレーション
npx prisma migrate dev --name init
```

### `schema.prisma`

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["relationJoins"]
}
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL_PG")
}
model User       { id Int @id @default(autoincrement()) name String orders Order[] }
model Order      { id Int @id @default(autoincrement()) userId Int user User @relation(fields: [userId], references: [id]) items OrderItem[] }
model OrderItem  { id Int @id @default(autoincrement()) orderId Int order Order @relation(fields: [orderId], references: [id]) reviews ItemReview[] }
model ItemReview { id Int @id @default(autoincrement()) itemId Int item OrderItem @relation(fields: [itemId], references: [id]) score Int }
```

### `seed.js`

```javascript
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const [U, O, I, R] = [100, 10, 5, 3];

(async () => {
  await p.itemReview.deleteMany(); await p.orderItem.deleteMany();
  await p.order.deleteMany();      await p.user.deleteMany();

  await p.user.createMany({ data: Array.from({ length: U }, (_, i) => ({ name: `u${i}` })) });
  const users = await p.user.findMany();
  await p.order.createMany({ data: users.flatMap(u => Array.from({ length: O }, () => ({ userId: u.id }))) });
  const orders = await p.order.findMany();
  await p.orderItem.createMany({ data: orders.flatMap(o => Array.from({ length: I }, () => ({ orderId: o.id }))) });
  const items = await p.orderItem.findMany();
  await p.itemReview.createMany({ data: items.flatMap(i => Array.from({ length: R }, () => ({ itemId: i.id, score: 5 }))) });
  await p.$disconnect();
})();
```

### `bench.js`

```javascript
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const include = { orders: { include: { items: { include: { reviews: true } } } } };

async function measure(label, fn) {
  for (let i = 0; i < 2; i++) await fn();                       // warmup
  const t = [];
  for (let i = 0; i < 10; i++) {
    const s = process.hrtime.bigint(); await fn();
    t.push(Number(process.hrtime.bigint() - s) / 1e6);
  }
  t.sort((a, b) => a - b);
  console.log(`[${label}] median=${t[5].toFixed(2)}ms`);
}

(async () => {
  await measure('❌ default (join)',  () => p.user.findMany({ include }));
  await measure('❌ explicit "join"', () => p.user.findMany({ relationLoadStrategy: 'join',  include }));
  await measure('✅ "query"',         () => p.user.findMany({ relationLoadStrategy: 'query', include }));
  await measure('✅ manual preload',  async () => {
    const users   = await p.user.findMany();
    const orders  = await p.order.findMany({ where: { userId:  { in: users.map(u => u.id) } } });
    const items   = await p.orderItem.findMany({ where: { orderId: { in: orders.map(o => o.id) } } });
    await p.itemReview.findMany({ where: { itemId:  { in: items.map(i => i.id) } } });
  });
  await p.$disconnect();
})();
```

実行: `node seed.js && node bench.js`

## 実測値（参考）

データ規模: 100 User / 1,000 Order / 5,000 Item / 15,000 Review。median (10 反復 + 2 warmup)。
環境: macOS 26.5.1 / arm64 / Node 20.19.6 / Prisma 6.19.3 / PostgreSQL 16 (alpine, Docker)。

| 戦略 | 中央値 | 主な比較 |
|---|---|---|
| ❌ default | 2,378.23 ms | (a) |
| ❌ `relationLoadStrategy: "join"` | 1,243.30 ms | (b) — antipattern 本質倍率の起点 |
| ✅ `relationLoadStrategy: "query"` | 39.72 ms | (c) — 1 行解 |
| ✅ 手動 preload | 30.03 ms | (d) |

| 比較 | 倍率 |
|---|---|
| **(b) vs (d)**（同 Prisma client 内、戦略の差） | **41×**（主指標） |
| (b) vs (c)（同 1 行修正の効果） | 31× |
| (a) vs (d)（最大差、警鐘用） | 79× |

> 結果は実行環境・ハードウェアによって変わります。同じ環境で改善前後を比較することが重要です。本検証では別環境 (Node 24.14.1) でも (b)/(d) = 56× で再現を確認しています（環境差で 35-60× の幅）。

## 注意・例外

- **`relationLoadStrategy` は 2026-06 時点で依然 preview**（`previewFeatures = ["relationJoins"]` 必須）。GA 当初予定 2025-03〜08 が未達（[prisma/prisma#26136](https://github.com/prisma/prisma/discussions/26136)）。GA 前に default が `query` 側へ反転する可能性があり、その場合は本パターン自体が発火しなくなる
- **多くのケースは `relationLoadStrategy: "query"` の 1 行追加で解決**する。手動 preload は preview を使えない / 使いたくない場合の fallback
- **to-one を 1 段だけ include** する場合は JOIN の方が速いことが多い。本パターンは **to-many を 2 段以上ネスト**するときに限り適用する
- **SQLite では再現不能**: Prisma が `relationLoadStrategy` 引数自体を validation error で拒否する。本パターンは PostgreSQL / MySQL の Prisma 利用環境固有
- **(a) default と (b) `relationLoadStrategy: "join"` は本来同じ戦略**（Prisma 6.x + PostgreSQL の default は `join`）。schema 反映直後や接続プール warmup 不足時には乖離して測定されることがあるが、十分な warmup (2-3 回以上) を確保すれば両者はほぼ同等になる。表の (a)/(b) ≈ 1.9× は環境固有の noise を含む値で、antipattern の本質倍率としては (b)/(d) を採用する
- ページング条件によっては raw SQL の方が速いケースもある（offset の負荷など）

## 他言語での同等パターン

| ORM / 言語 | 同問題 | 公式解 |
|---|---|---|
| Rails ActiveRecord | `eager_load` で `LEFT OUTER JOIN` → 行 multiplied out | [`preload` で per-association query に分割](https://guides.rubyonrails.org/active_record_querying.html) |
| SQLAlchemy | `joinedload()` で行 duplicate | [`selectinload()`（公式が「to-many は generally best」と明記）](https://docs.sqlalchemy.org/en/20/orm/queryguide/relationships.html) |
| Hibernate / JPA | 同問題 | [`MultipleBagFetchException` で同階層複数 bag は runtime 拒否](https://vladmihalcea.com/hibernate-multiplebagfetchexception/) |
| TypeORM | 同問題 | [`relationLoadStrategy: "query"`](https://typeorm.io/docs/working-with-entity-manager/find-options/) |

Rails の語彙が最も明確で、Prisma `include`（default）は Rails の `eager_load` 相当、`relationLoadStrategy: "query"` は `preload` 相当。

## 参考

- [カテゴリ解説: 計算量の無駄 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#計算量の無駄) — 出典・引用を含む詳細解説
- [Cartesian explosion — Wikipedia](https://en.wikipedia.org/wiki/Cartesian_explosion)
- [The best way to fix the Hibernate MultipleBagFetchException — Vlad Mihalcea](https://vladmihalcea.com/hibernate-multiplebagfetchexception/)
- [Database vs Application: Demystifying JOIN Strategies — Prisma Blog](https://www.prisma.io/blog/database-vs-application-demystifying-join-strategies)
- [prisma/prisma#23139 — Postgres Query Performance Suffering with relationJoins toggled on](https://github.com/prisma/prisma/issues/23139)
- [prisma/prisma#22596 — High Performance Overhead with relationJoins preview feature in Nested Joins](https://github.com/prisma/prisma/issues/22596)
