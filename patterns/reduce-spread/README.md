# reduce + スプレッド

**カテゴリ**: [計算量の無駄](../../docs/bottleneck-types.md#計算量の無駄)\
**計算量の変化**: O(n²) → O(n)\
**実測改善比**: 252.5×（n=1,000、下記の計測環境）

## 問題

> Big-O 記法の前提は [docs/performance-basics.md](../../docs/performance-basics.md) を参照。

`reduce` の中で `{...acc, [key]: value}` を使うと、各ステップで `acc` 全プロパティをコピーする。すべてのキーが異なる場合、既存プロパティの総コピー数は 0 + 1 + … + (n−1) = n(n−1)/2。ユニークなキーが k 種類ならコピーの上界は O(nk) になる。

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

## ベンチマーク

Node.js 22.18 以降で、リポジトリ直下から実行します。改善前後の結果が一致することを確認してから計測します。

```sh
node patterns/reduce-spread/bench.ts
```

## 実測値（参考）

Apple M5 Pro、Docker の Linux arm64。Node.js 24.22.2（V8 13.6.233.17-node.63）と Node.js 22.23.4（V8 12.4.254.21-node.57）で各 2 回ウォームアップ + 10 回計測。 改善後の標準偏差は中央値の約 6 割で、倍率のばらつきに注意。

| Node.js・入力 | 改善前の中央値 ± 標準偏差 (ms) | 改善後の中央値 ± 標準偏差 (ms) | 中央値の比 |
|---|---:|---:|---:|
| 24.22.2、n=1,000 | 50.651 ± 4.962 | 0.201 ± 0.119 | 252.5× |
| 22.23.4、n=1,000 | 33.655 ± 2.153 | 0.140 ± 0.051 | 239.7× |

## 注意・例外

- **外部に渡ってきた `acc` を変更してはいけない**。`reduce` の初期値として自分で `{}` を渡している場合のみ安全。引数として受け取ったオブジェクトを `reduce` の `acc` に渡している場合は呼び出し元への副作用が発生する
- 公開済みの state は保持し、新規のローカルオブジェクトに組み立てて完成後に返す。
- 任意の文字列キーを扱う場合、通常オブジェクトへの代入とオブジェクトリテラルでのプロパティ定義には挙動差がある。`Object.fromEntries(items.map(item => [item.name, item.value]))` も比較候補になる。

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

引用 Tier は [docs/primary-sources.md](../../docs/primary-sources.md) 体系に従う（Tier 1: 公式 / spec、Tier 2: engine team、Tier 3: 信頼性ある二次、Tier 4: 理論）。

- [ECMA-262 のプロパティコピー](../../docs/primary-sources.md#javascript-の仕様と計測)
- **Tier 3**: [The reduce spread Anti-Pattern — Rich Snapp](https://www.richsnapp.com/article/2019/06-09-reduce-spread-anti-pattern) — V8 バイトコードレベルで O(n²) になる理由の詳細解説
- **Tier 3**: [Loop Performance Anti-Patterns: 40-Repository Scan — stackinsight.dev](https://stackinsight.dev/blog/loop-performance-empirical-study) — 実コードベース 40 リポジトリでの出現頻度調査
- [カテゴリ解説: 計算量の無駄 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#計算量の無駄)
