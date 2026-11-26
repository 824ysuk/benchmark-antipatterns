# ループ内 線形探索

**カテゴリ**: [計算量の無駄](../../docs/bottleneck-types.md#計算量の無駄)\
**計算量の変化**: 最悪 O(nm) → 平均 O(n+m)（ハッシュ実装、入力が n 件と m 件）\
**実測改善比**: 64.8×（n=10,000、下記の計測環境）

## 問題

> Big-O 記法の前提は [docs/performance-basics.md](../../docs/performance-basics.md) を参照。

ユーザー n 件ごとに注文 m 件を先頭から検索すると、該当なしや末尾でのヒットでは最悪 O(nm) になる。

ハッシュベースの Map を一度構築すれば、平均 O(n+m) 時間と追加 O(m) 空間で処理できる。ECMAScript の要件は平均で要素数に対して劣線形のアクセス時間。

## ❌ アンチパターン

```typescript
for (const user of users) {
  const order = orders.find(o => o.userId === user.id); // 最悪 O(m)
  results.push(order ?? null);
}
```

## ✅ 改善後

Map を 1 回だけ構築し、ループ内は O(1) ルックアップに置き換える。

```typescript
const orderMap = new Map();
for (const order of orders) {
  if (!orderMap.has(order.userId)) orderMap.set(order.userId, order);
}
for (const user of users) {
  results.push(orderMap.get(user.id) ?? null);            // O(1) × n
}
```

## ベンチマーク

Node.js 22.18 以降で、リポジトリ直下から実行します。改善前後の結果が一致することを確認してから計測します。

```sh
node patterns/loop-linear-search/bench.ts
```

## 実測値（参考）

Apple M5 Pro、Docker の Linux arm64。Node.js 24.22.2（V8 13.6.233.17-node.63）と Node.js 22.23.4（V8 12.4.254.21-node.57）で各 2 回ウォームアップ + 10 回計測。

| Node.js・入力 | 改善前の中央値 ± 標準偏差 (ms) | 改善後の中央値 ± 標準偏差 (ms) | 中央値の比 |
|---|---:|---:|---:|
| 24.22.2、n=10,000 | 46.854 ± 2.854 | 0.723 ± 0.122 | 64.8× |
| 22.23.4、n=10,000 | 39.859 ± 1.907 | 0.608 ± 0.120 | 65.5× |

## 注意・例外

- 同一キーの最初の注文を保持すると `find` と同じ結果になる。複数件を返す `filter` の置き換えでは、キーごとに該当する全要素を保持する。例では整数または文字列の ID を想定する。
- 配列が小さい場合や先頭付近で常にヒットする場合は、索引構築コストが上回ることがある。
- `find` を 1 回だけ呼ぶ場合（ループ外）はアンチパターンではない

## 他言語での同等パターン

| 言語 | 索引に使う構造 | 備考 |
|---|---|---|
| Python | `dict` / `{k: v for ...}` | `list.index()` のループ内呼び出しが同じ問題 |
| Java | `HashMap` | `List.contains()` のループ内呼び出しが同じ問題 |
| Go | `map[K]V` | slice の range + linear search が同じ問題 |
| Ruby | `Hash` | `Array#find` のループ内呼び出しが同じ問題 |

## 参考

引用 Tier は [docs/primary-sources.md](../../docs/primary-sources.md) 体系に従う（Tier 1: 公式 / spec、Tier 2: engine team、Tier 3: 信頼性ある二次、Tier 4: 理論）。

- [ECMA-262 の配列探索と Map / Set](../../docs/primary-sources.md#javascript-の仕様と計測) — 比較規則と平均アクセス時間の仕様要件
- **Tier 4**: [Big-O Cheat Sheet](https://www.bigocheatsheet.com/) — Map / Set の O(1) ルックアップ理論
- **Tier 3**: [Loop Performance Anti-Patterns: 40-Repository Scan — stackinsight.dev](https://stackinsight.dev/blog/loop-performance-empirical-study) — 実コードベース 40 リポジトリでの出現頻度調査
- [カテゴリ解説: 計算量の無駄 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#計算量の無駄)
