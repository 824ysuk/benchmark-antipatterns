# sequential await

**カテゴリ**: [非同期の直列化](../../docs/bottleneck-types.md#非同期の直列化)\
**待ち時間のモデル**: Σ Lᵢ → max(Lᵢ) + 起動・集約コスト\
**実測改善比**: 99.9×（n=100、下記の計測環境）

## 問題

> カテゴリの詳細解説は [docs/bottleneck-types.md#非同期の直列化](../../docs/bottleneck-types.md#非同期の直列化) を参照。

`await` は Promise が解決するまで次の行に進めない「待機ゲート」。`for...of` ループの中で `await` を使うと、1 件ずつ順番に待つ直列処理になる。n=100・latency=2ms なら合計 **200ms** かかる。

`map` が独立した I/O を順に開始し、`Promise.all` が完了をまとめて待つ。開始と集約には n 件分の処理がある。各 I/O の待ちを十分に重ねられる条件では、I/O 待ち時間は最も遅い 1 件に近づく。

## ❌ アンチパターン

```typescript
const results = [];
for (const id of ids) {
  results.push(await fetchItem(id)); // 1 件ずつ順番に待つ
}
```

## ✅ 改善後

依存関係がない処理はすべて同時に開始する。

```typescript
const results = await Promise.all(ids.map(id => fetchItem(id)));
```

## ベンチマーク

Node.js 22.18 以降で、リポジトリ直下から実行します。タイマーで独立した I/O 待ちを模擬し、両方式で結果の順序を確認します。

```sh
node patterns/sequential-await/bench.ts
```

## 実測値（参考）

Apple M5 Pro、Docker の Linux arm64。Node.js 24.22.2（V8 13.6.233.17-node.63）と Node.js 22.23.4（V8 12.4.254.21-node.57）で各 2 回ウォームアップ + 10 回計測。

| Node.js・入力 | 改善前の中央値 ± 標準偏差 (ms) | 改善後の中央値 ± 標準偏差 (ms) | 中央値の比 |
|---|---:|---:|---:|
| 24.22.2、n=100 | 299.969 ± 0.763 | 3.001 ± 0.366 | 99.9× |
| 22.23.4、n=100 | 300.194 ± 1.802 | 2.979 ± 0.171 | 100.8× |

## 注意・例外

以下の場合は直列処理が**正しい選択**:

- **前の結果に依存する場合**: `const b = await fetchB(a.id)` のように次の呼び出しが前の結果を必要とするとき
- **レート制限がある場合**: API に同時リクエスト数の制限がある場合は直列化または `p-limit` 等で並列数を制御する
- **順序が重要な場合**: 結果配列は入力順を保つ。副作用の順序は保証しない。
- **失敗時の扱い**: `Promise.all` は最初の拒否で reject し、開始済みの処理は続く。失敗以降の呼び出しを抑えたいときは、逐次処理かキャンセルの設計が必要。

変更前に必ず処理間の依存関係を確認する。

## 他言語での同等パターン

| 言語 | 並列化の手段 |
|---|---|
| Python | `asyncio.gather(*[fetch(id) for id in ids])` |
| Go | goroutine + `sync.WaitGroup` または `errgroup` |
| Rust | `futures::future::join_all()` |
| C# | `Task.WhenAll(ids.Select(id => FetchItemAsync(id)))` |

## 参考

引用 Tier は [docs/primary-sources.md](../../docs/primary-sources.md) 体系に従う（Tier 1: 公式 / spec、Tier 2: engine team、Tier 3: 信頼性ある二次、Tier 4: 理論）。

- [ECMA-262 の Promise.all](../../docs/primary-sources.md#javascript-の仕様と計測)
- **Tier 3**: [MDN: Promise.all()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all) — 並列実行のセマンティクス・rejection・iterable・結果順序
- **Tier 3**: [Loop Performance Anti-Patterns: 40-Repository Scan — stackinsight.dev](https://stackinsight.dev/blog/loop-performance-empirical-study) — 非同期直列化パターンの実コードベース調査
- [カテゴリ解説: 非同期の直列化 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#非同期の直列化)
