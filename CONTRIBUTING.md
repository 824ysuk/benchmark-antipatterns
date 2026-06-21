# Contributing

パターンの追加・既存パターンの改善を歓迎します。

## 掲載基準

- 実測で **9× 以上**の改善が確認できること
- JIT / オプティマイザが自動吸収しないパターンであること
- 手元で動くベンチマークコードが添付されていること

### 掲載しないパターンの判定理由

以下に該当するパターンは掲載しません。個別の判定経緯・候補リスト・一次情報リンクは [Issue #12](https://github.com/824ysuk/benchmark-antipatterns/issues/12) に集約しています。

- **engine 実装が条件依存で吸収しうる** — monomorphic feedback / elements kind 安定 / callback inline 成立等の前提が揃った場合に倍率が消失するパターン (例: `forEach`、`filter().map()` chain)
- **engine 横断で値も向きも逆転する** — 同じ workload でも engine / version で速い側が逆になるパターン (例: `generator` vs `for` loop)
- **version-specific で portable でない** — 特定 engine 特定 version のバグ・例外で、修正済または engine 開発元が「specific version 向けに最適化するな」と明言しているパターン
- **9× 未達** — 教育的価値はあるが改善比が小さく本基準を満たさないパターン (例: spread 要素の位置依存 fast path、polymorphic IC の非線形劣化)
- **JIT 内部表現劣化系で 9× 構造的未達** — V8 hidden class / Elements Kinds の退化 (`delete` 演算子 / sparse 配列 / 動的プロパティ追加) は canonical な workload で 1.4-3.5× の constant factor 劣化にとどまり、9× 達成は pathological case (stub cache overflow 等) でのみ再現可能。V8 6.0+ fast path / `MigrateSlowToFast` / Swiss Table で engine 側の継続吸収も進行中 (3 ヶ月議論で 9× workload 発見に至らず 2026-06-21 [Issue #9](https://github.com/824ysuk/benchmark-antipatterns/issues/9) / [Issue #10](https://github.com/824ysuk/benchmark-antipatterns/issues/10) / [Issue #11](https://github.com/824ysuk/benchmark-antipatterns/issues/11) を scope 外として close)。JIT 内部理解は [docs/primary-sources.md](docs/primary-sources.md) Tier 1 (V8 公式) / Tier 2 (Mathias Bynens / Benedikt Meurer) を参照

## 追加手順

1. `patterns/slug/` ディレクトリを作成（番号なし・意味のあるスラッグのみ）
2. `patterns/slug/README.md` に以下の構造で記述
3. `README.md` のパターン一覧テーブルに 1 行追加し、`#` 列に通し番号を振る
4. PR を送る

## パターン README のテンプレート

```markdown
# パターン名

**カテゴリ**: <根本原因カテゴリ>
**計算量の変化**: <改善前 → 改善後>
**実測改善比**: <N×（条件）>

## 問題

<なぜ遅いかの根本原因を 2〜3 文で>

## ❌ アンチパターン

\`\`\`typescript
// コード
\`\`\`

## ✅ 改善後

<改善の考え方を 1 文で>

\`\`\`typescript
// コード
\`\`\`

## ベンチマーク

<計測ヘルパーを先に実行してから以下を実行してください>

\`\`\`javascript
// ベンチマークコード
\`\`\`

## 実測値（参考）

| 条件 | engine / version | n | 改善前 | 改善後 | 倍率 |
|---|---|---|---|---|---|
| <条件> | Node vX.Y / V8 Z.W | X | Y ms | Z ms | **N×** |

> 結果は実行環境・ハードウェアによって変わります。同じ環境で改善前後を比較することが重要です。
> 単一値での倍率断言（「9× である」等）はせず、engine / version / workload / n を必ず併記してください。記載例は [loop-unshift の実測値ブロック](../loop-unshift/README.md#実測値参考) を参照。

## 注意・例外

<このアンチパターンが実は正しい選択になるケースがあれば記述>

## 参考

引用 Tier は [docs/primary-sources.md](../../docs/primary-sources.md) 体系に従う（Tier 1: 公式 / spec、Tier 2: engine team、Tier 3: 信頼性ある二次、Tier 4: 理論）。

- **Tier N**: [タイトル](URL) — 説明
- [カテゴリ解説: <カテゴリ> — docs/bottleneck-types.md](../../docs/bottleneck-types.md#<カテゴリ>)
```

## 計測ヘルパー

各ベンチマークコードを実行する前に、ブラウザの DevTools Console または Node.js（v16+）で定義してください。

これは **sync 関数向けの最小実装** で、warmup・DCE 回避・p95/std を持たない教材用です。async pattern（DB query / network / cache / `await` ループ系）や DB / 外部 process 系（bash + psql 等）では各パターンの bench 実装が inline で独自 harness を持ちます。

```javascript
function benchmark(label, fn, iterations = 10) {
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`[${label}] 中央値: ${median.toFixed(2)}ms（${iterations} 回計測）`);
  return median;
}
```

warmup（JIT tier 到達狙い）/ DCE 回避（`globalThis.__bench_sink` への escape）/ median + p95 + std 出力が必要な場合は、各パターンの bench 実装を参照してください。

- sync + warmup + p95/std を含む参照実装: [patterns/loop-unshift/bench.ts](patterns/loop-unshift/bench.ts)
- async (Node + Prisma + inline async harness): [patterns/orm-eager-loading-explosion/](patterns/orm-eager-loading-explosion/)
- 不安定 cache key の inline async (process.hrtime + sink escape): [patterns/unstable-cache-key/](patterns/unstable-cache-key/)
- 外部 process (bash + psql + EXPLAIN ANALYZE): [patterns/postgres-seq-scan/](patterns/postgres-seq-scan/)

実測値を README に書く際は、Node version / V8 version / n / iterations を必ず併記し、単一値の倍率断言（「9× である」等）を避けてください。
