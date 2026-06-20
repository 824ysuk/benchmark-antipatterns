# ループ内 includes → Set

**カテゴリ**: [計算量の無駄](../../docs/bottleneck-types.md#計算量の無駄)  
**計算量の変化**: O(n²) → O(n)  
**実測改善比**: 42.6×（n=10,000、参考値）

## 問題

> Big-O 記法の前提は [docs/performance-basics.md](../../docs/performance-basics.md) を参照。

`Array.includes` は先頭から順に走査する O(n) 操作。これをループ内で呼ぶと外側 n 回 × 内側 n 回の二重ループになり O(n²) になる。

`Set` はハッシュ構造で O(1) の存在確認ができる。事前に 1 回 Set を構築すれば全体の計算量を O(n) に抑えられる。

> **パターン「ループ内 線形探索」との違い**: 根本原因は同じ O(n²)。`includes` はプリミティブの**メンバーシップ確認**（Set で解決）、`find` はオブジェクトの**プロパティ引き当て**（Map で解決）という使い分け。

## ❌ アンチパターン

```typescript
for (const item of items) {
  if (allowList.includes(item.role)) { // 毎回全走査 O(n)
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

[計測ヘルパー](../../CONTRIBUTING.md#計測ヘルパー)を先に実行してから以下を実行してください。

```javascript
const N = 10_000;
const allowList = Array.from({ length: N }, (_, i) => `role_${i}`);
const items     = Array.from({ length: N }, (_, i) => ({ role: `role_${(i * 2) % N}` }));

benchmark('❌ Array.includes ループ', () => {
  const r = [];
  for (const item of items) {
    if (allowList.includes(item.role)) r.push(item);
  }
});
benchmark('✅ Set.has ループ', () => {
  const s = new Set(allowList);
  const r = [];
  for (const item of items) {
    if (s.has(item.role)) r.push(item);
  }
});
```

## 実測値（参考）

| 条件 | 改善前 | 改善後 | 倍率 |
|---|---|---|---|
| n = 10,000 | 11.84 ms | 0.28 ms | **42.6×** |

> 結果は実行環境・ハードウェアによって変わります。同じ環境で改善前後を比較することが重要です。

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

- **Tier 4**: [Big-O Cheat Sheet](https://www.bigocheatsheet.com/) — Set の O(1) メンバーシップ確認の理論
- **Tier 3**: [Loop Performance Anti-Patterns: 40-Repository Scan — stackinsight.dev](https://stackinsight.dev/blog/loop-performance-empirical-study) — 実コードベース 40 リポジトリでの出現頻度調査
- [カテゴリ解説: 計算量の無駄 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#計算量の無駄)
