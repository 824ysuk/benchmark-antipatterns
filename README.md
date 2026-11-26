# benchmark-antipatterns

実測ベンチマーク付きのパフォーマンス・アンチパターン集。

1 パターン = 1 ディレクトリ。各パターンに、根本原因、改善前後のコード、実行手順、計測条件と結果を収録しています。

## なぜこの repo か

- **実測値付き**: 掲載基準は実測 9× 以上の改善が確認できるパターンのみ
- **ランタイムが吸収しないものだけ**: engine 実装が条件依存で吸収する / engine 横断で値も向きも逆転する / version-specific なパターンは除外
  - 例 (engine 実装が条件依存で吸収しうる): `forEach` vs `for` / `filter().map()` vs `reduce` / アロー関数 vs `function` 宣言
  - 例 (engine 横断で値も向きも逆転 / 非線形劣化 / position 依存): `generator` vs `for` ループ / megamorphic IC の非線形劣化 / spread 要素の位置依存 fast path
  - 例 (JIT 内部表現劣化で 9× 構造的未達): `delete` 演算子による fast properties → dictionary mode 転落、sparse 配列の Elements Kinds 劣化、動的プロパティ追加による hidden class 不一致
- **手元で検証できる**: 各パターンの手順からベンチマークを実行できる

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

| # | カテゴリ | パターン | 検出シグナル | 改善の考え方 | 実測値 |
|---|---|---|---|---|---|
| 1 | [計算量の無駄](docs/bottleneck-types.md#計算量の無駄) | [ループ内 線形探索](patterns/loop-linear-search/) | `for` + `.find/.filter/.some` | 最悪 O(nm) → 平均 O(n+m) | [実測値](patterns/loop-linear-search/#実測値参考) |
| 2 | [計算量の無駄](docs/bottleneck-types.md#計算量の無駄) | [ループ内 includes → Set](patterns/loop-includes-to-set/) | `for` + `.includes` | 最悪 O(nm) → 平均 O(n+m) | [実測値](patterns/loop-includes-to-set/#実測値参考) |
| 3 | [計算量の無駄](docs/bottleneck-types.md#計算量の無駄) | [reduce + スプレッド](patterns/reduce-spread/) | `reduce` 内 `{...acc, ...}` / `acc.concat(...)` | 全体コピーをやめて一度組み立てる | [実測値](patterns/reduce-spread/#実測値参考) |
| 4 | [非同期の直列化](docs/bottleneck-types.md#非同期の直列化) | [sequential await](patterns/sequential-await/) | `for...of` + `await` | 独立 I/O の待ち時間を重ねる | [実測値](patterns/sequential-await/#実測値参考) |
| 5 | [重複処理](docs/bottleneck-types.md#重複処理) | [ループ内 JSON.parse](patterns/json-parse-in-loop/) | `JSON.parse` / `new RegExp` をループ内 | 固定入力のパースを 1 回にまとめる | [実測値](patterns/json-parse-in-loop/#実測値参考) |
| 6 | [計算量の無駄](docs/bottleneck-types.md#計算量の無駄) | [ループ内 unshift](patterns/loop-unshift/) | `for` + `.unshift` | 後ろに追加して最後に逆順にする | [実測値](patterns/loop-unshift/#実測値参考) |
| 7 | [計算量の無駄](docs/bottleneck-types.md#計算量の無駄) | [ORM ネスト include のカルテシアン爆発](patterns/orm-eager-loading-explosion/) | 関連読み込みの SQL で行の増幅や反復走査が多い | DB 側の関連集約とテーブル別取得を比較する | [実測値](patterns/orm-eager-loading-explosion/#実測値参考) |
| 8 | [計算量の無駄](docs/bottleneck-types.md#計算量の無駄) | [PostgreSQL seq scan](patterns/postgres-seq-scan/) | `EXPLAIN` で `Seq Scan`、返す行はごく少数 | 少数件の検索を B-tree で絞る | [実測値](patterns/postgres-seq-scan/#実測値参考) |
| 9 | [重複処理](docs/bottleneck-types.md#重複処理) | [不安定な cache key による cache miss 永続化](patterns/unstable-cache-key/) | 同じデータに毎回異なるキーが付く | 同じデータに同じキーを使う | [実測値](patterns/unstable-cache-key/#実測値参考) |

## 根本原因 3 カテゴリ

詳細・引用付き解説は [docs/bottleneck-types.md](docs/bottleneck-types.md) を参照。

| カテゴリ | 一言 | 該当パターン |
|---|---|---|
| [計算量の無駄](docs/bottleneck-types.md#計算量の無駄) | 走査、コピー、結合などで必要以上のデータを処理する | 1, 2, 3, 6, 7, 8 |
| [非同期の直列化](docs/bottleneck-types.md#非同期の直列化) | 独立した非同期処理を 1 件ずつ待って合計待ち時間が n 倍になる | 4 |
| [重複処理](docs/bottleneck-types.md#重複処理) | 同じ入力やデータに対する処理を繰り返す | 5, 9 |

## リポジトリ内の探し方

- `patterns/<slug>/` に解説、ベンチマーク、必要なデータ設定があります。実行コマンドは各 README にあります。
- `docs/` に基礎、原因から探すガイド、出典、[掲載候補の調査表](docs/coverage.md) があります。
- `scripts/bench.ts` は一部の同期ベンチマークが使う計測ヘルパーです。
- 追加・更新の手順は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## 参考リソース

仕様、公式文書、実装に関する解説を [出典一覧](docs/primary-sources.md) に掲載しています。
