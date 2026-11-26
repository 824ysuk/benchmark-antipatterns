# ループ内 includes → Set

**カテゴリ**: [計算量の無駄](../../docs/bottleneck-types.md#計算量の無駄)\
**計算量の変化**: 最悪 O(nm) → 平均 O(n+m)（ハッシュ実装、入力が n 件と m 件）\
**実測改善比**: 125.0×（n=10,000、下記の計測環境）

## 問題

> Big-O 記法の前提は [docs/performance-basics.md](../../docs/performance-basics.md) を参照。

n 件それぞれを長さ m の許可リストで検索すると、最悪 O(nm) になる。

ハッシュベースの Set を一度構築すれば、平均 O(n+m) 時間と追加 O(m) 空間で処理できる。ECMAScript の要件は平均で劣線形のアクセス時間。`includes` と `Set.has` はどちらも SameValueZero で比較する。

> **パターン「ループ内 線形探索」との違い**: 根本原因は同じ O(n²)。`includes` はプリミティブの**メンバーシップ確認**（Set で解決）、`find` はオブジェクトの**プロパティ引き当て**（Map で解決）という使い分け。

## ❌ アンチパターン

```typescript
for (const item of items) {
  if (allowList.includes(item.role)) { // 最悪 O(m)
    results.push(item);
  }
}
```

## ✅ 改善後

Set を 1 回だけ構築し、ループ内は O(1) の `has` に置き換える。

```typescript
const allowSet = new Set(allowList); // O(m) — 1 回だけ
for (const item of items) {
  if (allowSet.has(item.role)) {     // O(1) × n
    results.push(item);
  }
}
```

## ベンチマーク

Node.js 22.18 以降で、リポジトリ直下から実行します。改善前後の結果が一致することを確認してから計測します。

```sh
node patterns/loop-includes-to-set/bench.ts
```

## 実測値（参考）

Apple M5 Pro、Docker の Linux arm64。Node.js 24.22.2（V8 13.6.233.17-node.63）と Node.js 22.23.4（V8 12.4.254.21-node.57）で各 2 回ウォームアップ + 10 回計測。

| Node.js・入力 | 改善前の中央値 ± 標準偏差 (ms) | 改善後の中央値 ± 標準偏差 (ms) | 中央値の比 |
|---|---:|---:|---:|
| 24.22.2、n=10,000 | 67.032 ± 4.065 | 0.536 ± 0.078 | 125.0× |
| 22.23.4、n=10,000 | 56.814 ± 1.651 | 0.584 ± 0.142 | 97.3× |

## 注意・例外

- 配列が小さい（n < 数百）場合は Set 構築コストが上回ることがある
- `allowList` がループごとに変わる場合は Set の事前構築が使えない
- `includes` を 1 回だけ呼ぶ場合（ループ外）はアンチパターンではない

## 他言語での同等パターン

| 言語 | O(1) 構造 | 備考 |
|---|---|---|
| Python | `set` | `if x in list` のループ内呼び出しが同じ問題 |
| Java | `HashSet` | `List.contains()` のループ内呼び出しが同じ問題 |
| Go | `map[K]struct{}` | slice の range + linear search が同じ問題 |
| Ruby | `Set` | `Array#include?` のループ内呼び出しが同じ問題 |

## 参考

引用 Tier は [docs/primary-sources.md](../../docs/primary-sources.md) 体系に従う（Tier 1: 公式 / spec、Tier 2: engine team、Tier 3: 信頼性ある二次、Tier 4: 理論）。

- [ECMA-262 の配列探索と Map / Set](../../docs/primary-sources.md#javascript-の仕様と計測) — 比較規則と平均アクセス時間の仕様要件
- **Tier 4**: [Big-O Cheat Sheet](https://www.bigocheatsheet.com/) — Set の O(1) メンバーシップ確認の理論
- **Tier 3**: [Loop Performance Anti-Patterns: 40-Repository Scan — stackinsight.dev](https://stackinsight.dev/blog/loop-performance-empirical-study) — 実コードベース 40 リポジトリでの出現頻度調査
- [カテゴリ解説: 計算量の無駄 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#計算量の無駄)
