# Contributing

パターンの追加・既存パターンの改善を歓迎します。

## 掲載基準

- 実測で **9× 以上**の改善が確認できること
- JIT / オプティマイザが自動吸収しないパターンであること
- 手元で動くベンチマークコードが添付されていること

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

## 計測環境

- Node.js: vXX.Y.Z（`node -v`）
- V8: A.B.C（`node -p process.versions.v8`）
- OS / CPU（任意）: macOS / Apple Silicon 等

## ベンチマーク

<計測ヘルパーを先に実行してから以下を実行してください。warmup を入れたい場合は第 3 引数に `{ warmup: N }` を渡してください>

\`\`\`javascript
// ベンチマークコード
\`\`\`

## 実測値（参考）

| 条件 | 改善前 | 改善後 | 倍率 |
|---|---|---|---|
| n = X | Y ms | Z ms | **N×** |

> 結果は実行環境・ハードウェアによって変わります。上記「計測環境」と同じ条件で改善前後を比較することが重要です。

## 注意・例外

<このアンチパターンが実は正しい選択になるケースがあれば記述>

## 参考

- [タイトル](URL)
```

## 計測ヘルパー

各ベンチマークコードを実行する前に、ブラウザの DevTools Console または Node.js（v16+）で定義してください。

```javascript
function benchmark(label, fn, options = 10) {
  // 後方互換: 数値が来たら iterations として扱う
  const { iterations = 10, warmup = 0 } =
    typeof options === 'number' ? { iterations: options } : options;
  // warmup（JIT を温める。戻り値は __bench_sink に書いて DCE を抑止）
  for (let i = 0; i < warmup; i++) globalThis.__bench_sink = fn();
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    globalThis.__bench_sink = fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`[${label}] 中央値: ${median.toFixed(2)}ms（${iterations} 回、warmup ${warmup} 回）`);
  return median;
}
```

> このヘルパーは「コピペで動く」教材用途を優先しています。時間バジェット型（指定秒数まで自動で iter 数を増やす）・p95・RME など本格的な統計が必要な場合は [tinybench](https://github.com/tinylibs/tinybench) を検討してください。
