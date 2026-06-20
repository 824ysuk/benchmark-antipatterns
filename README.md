# benchmark-antipatterns

実測ベンチマーク付きのパフォーマンス・アンチパターン集。

1 パターン = 1 ディレクトリ。各パターンに「根本原因 / ❌ コード / ✅ 改善後 / 手元で動くベンチマーク / 実測値」を揃える。

## なぜこの repo か

- **実測値付き**: 掲載基準は実測 9× 以上の改善が確認できるパターンのみ
- **ランタイムが吸収しないものだけ**: engine 実装が条件依存で吸収する / engine 横断で値も向きも逆転する / version-specific なパターンは除外
  - 例 (engine 実装が条件依存で吸収しうる): `forEach` vs `for` / `filter().map()` vs `reduce` / アロー関数 vs `function` 宣言
  - 例 (engine 横断で値も向きも逆転 / 非線形劣化 / position 依存): `generator` vs `for` ループ / megamorphic IC の非線形劣化 / spread 要素の位置依存 fast path
  - 個別の判定理由は [Issue #12](https://github.com/824ysuk/benchmark-antipatterns/issues/12) を参照
- **手元で検証できる**: 各パターンにコピー&ペーストで動くベンチマークコードを添付

## スコープ

**対象**: アルゴリズム・レベルのパターン

- 計算量の無駄（O(n²) → O(n)）
- 非同期処理の直列化
- ループ内での不変処理の繰り返し
- アルゴリズム的問題で、ベンチ再現にミドルウェア層（DB エンジン等）を要するもの

**対象外**: フレームワーク固有の最適化・ネットワーク・メモリ管理・React 最適化

## 前提知識

Big-O 記法と「なぜループが遅いか」を知らない方は、まず以下を読んでください。

- [docs/performance-basics.md](docs/performance-basics.md) — Big-O 記法と実行時間が増える理屈
- [docs/bottleneck-types.md](docs/bottleneck-types.md) — 3 カテゴリの解説とパターン navigation

## パターン一覧

| # | カテゴリ | パターン | 検出シグナル | 計算量の変化 | 改善比（参考） |
|---|---|---|---|---|---|
| 1 | [計算量の無駄](docs/bottleneck-types.md#計算量の無駄) | [ループ内 線形探索](patterns/loop-linear-search/) | `for` + `.find/.filter/.some` | O(n²) → O(n) | 64×（n=10,000） |
| 2 | [計算量の無駄](docs/bottleneck-types.md#計算量の無駄) | [ループ内 includes → Set](patterns/loop-includes-to-set/) | `for` + `.includes` | O(n²) → O(n) | 42.6×（n=10,000） |
| 3 | [計算量の無駄](docs/bottleneck-types.md#計算量の無駄) | [reduce + スプレッド](patterns/reduce-spread/) | `reduce` 内 `{...acc, ...}` / `acc.concat(...)` | O(n²) → O(n) | 1,044×（n=1,000） |
| 4 | [非同期の直列化](docs/bottleneck-types.md#非同期の直列化) | [sequential await](patterns/sequential-await/) | `for...of` + `await` | O(n×latency) → O(max latency) | 75×（n=100） |
| 5 | [重複処理](docs/bottleneck-types.md#重複処理) | [ループ内 JSON.parse](patterns/json-parse-in-loop/) | `JSON.parse` / `new RegExp` をループ内 | O(n×parse) → O(parse+n) | 46×（n=100,000） |
| 6 | [計算量の無駄](docs/bottleneck-types.md#計算量の無駄) | [ループ内 unshift](patterns/loop-unshift/) | `for` + `.unshift` | O(n²) → O(n) | 207.8×（n=10,000） |
| 7 | [計算量の無駄](docs/bottleneck-types.md#計算量の無駄) | [ORM ネスト include のカルテシアン爆発](patterns/orm-eager-loading-explosion/) | ORM の `include` / `eager_load` を to-many 2 段以上ネスト | O(n×m×l) → O(n+m+l) | 41×（Prisma 6 + PG） |

## 根本原因 3 カテゴリ

詳細・引用付き解説は [docs/bottleneck-types.md](docs/bottleneck-types.md) を参照。

| カテゴリ | 一言 | 該当パターン |
|---|---|---|
| [計算量の無駄](docs/bottleneck-types.md#計算量の無駄) | ループの中で O(n) 操作を繰り返し O(n²) にしてしまう | 1, 2, 3 |
| [非同期の直列化](docs/bottleneck-types.md#非同期の直列化) | 独立した非同期処理を 1 件ずつ待って合計待ち時間が n 倍になる | 4 |
| [重複処理](docs/bottleneck-types.md#重複処理) | ループ内の変数に依存しない処理を毎回実行してコストを n 倍にする | 5 |

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

カテゴリ別の引用付き解説は [docs/bottleneck-types.md](docs/bottleneck-types.md) を参照。引用付きの一次情報 URL は **[docs/primary-sources.md](docs/primary-sources.md)** に Tier 別 (Tier 1: 公式 / spec、Tier 2: engine team、Tier 3: 信頼性ある二次、Tier 4: 理論) で集約しています。

主に参照される一次情報の抜粋:

- **Tier 1 (V8 公式)**: [v8.dev/blog](https://v8.dev/blog/) (elements-kinds / fast-properties / maglev 等) / [v8.dev/docs/hidden-classes](https://v8.dev/docs/hidden-classes)
- **Tier 1 (ECMA-262)**: [tc39.es/ecma262](https://tc39.es/ecma262/) — `push` / `unshift` 等の仕様
- **Tier 2 (V8 team member)**: [mathiasbynens.be — shapes-ics](https://mathiasbynens.be/notes/shapes-ics) / [benediktmeurer.de](https://benediktmeurer.de/2018/03/23/v8-tup-2-0/)
- **Tier 3 (信頼性ある二次)**: [stackinsight.dev — 40-repository scan](https://stackinsight.dev/blog/loop-performance-empirical-study) / [richsnapp.com — reduce-spread](https://www.richsnapp.com/article/2019/06-09-reduce-spread-anti-pattern) / [romgrk.com — optimizing-javascript](https://romgrk.com/posts/optimizing-javascript)
- **Tier 4 (理論)**: [Big-O Cheat Sheet](https://www.bigocheatsheet.com/) (詳細は [docs/performance-basics.md](docs/performance-basics.md)) / CLRS §17.4 (amortized analysis)

各 URL の Tier 区分・撤回情報・主題 → 根拠 URL 早見表は hub を参照してください。

### 補足学習ノート（パターン非該当・3 カテゴリ非該当）

- [docs/element-kinds-note.md](docs/element-kinds-note.md) — V8 Element Kinds の機構解説・`%DebugPrint` 機械検証手順・実測値（パターン化見送り [#10](https://github.com/824ysuk/benchmark-antipatterns/issues/10) の代替動線として保全。新規追加基準は本書冒頭の callout を参照）
