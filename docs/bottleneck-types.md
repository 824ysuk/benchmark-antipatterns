# ボトルネック 3 カテゴリ

このリポジトリのパターンは、根本原因が異なる 3 カテゴリに分類されます。ROOT README のカテゴリ列と、各パターン README の `カテゴリ:` メタデータはここにリンクされています。引用付きの一次情報は [docs/primary-sources.md](primary-sources.md) に Tier 別 (Tier 1: 公式 / spec、Tier 2: engine team、Tier 3: 信頼性ある二次、Tier 4: 理論) で集約されています。本ページの各カテゴリ末尾「### 一次情報」節は hub の該当 URL へ Tier 表記付きで誘導する形に統一されています。

---

## 判別フロー

コードレビュー時に「これはどのカテゴリか」を判断する 3 つの問い:

1. **繰り返し走査、増え続けるコピー、JOIN による行の増幅などで余分なデータを処理しているか？** → [計算量の無駄](#計算量の無駄)
2. **ループの内側に `await` があり、処理が独立しているか？** → [非同期の直列化](#非同期の直列化)
3. **同じ入力や論理的に同じデータに対する処理を繰り返しているか？** → [重複処理](#重複処理)

---

## 計算量の無駄

**定義**: 同じ結果に対して余分な走査、コピー、結合や集約が発生するパターン。

**メンタルモデル**: 「内側の走査を Map / Set / 事前計算で O(1) に潰せないか」

### 検出シグナル

コードレビューや実行計画で確認できるシグナル:

| シグナル | 代替 |
|---|---|
| `.find(fn)` / `.filter(fn)` / `.some(fn)` / `.includes(x)` / `.indexOf(x)` | 同じ比較規則を保つ `Map` / `Set` をループ外で構築する |
| `reduce` 内の `{...acc, [key]: val}` | 処理内に閉じた accumulator に書き込む。任意キーの代入に注意する |
| `reduce` 内の `acc.concat([item])` | `acc.push(item)` で直接変更 |
| 関連データの取得で大量の重複行や反復走査 | 実行計画を確認し、関連キーの索引とテーブル別取得を比較する |
| 配列先頭への `.unshift()` の繰り返し | `push` + 最後に `reverse`、または逆順構築 |
| `EXPLAIN ANALYZE` で少数件を返すクエリが大量の行を走査 | 検索条件に合う索引を検討し、推定行数、実測行数、バッファを確認する |

### 該当パターン

- [ループ内 線形探索](../patterns/loop-linear-search/) — n 件から m 件を繰り返し探す最悪 O(nm) の処理を、ハッシュ索引で平均 O(n+m) に改善。
- [ループ内 includes → Set](../patterns/loop-includes-to-set/) — n 件を m 件の許可リストで照合する最悪 O(nm) の処理を、ハッシュ索引で平均 O(n+m) に改善。
- [reduce + スプレッド](../patterns/reduce-spread/) — `reduce` 内スプレッドが O(n²)、直接変更で O(n) に。
- [ORM ネスト include のカルテシアン爆発](../patterns/orm-eager-loading-explosion/) — 平坦な JOIN の行増幅と、Prisma の関連集約における反復走査を区別する。
- [ループ内 unshift](../patterns/loop-unshift/) — 先頭挿入が要素全シフトで O(n²)、push + reverse で O(n) に改善。
- [PostgreSQL seq scan](../patterns/postgres-seq-scan/) — index 不在 column への point lookup が O(n) seq scan、B-tree index 追加で O(log n) に。

### 一次情報

詳細な Tier 別 URL リストは [docs/primary-sources.md](primary-sources.md) を参照。本カテゴリで主に参照するのは:

- **Tier 4**: [Big-O Cheat Sheet](https://www.bigocheatsheet.com/) — 計算量リファレンス
- **Tier 3**: [richsnapp.com — reduce-spread](https://www.richsnapp.com/article/2019/06-09-reduce-spread-anti-pattern) — V8 バイトコードレベル解説
- **Tier 3**: [stackinsight.dev — 40-repository scan](https://stackinsight.dev/blog/loop-performance-empirical-study) — 実コードベース調査

各 URL の Tier 区分・引用上の注意・撤回情報は hub を参照してください。

---

## 非同期の直列化

**定義**: 独立した非同期処理を 1 件ずつ `await` し、待ち時間が各処理の待ち時間の合計になるパターン。

**メンタルモデル**: 「処理間に依存がなく、同時に処理できる余力があれば、待ち時間を重ねられる」

### 検出シグナル

| シグナル | 代替 |
|---|---|
| `for...of` ループ内の `await fetchX()` | `await Promise.all(ids.map(id => fetchX(id)))` |
| `while (...) { await ... }` で独立した処理 | 同上 |

直列が**正しい選択**な場面（`Promise.all` にしてはいけない）は [sequential await](../patterns/sequential-await/#注意例外) を参照してください（前の結果への依存・レート制限・順序依存）。

### 該当パターン

- [sequential await](../patterns/sequential-await/) — 十分な同時実行枠がある場合に、独立した I/O の待ち時間を重ねる。

### 一次情報

詳細な Tier 別 URL リストは [docs/primary-sources.md](primary-sources.md) を参照。本カテゴリで主に参照するのは:

- **Tier 3**: [MDN: Promise.all()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all) — 並列実行のセマンティクス
- **Tier 3**: [stackinsight.dev — 40-repository scan](https://stackinsight.dev/blog/loop-performance-empirical-study) — 非同期直列化パターンの実コードベース調査

各 URL の Tier 区分・引用上の注意・撤回情報は hub を参照してください。

---

## 重複処理

**定義**: 同じ入力や論理的に同じデータに対する処理を繰り返すパターン。固定入力の計算を外に出す方法と、安定したキーで結果を再利用する方法がある。

**メンタルモデル**: 「この処理はループの外に出せるか？ 結果はループの途中で変わらないか？」

### 検出シグナル

| ループ内の処理 | 改善後 |
|---|---|
| `JSON.parse(固定文字列)` を毎回実行 | ループ外で 1 回パースして変数に保持 |
| `new RegExp(固定パターン)` を毎回構築 | ループ外で 1 回コンパイル |
| 定数の計算（`Math.sqrt(N)` 等） | ループ外の変数に保持 |
| DOM クエリ（`document.getElementById`）を毎回実行 | ループ外で参照を保持 |
| 同じ設定ファイルの読み込みを毎回実行 | ループ外でキャッシュ |
| 同じデータなのに毎回異なる query key で cache miss | 結果に影響する入力とキャッシュの適用範囲をキーに反映する |

「ループ内の他パターン」の具体例一覧は [ループ内 JSON.parse — 同カテゴリの他パターン](../patterns/json-parse-in-loop/#同カテゴリの他パターンループ外移出) を参照してください。

### 該当パターン

- [ループ内 JSON.parse](../patterns/json-parse-in-loop/) — O(n × parse) → O(parse + n)。
- [不安定な cache key による cache miss 永続化](../patterns/unstable-cache-key/) — O(n × fetch) → O(fetch + n)。

### 一次情報

詳細な Tier 別 URL リストは [docs/primary-sources.md](primary-sources.md) を参照。本カテゴリで主に参照するのは:

- **Tier 3**: [stackinsight.dev — 40-repository scan](https://stackinsight.dev/blog/loop-performance-empirical-study) — 重複処理（duplicated work）の章
- **Tier 3**: [romgrk.com — optimizing-javascript](https://romgrk.com/posts/optimizing-javascript) — V8 がループ不変式を自動で外に出さないケースの解説 (補助参照)

各 URL の Tier 区分・引用上の注意・撤回情報は hub を参照してください。

---

## 新規パターンをどのカテゴリに分類するか

判別フローの 3 問を順に確認してください → [判別フロー](#判別フロー)

パターンの追加手順は [CONTRIBUTING.md](../CONTRIBUTING.md) を参照してください。
