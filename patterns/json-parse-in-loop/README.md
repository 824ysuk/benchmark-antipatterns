# ループ内 JSON.parse

**カテゴリ**: [重複処理](../../docs/bottleneck-types.md#重複処理)\
**計算量の変化**: O(n × parse) → O(parse + n)\
**実測改善比**: 112.1×（n=100,000、下記の計測環境）

## 問題

> カテゴリの詳細解説は [docs/bottleneck-types.md#重複処理](../../docs/bottleneck-types.md#重複処理) を参照。

`JSON.parse` は毎回「字句解析 → オブジェクト構築 → メモリ確保」を実行する重い処理。同じ JSON 文字列をループ内でパースすると、ループ変数に依存しない処理を n 回繰り返すことになる。

ループ外で 1 回だけパースして変数に保持すれば、パース 1 回と n 件の参照を合わせて O(parse + n) になる。

## ❌ アンチパターン

```typescript
for (const key of keys) {
  const config = JSON.parse(jsonString); // 毎回パース — O(n × parse)
  results.push(config[key]);
}
```

## ✅ 改善後

ループ外で 1 回だけパースする。

```typescript
const config = JSON.parse(jsonString); // 1 回だけ — O(parse)
for (const key of keys) {
  results.push(config[key]);           // O(1) × n
}
```

## ベンチマーク

Node.js 22.18 以降で、リポジトリ直下から実行します。改善前後の結果が一致することを確認してから計測します。

```sh
node patterns/json-parse-in-loop/bench.ts
```

## 実測値（参考）

Apple M5 Pro、Docker の Linux arm64。Node.js 24.22.2（V8 13.6.233.17-node.63）と Node.js 22.23.4（V8 12.4.254.21-node.57）で各 2 回ウォームアップ + 10 回計測。

| Node.js・入力 | 改善前の中央値 ± 標準偏差 (ms) | 改善後の中央値 ± 標準偏差 (ms) | 中央値の比 |
|---|---:|---:|---:|
| 24.22.2、n=100,000 | 275.499 ± 5.978 | 2.458 ± 0.528 | 112.1× |
| 22.23.4、n=100,000 | 261.773 ± 15.636 | 1.375 ± 0.177 | 190.3× |

## 注意・例外

- ループごとに異なる JSON 文字列をパースする場合はこのパターンが適用できない（ループ変数に依存しているため）
- パース結果の可変オブジェクトを返す場合は、反復ごとの独立した参照が必要か確認する。
- ループが空のとき元の処理はパースしない。構文エラーの発生有無も維持する必要がある場合は、初回反復でパースする。

## 同カテゴリの他パターン（ループ外移出）

| ループ内の処理 | 改善後 |
|---|---|
| `new RegExp(pattern)` を毎回構築 | ループ外で 1 回コンパイル |
| 定数の計算（`Math.sqrt(N)` 等） | ループ外の変数に保持 |
| DOM クエリ（`document.getElementById`） | ループ外で参照を保持 |
| 同じ設定ファイルの読み込み | ループ外でキャッシュ |

## 他言語での同等パターン

| 言語 | 同じ問題が起きる例 |
|---|---|
| Python | `json.loads(s)` をループ内で繰り返す |
| Go | `regexp.MustCompile(pattern)` をループ内で繰り返す |
| Java | `Pattern.compile(regex)` をループ内で繰り返す |
| Ruby | `JSON.parse(str)` をループ内で繰り返す |

## 参考

引用 Tier は [docs/primary-sources.md](../../docs/primary-sources.md) 体系に従う（Tier 1: 公式 / spec、Tier 2: engine team、Tier 3: 信頼性ある二次、Tier 4: 理論）。

- **Tier 3**: [Loop Performance Anti-Patterns: 40-Repository Scan — stackinsight.dev](https://stackinsight.dev/blog/loop-performance-empirical-study) — 重複処理（duplicated work）の章
- [ECMA-262 の JSON.parse](../../docs/primary-sources.md#javascript-の仕様と計測)
- **Tier 3**: [Optimizing JavaScript — romgrk.com](https://romgrk.com/posts/optimizing-javascript) — V8 がループ不変式を自動で外に出さないケースの解説
- [カテゴリ解説: 重複処理 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#重複処理)
