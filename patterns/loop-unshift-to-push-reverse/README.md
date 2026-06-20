# ループ内 unshift → push + reverse

**カテゴリ**: [計算量の無駄](../../docs/bottleneck-types.md#計算量の無駄)  
**計算量の変化**: O(n²) → O(n)  
**実測改善比**: 117×（n=10,000、参考値）

## 問題

> Big-O 記法の前提は [docs/performance-basics.md](../../docs/performance-basics.md) を参照。

`Array.prototype.unshift` は配列の先頭に要素を挿入するため、既存全要素を 1 つずつ後方にずらす O(n) 操作。これをループ内で呼ぶと外側 n 回 × 内側の要素シフトで全体が O(n²) になる。

末尾追加 `push` は O(1) amortized（V8 は backing store を約 1.5 倍 + 16 で幾何拡張）。「先頭に積みたい」だけなら `push` で末尾に積んで最後に 1 回 `reverse` すれば全体 O(n) になる。

> **パターン「ループ内 線形探索 / ループ内 includes → Set」との違い**: 前者 2 つは read-side の O(n) スキャンを Map / Set で O(1) 化する。本パターンは write-side の要素シフトを「処理順の反転」（push + reverse）で O(n) 化する。代替データ構造ではなく処理順を変える点が異なる。

## ❌ アンチパターン

```typescript
// 古い順に届いたログを「新しい順」に並べ替えたいケース
const newestFirst: LogEntry[] = [];
for (const entry of source) {
  newestFirst.unshift(entry); // 毎回 O(newestFirst.length) の要素シフト
}
// N=10,000 で内部的に約 5×10^7 要素分のシフトが発生する
```

## ✅ 改善後

末尾に push して最後に 1 回 reverse する。全体 O(n)。

```typescript
const newestFirst: LogEntry[] = [];
for (const entry of source) {
  newestFirst.push(entry); // amortized O(1)
}
newestFirst.reverse();     // in-place O(n)
```

reverse すら不要なら逆順ループで `push` する（最少コピー）。

```typescript
const newestFirst: LogEntry[] = [];
for (let i = source.length - 1; i >= 0; i--) {
  newestFirst.push(source[i]);
}
```

ループ中に先頭挿入と末尾追加・index 参照が混在する場合は自前 Deque（circular buffer）を使う。詳細は [Issue #7](https://github.com/824ysuk/benchmark-antipatterns/issues/7) §3 C 案を参照。

## ベンチマーク

[計測ヘルパー](../../CONTRIBUTING.md#計測ヘルパー)を先に実行してから以下を実行してください。

```javascript
const N = 10_000;
globalThis.__bench_sink = undefined; // DCE 回避

benchmark('❌ ループ内 unshift', () => {
  const arr = [];
  for (let i = 0; i < N; i++) arr.unshift(i);
  globalThis.__bench_sink = arr;
});
benchmark('✅ push + reverse', () => {
  const arr = [];
  for (let i = 0; i < N; i++) arr.push(i);
  arr.reverse();
  globalThis.__bench_sink = arr;
});
```

## 実測値（参考）

| 条件 | 改善前 | 改善後 | 倍率 |
|---|---|---|---|
| n = 10,000（Node.js v24.14 / V8 13.6） | 4.22 ms | 0.04 ms | **117×** |

> 結果は実行環境・ハードウェア・Node.js / V8 バージョンによって変わります。同じ環境で改善前後を比較することが重要です。

## 注意・例外

- 配列が小さい（n < 数百）と差は定数倍に埋もれる。プロファイルで確認してから適用する
- 「先頭追加」自体が正しい設計（タイムライン逆順表示・操作履歴の最新優先・FIFO エンキュー）の場合、`push + reverse` への置換は semantics を壊す。N の規模に応じて自前 Deque を検討する
- 自前 Deque は組み込み `Array` の memmove より定数倍遅いことが多い。中規模（数千〜数万）かつ両端操作が混在しない限り `push + reverse` のほうが速いことが多い
- ブラウザ engine では挙動が異なる場合がある（JavaScriptCore は `ArrayStorage::m_indexBias` で amortized O(1) 化する歴史的経路を持つ）。本実測値は Node.js (V8) 前提

## 他言語での同等パターン

| 言語 | O(n) 構造（アンチ） | O(1) 構造（推奨） |
|---|---|---|
| Python | `list.insert(0, x)` | `collections.deque.appendleft` |
| Java | `ArrayList.add(0, x)` | `ArrayDeque.addFirst` |
| Go | `append([]T{x}, s...)` | `container/list` |
| C# | `List.Insert(0, x)` | `LinkedList.AddFirst` |
| Ruby | `Array#unshift` | （標準 Deque 同等なし、`Array#push` + `Array#reverse` 推奨）|

## 参考

- [カテゴリ解説: 計算量の無駄 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#計算量の無駄)
- [ECMA-262 §23.1.3.37 Array.prototype.unshift](https://tc39.es/ecma262/#sec-array.prototype.unshift) — 先頭挿入で全要素を後方シフトする loop アルゴリズム
- [ECMA-262 §23.1.3.23 Array.prototype.push](https://tc39.es/ecma262/#sec-array.prototype.push) — 末尾書き込みのみ
- [V8 blog: Elements kinds in V8](https://v8.dev/blog/elements-kinds) — backing store と elements kind の解説
- [Issue #7](https://github.com/824ysuk/benchmark-antipatterns/issues/7) — engine 横断挙動・fast-path 条件・Tier 別 一次情報の深掘り
