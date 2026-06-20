# reduce + スプレッド

**カテゴリ**: [計算量の無駄](../../docs/bottleneck-types.md#計算量の無駄)  
**計算量の変化**: O(n²) → O(n)  
**実測改善比**: 1,128×（n=1,000）

## 問題

> Big-O 記法の前提は [docs/performance-basics.md](../../docs/performance-basics.md) を参照。

`reduce` の中で `{...acc, [key]: value}` を使うと、各ステップで `acc` 全プロパティをコピーする。1 回目は 1 プロパティ、2 回目は 2 プロパティ、…、n 回目は n プロパティをコピーするため、総コピー数は `n(n+1)/2 = O(n²)` になる。

`reduce` の初期値として渡した新規オブジェクトは呼び出し元に渡っていないため、直接変更（ミューテーション）しても副作用はない。これを利用して O(n) で実装できる。

## ❌ アンチパターン

```typescript
const result = items.reduce((acc, item) => ({
  ...acc,                    // acc 全体をコピー → O(n²)
  [item.name]: item.value,
}), {});
```

## ✅ 改善後

`reduce` の初期値オブジェクトを直接変更する。

```typescript
const result = items.reduce((acc, item) => {
  acc[item.name] = item.value; // 直接変更 — O(n)
  return acc;
}, {} as Record<string, string>);
```

## 計測環境

- Node.js: v24.14.1（`node -v`）
- V8: 13.6.233.17-node.44（`node -p process.versions.v8`）
- OS / CPU: macOS / Apple Silicon

## ベンチマーク

[計測ヘルパー](../../CONTRIBUTING.md#計測ヘルパー)を先に実行してから以下を実行してください。

```javascript
const N = 1_000;
const items = Array.from({ length: N }, (_, i) => ({ name: `key${i}`, value: i }));

benchmark('❌ reduce + spread', () => {
  items.reduce((acc, item) => ({ ...acc, [item.name]: item.value }), {});
}, { warmup: 200, iterations: 20 });
benchmark('✅ reduce + mutate', () => {
  items.reduce((acc, item) => { acc[item.name] = item.value; return acc; }, {});
}, { warmup: 200, iterations: 20 });
```

## 実測値（参考）

| 条件 | 改善前 | 改善後 | 倍率 |
|---|---|---|---|
| n = 100（warmup 200, iter 20） | 0.07 ms | 0.002 ms | **42×** |
| n = 500（warmup 200, iter 20） | 3.64 ms | 0.011 ms | **335×** |
| n = 1,000（warmup 200, iter 20） | 24.1 ms | 0.021 ms | **1,128×** |

> 結果は実行環境・ハードウェアによって変わります。上記「計測環境」と同じ条件で改善前後を比較することが重要です。

## 注意・例外

- **外部に渡ってきた `acc` を変更してはいけない**。`reduce` の初期値として自分で `{}` を渡している場合のみ安全。引数として受け取ったオブジェクトを `reduce` の `acc` に渡している場合は呼び出し元への副作用が発生する
- イミュータブルなデータ構造が必須の文脈（Redux state 等）では ❌ のパターンが正しい選択。パフォーマンスより正確性を優先する

## 同等パターン（配列の `concat`）

```javascript
// ❌ Array.concat in loop — O(n²)
items.reduce((acc, item) => acc.concat([item.value]), []);

// ✅ push に置き換え — O(n)
items.reduce((acc, item) => { acc.push(item.value); return acc; }, []);

// ✅ または flatMap / map を使う — O(n)
items.map(item => item.value);
```

## 参考

- [カテゴリ解説: 計算量の無駄 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#計算量の無駄) — 出典・引用を含む詳細解説
- [The reduce spread Anti-Pattern — Rich Snapp](https://www.richsnapp.com/article/2019/06-09-reduce-spread-anti-pattern) — V8 バイトコードレベルの解説
