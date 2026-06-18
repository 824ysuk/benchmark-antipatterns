# 01. ループ内 線形探索

**カテゴリ**: [計算量の無駄](../../docs/bottleneck-types.md#計算量の無駄)  
**計算量の変化**: O(n²) → O(n)  
**実測改善比**: 64×（n=10,000、参考値）

## 問題

> Big-O 記法の前提は [docs/performance-basics.md](../../docs/performance-basics.md) を参照。

配列の `find` / `filter` / `some` / `includes` は先頭から順に走査する O(n) 操作。これをループ内で呼ぶと、外側 n 回 × 内側 n 回の二重ループになり O(n²) になる。n=10,000 なら最大 **1 億回**の比較が走る。

Map はキーから値を O(1) で引けるハッシュ構造。事前に 1 回 Map を構築すれば、全体の計算量を O(n) に抑えられる。

## ❌ アンチパターン

```typescript
for (const user of users) {
  const order = orders.find(o => o.userId === user.id); // 毎回全走査 O(n)
  results.push(order ?? null);
}
```

## ✅ 改善後

Map を 1 回だけ構築し、ループ内は O(1) ルックアップに置き換える。

```typescript
const orderMap = new Map(orders.map(o => [o.userId, o])); // O(m) — 1 回だけ
for (const user of users) {
  results.push(orderMap.get(user.id) ?? null);            // O(1) × n
}
```

## ベンチマーク

[計測ヘルパー](../../CONTRIBUTING.md#計測ヘルパー)を先に実行してから以下を実行してください。

```javascript
const N = 10_000;
const orders = Array.from({ length: N }, (_, i) => ({ userId: i, data: 'x' }));
const users  = Array.from({ length: N }, (_, i) => ({ id: i }));

benchmark('❌ 線形探索', () => {
  const r = [];
  for (const u of users) r.push(orders.find(o => o.userId === u.id) ?? null);
});
benchmark('✅ Map 索引化', () => {
  const m = new Map(orders.map(o => [o.userId, o]));
  const r = [];
  for (const u of users) r.push(m.get(u.id) ?? null);
});
```

## 実測値（参考）

| 条件 | 改善前 | 改善後 | 倍率 |
|---|---|---|---|
| n = 10,000 | 61.9 ms | 0.95 ms | **64×** |

> 結果は実行環境・ハードウェアによって変わります。同じ環境で改善前後を比較することが重要です。

## 注意・例外

- 配列が小さい（n < 数百）場合は Map 構築コストが上回ることがある。プロファイルで確認してから適用する
- `find` を 1 回だけ呼ぶ場合（ループ外）はアンチパターンではない

## 他言語での同等パターン

| 言語 | O(n) 構造 | 備考 |
|---|---|---|
| Python | `dict` / `{k: v for ...}` | `list.index()` のループ内呼び出しが同じ問題 |
| Java | `HashMap` | `List.contains()` のループ内呼び出しが同じ問題 |
| Go | `map[K]V` | slice の range + linear search が同じ問題 |
| Ruby | `Hash` | `Array#find` のループ内呼び出しが同じ問題 |

## 参考

- [カテゴリ解説: 計算量の無駄 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#計算量の無駄) — 出典・引用を含む詳細解説
- [How to Avoid O(N²) — Tomoharu Tsutsumi](https://tomoharutsutsumi.medium.com/how-to-avoid-o-n%C2%B2-60eaa61f523a)
