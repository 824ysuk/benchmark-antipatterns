# benchmark-antipatterns

実測ベンチマーク付きのパフォーマンス・アンチパターン集。

1 パターン = 1 ディレクトリ。各パターンに「根本原因 / ❌ コード / ✅ 改善後 / 手元で動くベンチマーク / 実測値」を揃える。

## なぜこの repo か

- **実測値付き**: 掲載基準は実測 9× 以上の改善が確認できるパターンのみ
- **ランタイムが吸収しないものだけ**: JIT / オプティマイザが自動最適化するパターンは除外（例: `forEach` vs `for`、`filter().map()` vs `reduce`）
- **手元で検証できる**: 各パターンにコピー&ペーストで動くベンチマークコードを添付

## スコープ

**対象**: アルゴリズム・レベルのパターン

- 計算量の無駄（O(n²) → O(n)）
- 非同期処理の直列化
- ループ内での不変処理の繰り返し

**対象外**: フレームワーク固有の最適化・ネットワーク・メモリ管理・React 最適化

## パターン一覧

| # | カテゴリ | パターン | 計算量の変化 | 改善比（参考） |
|---|---|---|---|---|
| 1 | 計算量の無駄 | [ループ内 線形探索](patterns/01-loop-linear-search/) | O(n²) → O(n) | 64×（n=10,000） |
| 2 | 計算量の無駄 | [reduce + スプレッド](patterns/02-reduce-spread/) | O(n²) → O(n) | 1,044×（n=1,000） |
| 3 | 非同期の直列化 | [sequential await](patterns/03-sequential-await/) | O(n×latency) → O(max latency) | 75×（n=100） |
| 4 | 重複処理 | [ループ内 JSON.parse](patterns/04-json-parse-in-loop/) | O(n×parse) → O(parse+n) | 46×（n=100,000） |

## 根本原因 3 カテゴリ

| カテゴリ | 一言 | 該当パターン |
|---|---|---|
| 計算量の無駄 | ループの中で O(n) 操作を繰り返し O(n²) にしてしまう | 1, 2 |
| 非同期の直列化 | 独立した非同期処理を 1 件ずつ待って合計待ち時間が n 倍になる | 3 |
| 重複処理 | ループ内の変数に依存しない処理を毎回実行してコストを n 倍にする | 4 |

## 各パターンの最小スキーマ

新規パターンを追加するときは以下の構造で書く:

```
カテゴリ: <根本原因カテゴリ>
計算量の変化: <改善前 → 改善後>
❌ アンチパターン: <コード>
✅ 改善後: <コード>
ベンチマーク: <手元で動くコード>
実測値: <表>
注意: <このパターンが正しい選択になる例外ケース>
```

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## 参考リソース

- [Loop Performance Anti-Patterns: 40-Repository Scan — stackinsight.dev](https://stackinsight.dev/blog/loop-performance-empirical-study) — 実測データの主要出典
- [The reduce spread Anti-Pattern — Rich Snapp](https://www.richsnapp.com/article/2019/06-09-reduce-spread-anti-pattern) — reduce スプレッドの V8 バイトコードレベルの解説
- [Optimizing JavaScript — romgrk.com](https://romgrk.com/posts/optimizing-javascript) — V8 内部最適化の詳細
- [Big-O Cheat Sheet](https://www.bigocheatsheet.com/) — 計算量リファレンス
