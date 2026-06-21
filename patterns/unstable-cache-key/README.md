# 不安定な cache key による cache miss 永続化

**カテゴリ**: [重複処理](../../docs/bottleneck-types.md#重複処理)
**計算量の変化**: O(n × fetch) → O(fetch + n)
**実測改善比**: 約 90× オーダー（Node v24.14.1 / V8 13.6 / Apple M5 Pro / n=1,000 / fetch コスト 50,000 int op で 89.2×。Issue 本文では Node v20.19.6 / 同条件で 251×。fetch コストと CPU 性能で大きく変動するため詳細は [実測値](#実測値参考) と [注意・例外](#注意例外) を参照）

## 問題

> カテゴリの詳細解説は [docs/bottleneck-types.md#重複処理](../../docs/bottleneck-types.md#重複処理) を参照。

TanStack Query / SWR / RTK Query / Apollo / urql など主要なクライアントキャッシュは、`queryKey` (cache key) を **`JSON.stringify` ベースの deterministic hash** で同一性判定する。TanStack Query v5 の現 `main` の hash 関数は以下のとおり ([TanStack/query query-core/src/utils.ts](https://github.com/TanStack/query/blob/main/packages/query-core/src/utils.ts) `hashKey`):

```typescript
JSON.stringify(queryKey, (_, val) =>
  isPlainObject(val)
    ? Object.keys(val).sort().reduce((result, key) => {
        result[key] = val[key];
        return result;
      }, {} as any)
    : val,
);
```

公式 docs も「plain object なら key 順序を吸収して deterministic に hash する」と明言している ([Query Keys — TanStack Query Documentation](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys))。これ自体は安全。**危険なのは `JSON.stringify` の前提が崩れる値を渡したとき**で、3 つの失敗モードがある:

| 失敗モード | 種別 | 何が起こるか | 典型的なトリガー |
|---|---|---|---|
| **mode 1: cache miss 永続化** | **速度** | 毎レンダーで新しい hash → 新規 cache entry が作られる → 重複 fetch + `gcTime` 期間 cache が肥大化 | `crypto.randomUUID()` / `Date.now()` / 毎回新 object を返す factory |
| **mode 2: hashKey 衝突 (false hit)** | 正しさ | 異なる instance が同一 hash に潰れて別 query の結果が return される | 識別情報を closure に閉じ込めた、own property を持たない instance |
| **mode 3: identity loss** | 正しさ | `Map` / `Set` / 関数のみの object が `{}` に潰れる、または `Date` が ISO 化されて意図と乖離 | `new Map()` / `new Set()` / `new Date()` |

本 repo は速度パターン集のため **mode 1 を主対象**として benchmark し、**mode 2 / 3 は同じ hashKey 仕様の裏返しで起きる正しさ系問題として注釈ベースで併記**する (同じ前提を共有しているため分離して説明する方が読み手にとって誤解を招く)。これは serialize-based hashing を採用するすべてのクライアントキャッシュ共通の **アルゴリズム的問題**であり、フレームワーク固有の API 設計選択ではない。

## ❌ アンチパターン

### mode 1: cache miss 永続化 (速度)

毎レンダーで新しい sessionId / timestamp / UUID を `queryKey` に渡してしまう。意図せず毎回新 hash になり、cache はずっと miss し続ける。

```typescript
function OrderList({ filters }) {
  // ❌ 毎レンダー新しい sessionId → 毎回新 hash → 別 cache entry が増え続ける
  return useQuery({
    queryKey: ['orders', { sessionId: crypto.randomUUID(), filters }],
    queryFn: fetchOrders,
  });
}

// 同じ問題: Date.now() / Math.random() / 毎レンダー新規生成される object 全般
const useOrdersAt = (filters) =>
  useQuery({
    queryKey: ['orders', { at: Date.now(), filters }],
    queryFn: fetchOrders,
  });
```

毎レンダーで `queryKey` の hash が変わるため「別の query」として新規 cache entry が作られ fetch が走る。state ↔ refetch が literal な loop で回るわけではなく、**レンダーごとに重複 fetch が走り、`gcTime` 期間中は古い entry が cache 内に滞留して肥大化**する。実害は (a) ネットワーク・サーバ負荷、(b) cache hit rate が常に 0、(c) `gcTime` 内のメモリ占有。

実例: [TanStack/query Discussion #4079 — Infinite loop when queryKey property changes](https://github.com/TanStack/query/discussions/4079) で「UUID を queryKey に毎回入れて refetch が止まらない」が報告されている。

### mode 2: hashKey 衝突 (正しさ)

識別情報を closure に閉じ込め own property を一切持たない instance を `queryKey` に渡すと、`JSON.stringify` が関数 property を skip するため `'{}'` に潰れて cache collision が起きる。

```typescript
function makeRepoA() {
  const tenantId = "A";
  return { fetch: () => api.getOrders(tenantId) };
}
function makeRepoB() {
  const tenantId = "B";
  return { fetch: () => api.getOrders(tenantId) };
}

// ❌ JSON.stringify({ fetch: () => {} }) === "{}"
//    → repoA / repoB の hash が同一になり cache collision
useQuery({ queryKey: ['orders', makeRepoA()], queryFn: ... });
useQuery({ queryKey: ['orders', makeRepoB()], queryFn: ... });
```

`['orders', repoA]` と `['orders', repoB]` が同じ hash key に潰れ、後から実行された query の結果が前者を上書きする可能性がある。全件起きる漏洩ではなく、「先に fetch した結果が後で stub される」「stale 判定が混線する」など実害が発現するパスは状況依存。

maintainer (tkdodo) も「JSON.stringify できない値を渡したい場合は自前で `queryKeyHashFn` を実装する必要がある」と明言している ([TanStack/query Discussion #5098](https://github.com/TanStack/query/discussions/5098))。

### mode 3: identity loss (正しさ)

`Map` / `Set` は own enumerable property を持たないため `JSON.stringify` で `'{}'` に潰れる。`Date` は ISO 文字列に展開されるので衝突は起きないが、key としての意図 (瞬間 vs 範囲 vs 日付のみ) が表現されないまま文字列化される点に注意。

```typescript
// ❌ Map: JSON.stringify(new Map([['k','v']])) === '{}' → 識別性なし
useQuery({
  queryKey: ['users', new Map([['role', 'admin']])],
  queryFn: fetchUsers,
});

// ❌ Date: ISO 文字列化されて key になる。意図と乖離する場合がある
useQuery({
  queryKey: ['report', { from: new Date(2026, 0, 1), to: new Date(2026, 0, 31) }],
  queryFn: fetchReport,
});
```

## ✅ 改善後

```typescript
// ✅ mode 1: random / Date.now / generated UUID を queryKey から除外
const useOrders = (filters) =>
  useQuery({
    queryKey: ['orders', { filters }],  // sessionId / Date.now を含めない
    queryFn: fetchOrders,
  });

// ✅ mode 2: closure instance を queryKey に入れず、識別子だけ入れる
const useOrdersByRepo = (repo, tenantId) =>
  useQuery({
    queryKey: ['orders', { tenantId }],  // primitive のみ
    queryFn: () => repo.fetch(),
  });

// ✅ mode 3: Date は ISO 文字列、Map は plain object に変換してから key に
const useReport = (from, to) =>
  useQuery({
    queryKey: ['report', { from: from.toISOString(), to: to.toISOString() }],
    queryFn: fetchReport,
  });
```

**Query Key Factory パターン** ([Effective React Query Keys — tkdodo.eu](https://tkdodo.eu/blog/effective-react-query-keys)) を使うと primitive のみが key に乗りやすい構造に強制される。

```typescript
const orderKeys = {
  all: ['orders'] as const,
  lists: () => [...orderKeys.all, 'list'] as const,
  list: (filters: { tenantId: string; status?: string }) =>
    [...orderKeys.lists(), filters] as const,
  detail: (id: string) => [...orderKeys.all, 'detail', id] as const,
};

useQuery({ queryKey: orderKeys.list({ tenantId, status }), queryFn: ... });
```

## ベンチマーク

[計測ヘルパー](../../CONTRIBUTING.md#計測ヘルパー) は sync 用なので、本ベンチでは独自 harness を bench.ts 内に inline 定義する。実 cache library を import せず、TanStack Query v5 の hashKey と同じ「`JSON.stringify` + plain object key sort」を実装した `QueryCache` クラスを自前定義する (library 非依存のアルゴリズム軸を可視化するため)。

`expensiveFetch` は V8 JIT に畳まれて消えないよう、`process.hrtime()` 由来の不透明な seed + bitwise int 演算 + global sink への XOR escape で構築する (network 往復のコストを int-math loop で simulate)。

```typescript
class QueryCache {
  private readonly store = new Map<string, number>();

  hash(queryKey: unknown): string {
    return JSON.stringify(queryKey, (_k, val) =>
      val && typeof val === "object" && val.constructor === Object
        ? Object.keys(val as object).sort().reduce((o, k) => {
            (o as Record<string, unknown>)[k] = (val as Record<string, unknown>)[k];
            return o;
          }, {} as Record<string, unknown>)
        : val
    );
  }

  get(queryKey: unknown, fetchFn: () => number): number {
    const h = this.hash(queryKey);
    const cached = this.store.get(h);
    if (cached !== undefined) return cached;
    const value = fetchFn();
    this.store.set(h, value);
    return value;
  }
}

const FETCH_INNER_ITER = 50_000;
let GLOBAL_SINK = 0;
function expensiveFetch(): number {
  const seed = process.hrtime()[1];
  let s = seed | 0;
  for (let i = 0; i < FETCH_INNER_ITER; i++) s = ((s * 31) + i) | 0;
  GLOBAL_SINK ^= s;
  return s;
}

const N = 1_000;
const filters = { status: "open", page: 1 };

benchmark('❌ unstable key (cache always miss)', () => {
  const cache = new QueryCache();
  for (let i = 0; i < N; i++) {
    const sessionId = `${Math.random()}-${i}`;  // 毎回新規 → cache miss
    cache.get(["orders", { sessionId, filters }], expensiveFetch);
  }
});

benchmark('✅ stable key (1 miss + N-1 hits)', () => {
  const cache = new QueryCache();
  for (let i = 0; i < N; i++) {
    cache.get(["orders", { filters }], expensiveFetch);
  }
});
```

完成版の TypeScript 実装は本ディレクトリ同梱の [`bench.ts`](./bench.ts) を参照。N=100 / 1,000 / 10,000 の 3 段階計測、warmup (n を 64 に cap した上で 200 invocation)、DCE 回避 (`globalThis.__bench_sink` への escape)、median+p95+std 表示、mode 2/3 の hashKey collision 検証 (closure-only instance / Map / Set の unique hash count) を含む。

**実行前提**:

- **Node v22.6 以上** (`--experimental-strip-types` で .ts 直実行が可能になったバージョン)。v22.0–22.5 では `npx tsx bench.ts` または `tsc` でトランスパイル後実行する
- 起動例: `node --experimental-strip-types --no-warnings bench.ts`

## 実測値（参考）

`bench.ts` を `node --experimental-strip-types --no-warnings bench.ts` で実行した結果 (warmup 200 invocations、fetch_cost = 50,000 int op):

| 条件 | unstable median ± std (ms) | stable median ± std (ms) | median 倍率 |
|---|---|---|---|
| n=100 / Node v24.14.1 / V8 13.6 / darwin arm64 / Apple M5 Pro | 22.60 ± 0.368 | 0.272 ± 0.015 | **83.0×** |
| n=1,000 / 同上 | 48.86 ± 2.46 | 0.548 ± 0.060 | **89.2×** |
| n=10,000 / 同上 | 472.0 ± 5.17 | 6.54 ± 0.946 | **72.1×** |

mode 2/3 の hashKey collision 検証 (n=1,000):

| シナリオ | unique hash 数 / 試行回数 | 期待 |
|---|---|---|
| mode 2 (closure-only instance) | 1 / 1,000 | 1 (全 instance が `'{}'` に潰れて cache collision) |
| mode 3a (Map) | 1 / 1,000 | 1 |
| mode 3b (Set) | 1 / 1,000 | 1 |
| `JSON.stringify({fetch: () => {}})` | `'{}'` | `'{}'` |

- 理論比は `(N × fetch_cost) / (fetch_cost + N × lookup_cost) ≈ N` (lookup が fetch に比べて十分小さいとき)。実測は warmup 後の lookup overhead や fetch 内部の int-math 速度で N 倍より小さく出る。Apple M5 Pro では int-math が高速で fetch コストが圧縮されるため、Issue 本文の Node v20 (251× @ n=1,000) より倍率が低い (89.2× @ n=1,000)。それでも 9× 掲載基準を約 10 倍超過。
- p95/median は全条件で < 2 で外れ値支配なし。
- 数値は実行環境・ハードウェアで変わる。「Node v24 / V8 13.6 / n=1,000 / fetch_cost=50,000 で約 89× の median speedup を観測」のように engine・version・n・fetch_cost を必ず併記し、単一値の断言 (「9× である」等) はしない。

## 注意・例外

- **plain object を直接渡すのは安全**: TanStack Query の deterministic hashing は plain object の key 順序を sort で吸収する。`{a:1,b:2}` と `{b:2,a:1}` は同じ hash。filter object を直接 queryKey に入れること自体はアンチパターンではない ([公式 docs](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys))
- **Vue Query は reactive properties を自動 tracking する**: `ref` / `computed` を queryKey に含めると `toValue()` 経由で値が展開される。React 版にはこの自動安定化機構がない ([Vue Reactivity — TanStack Query](https://tanstack.com/query/latest/docs/framework/vue/reactivity))
- **Apollo Client** は cache key を `__typename:id` で normalize する経路と、operation variables の serialization 経路が分離している。本パターンは後者にのみ該当
- **SWR は 1.1.0 以降で object key を auto-serialize する**。それ以前は shallow compare で reference に依存していた ([SWR — Arguments](https://swr.vercel.app/docs/arguments))
- **意図的に毎回 refetch したい場合** (例: 時刻依存の rate 計算) は `staleTime: 0` + `refetchInterval` を使うのが筋。queryKey に時刻を入れない
- **fetch コストが極端に安いとき (in-memory selector 等) は倍率が小さくなる**: 本パターンの倍率は `N × fetch_cost` 対 `fetch_cost + N × lookup_cost` の比なので、fetch がほぼ無コスト (memoized selector 等) なら lookup overhead が支配的になって倍率が縮む。実害は「重い fetch をループ内で繰り返す場合」に最大化する

## 他ライブラリでの同等パターン

| ライブラリ | cache key serialize | 同パターンの起き方 |
|---|---|---|
| **TanStack Query v5** | [`hashKey`: JSON.stringify + sort](https://github.com/TanStack/query/blob/main/packages/query-core/src/utils.ts) | 本パターンが扱う事例 |
| **SWR ≥ 1.1.0** | [object key を auto-serialize](https://swr.vercel.app/docs/arguments) | 関数を key にすると closure 変数の変化が反映されない ([vercel/swr #611](https://github.com/vercel/swr/issues/611)) |
| **RTK Query** | [`serializeQueryArgs`: sort + stringify + endpoint 名連結](https://redux-toolkit.js.org/rtk-query/api/createApi) | 関数 / closure-only instance を args にすると collision |
| **Apollo Client** | operation variables の文字列化 (cache normalization とは別経路) | 毎回新 variables object でも値が同じなら hit、関数を含めると壊れる |
| **urql** | [`hash(GraphQL document + variables)`](https://nearform.com/open-source/urql/docs/basics/document-caching/) | document AST が安定参照前提、variables は serialize 経路 |

横断的結論: **serialize-based hash を採用するすべてのクライアントキャッシュで、不安定な値や hashKey 衝突を起こす値を key に渡すと壊れる**。アルゴリズム的問題でありフレームワークの API 設計選択ではない。

## 参考

引用 Tier は [docs/primary-sources.md](../../docs/primary-sources.md) 体系に従う (Tier 1: 公式 / spec、Tier 2: engine team、Tier 3: 信頼性ある二次、Tier 4: 理論)。本パターンは library 公式 docs / source / maintainer 解説が主要根拠で、V8 / ECMA-262 直結ではないため Tier 3 が中心。

- **Tier 3**: [Query Keys — TanStack Query Documentation (React)](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys) — deterministic hashing の公式仕様説明
- **Tier 3**: [TanStack/query — query-core/src/utils.ts `hashKey`](https://github.com/TanStack/query/blob/main/packages/query-core/src/utils.ts) — JSON.stringify + plain object key sort の実装
- **Tier 3**: [TanStack/query Discussion #4079 — Infinite loop when queryKey property changes](https://github.com/TanStack/query/discussions/4079) — mode 1 の実害報告
- **Tier 3**: [TanStack/query Discussion #5098 — How to set correct queryKey for pre-memoized queryFn](https://github.com/TanStack/query/discussions/5098) — maintainer による `queryKeyHashFn` 推奨
- **Tier 3**: [Effective React Query Keys — tkdodo.eu](https://tkdodo.eu/blog/effective-react-query-keys) — Query Key Factory パターン
- **Tier 3**: [SWR — Arguments](https://swr.vercel.app/docs/arguments) — SWR 1.1.0 以降の auto-serialize 仕様
- **Tier 3**: [RTK Query — createApi (serializeQueryArgs)](https://redux-toolkit.js.org/rtk-query/api/createApi) — RTK Query の serialize 仕様
- **Tier 3**: [Apollo Client — Cache Configuration](https://www.apollographql.com/docs/react/caching/cache-configuration) — Apollo の cache normalization 経路
- **Tier 3**: [urql — Document Caching](https://nearform.com/open-source/urql/docs/basics/document-caching/) — urql の hash 仕様
- **Tier 3**: [Vue Reactivity — TanStack Query Documentation](https://tanstack.com/query/latest/docs/framework/vue/reactivity) — Vue Query の auto-tracking 仕様
- [カテゴリ解説: 重複処理 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#重複処理)
- [Issue #13](https://github.com/824ysuk/benchmark-antipatterns/issues/13) — 本パターンの元提案 (3 失敗モードの詳細・他ライブラリ比較表・実害事例)
