# ループ内 JSON.parse

**カテゴリ**: [重複処理](../../docs/bottleneck-types.md#重複処理)  
**計算量の変化**: O(n × parse) → O(parse + n)  
**実測改善比**: 46×（n=100,000、参考値）

## 問題

> カテゴリの詳細解説は [docs/bottleneck-types.md#重複処理](../../docs/bottleneck-types.md#重複処理) を参照。

`JSON.parse` は毎回「字句解析 → オブジェクト構築 → メモリ確保」を実行する重い処理。同じ JSON 文字列をループ内でパースすると、ループ変数に依存しない処理を n 回繰り返すことになる。

ループ外で 1 回だけパースして変数に保持すれば、コストは O(parse × 1) に下がる。

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

[計測ヘルパー](../../CONTRIBUTING.md#計測ヘルパー)を先に実行してから以下を実行してください。

```javascript
const N = 100_000;
const obj = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key${i}`, i]));
const jsonString = JSON.stringify(obj);
const keys = Array.from({ length: N }, (_, i) => `key${i % 100}`);

benchmark('❌ ループ内 parse', () => {
  const r = [];
  for (const key of keys) { const c = JSON.parse(jsonString); r.push(c[key]); }
});
benchmark('✅ ループ外 parse', () => {
  const c = JSON.parse(jsonString);
  const r = [];
  for (const key of keys) r.push(c[key]);
});
```

## 実測値（参考）

| 条件 | 改善前 | 改善後 | 倍率 |
|---|---|---|---|
| n = 100,000 | 123.4 ms | 2.53 ms | **46×** |

> 結果は実行環境・ハードウェアによって変わります。同じ環境で改善前後を比較することが重要です。

## 注意・例外

- ループごとに異なる JSON 文字列をパースする場合はこのパターンが適用できない（ループ変数に依存しているため）
- `JSON.parse` の結果を変更する場合は毎回パースが必要なケースもある（参照の共有に注意）

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
- **Tier 3**: [Optimizing JavaScript — romgrk.com](https://romgrk.com/posts/optimizing-javascript) — V8 がループ不変式を自動で外に出さないケースの解説
- [カテゴリ解説: 重複処理 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#重複処理)
