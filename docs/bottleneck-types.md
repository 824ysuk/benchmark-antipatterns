# ボトルネック 4 カテゴリ

このリポジトリのパターンは、根本原因が異なる 4 カテゴリに分類されます。ROOT README のカテゴリ列と、各パターン README の `カテゴリ:` メタデータはここにリンクされています。引用付きの一次情報もここに集約しています。

---

## 判別フロー

コードレビュー時に「これはどのカテゴリか」を判断する 4 つの問い:

1. **ループの内側に O(n) 操作（配列の全走査・オブジェクトのコピー）があるか？** → [計算量の無駄](#計算量の無駄)
2. **ループの内側に `await` があり、処理が独立しているか？** → [非同期の直列化](#非同期の直列化)
3. **ループ変数に依存しない処理を毎回実行しているか？** → [重複処理](#重複処理)
4. **middleware / plugin / index 等の登録順序に依存して silent に機能が抜けるか？** → [構成順序](#構成順序)

---

## 計算量の無駄

**定義**: ループの内側で O(n) 操作を呼び出し、全体が O(n²) になるパターン。

**メンタルモデル**: 「内側の走査を Map / Set / 事前計算で O(1) に潰せないか」

### 検出シグナル

コードレビュー時にこれらが `for` ループの内側にあれば要注意:

| シグナル | 代替 |
|---|---|
| `.find(fn)` / `.filter(fn)` / `.some(fn)` / `.includes(x)` / `.indexOf(x)` | ループ外で `Map` / `Set` を構築して O(1) ルックアップに |
| `reduce` 内の `{...acc, [key]: val}` | `acc[key] = val` で直接変更（初期値オブジェクトへの変更は安全） |
| `reduce` 内の `acc.concat([item])` | `acc.push(item)` で直接変更 |

### 該当パターン

- [ループ内 線形探索](../patterns/loop-linear-search/) — `find` をループ内で呼び O(n²)、Map 構築で O(n) に改善。改善比 **64×**（n=10,000）
- [ループ内 includes → Set](../patterns/loop-includes-to-set/) — `includes` をループ内で呼び O(n²)、Set 構築で O(n) に改善。改善比 **42.6×**（n=10,000）
- [reduce + スプレッド](../patterns/reduce-spread/) — `reduce` 内スプレッドが O(n²)、直接変更で O(n) に。改善比 **1,044×**（n=1,000）

### 一次情報

- [Big-O Cheat Sheet](https://www.bigocheatsheet.com/) — 各データ構造・操作の計算量リファレンス
- [The reduce spread Anti-Pattern — Rich Snapp](https://www.richsnapp.com/article/2019/06-09-reduce-spread-anti-pattern) — V8 バイトコードレベルで O(n²) になる理由の詳細解説
- [Loop Performance Anti-Patterns: 40-Repository Scan — stackinsight.dev](https://stackinsight.dev/blog/loop-performance-empirical-study) — 実コードベース 40 リポジトリでの出現頻度調査

---

## 非同期の直列化

**定義**: 独立した非同期処理を 1 件ずつ `await` し、合計待ち時間が n × latency になるパターン。

**メンタルモデル**: 「処理間の依存関係がないなら同時に開始できる。最も遅い 1 件分の時間だけかければよい」

### 検出シグナル

| シグナル | 代替 |
|---|---|
| `for...of` ループ内の `await fetchX()` | `await Promise.all(ids.map(id => fetchX(id)))` |
| `while (...) { await ... }` で独立した処理 | 同上 |

直列が**正しい選択**な場面（`Promise.all` にしてはいけない）は [sequential await](../patterns/sequential-await/#注意例外) を参照してください（前の結果への依存・レート制限・順序依存）。

### 該当パターン

- [sequential await](../patterns/sequential-await/) — O(n × latency) → O(max latency)。改善比 **75×**（n=100、latency=2ms）

### 一次情報

- [MDN: Promise.all()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all) — 並列実行のセマンティクスと注意点
- [Loop Performance Anti-Patterns: 40-Repository Scan — stackinsight.dev](https://stackinsight.dev/blog/loop-performance-empirical-study) — 非同期直列化パターンの実コードベースでの出現頻度

---

## 重複処理

**定義**: ループ変数に依存しない処理（loop-invariant）をループ内で毎回実行し、コストを n 倍にするパターン。別名: loop-invariant code motion の欠如。

**メンタルモデル**: 「この処理はループの外に出せるか？ 結果はループの途中で変わらないか？」

### 検出シグナル

| ループ内の処理 | 改善後 |
|---|---|
| `JSON.parse(固定文字列)` を毎回実行 | ループ外で 1 回パースして変数に保持 |
| `new RegExp(固定パターン)` を毎回構築 | ループ外で 1 回コンパイル |
| 定数の計算（`Math.sqrt(N)` 等） | ループ外の変数に保持 |
| DOM クエリ（`document.getElementById`）を毎回実行 | ループ外で参照を保持 |
| 同じ設定ファイルの読み込みを毎回実行 | ループ外でキャッシュ |

「ループ内の他パターン」の具体例一覧は [ループ内 JSON.parse — 同カテゴリの他パターン](../patterns/json-parse-in-loop/#同カテゴリの他パターンループ外移出) を参照してください。

### 該当パターン

- [ループ内 JSON.parse](../patterns/json-parse-in-loop/) — O(n × parse) → O(parse + n)。改善比 **46×**（n=100,000）

### 一次情報

- [Loop Performance Anti-Patterns: 40-Repository Scan — stackinsight.dev](https://stackinsight.dev/blog/loop-performance-empirical-study) — 重複処理（duplicated work）の章
- [Optimizing JavaScript — romgrk.com](https://romgrk.com/posts/optimizing-javascript) — V8 がループ不変式を自動で外に出さないケースの解説

---

## 構成順序

**定義**: middleware / plugin / 登録順依存の構造で、登録順序を間違えると silent に機能が無効化されるパターン。エラーも警告も出ず、レビューでも該当 API の呼び出し自体は存在するため見逃されやすい。

**メンタルモデル**: 「response cycle を終了する handler より下流に置いた wrapping middleware は通らない」「framework の linear chain では、wrap したい middleware は wrap 対象より上に置く」

### 検出シグナル

| シグナル | 改善後 |
|---|---|
| `app.use(compression())` が route handler / `express.static` より**後**に登録されている | 圧縮対象 route より**前**に登録 |
| `app.use(helmet())` で CSP を設定する route handler より**後**に登録されている | route handler より**前**に登録（ただし route 内で `res.setHeader` する場合は別途検討） |
| `app.use(express.static(...))` が `compression()` より**前**に登録されている | static asset を圧縮したいなら `compression()` を先に |

### 該当パターン

- [Express compression ordering](../patterns/express-compression-ordering/) — Express で `compression()` を route より後ろに `app.use()` して silent に egress 圧縮が無効化される。改善比 **25.76×** wire-size（1000 件 JSON、477,868 byte → 18,549 byte）

### 採用基準

このカテゴリは「silent failure」 + 「実測 9× 以上の改善」の二条件を併せて課す（[ADR 0001](decisions/0001-scope-extension-configuration-ordering.md) 参照）。エラー / 警告が出るタイプのフレームワーク設定ミスは対象外。

### 一次情報

- [Writing middleware — Express](https://expressjs.com/en/guide/writing-middleware.html) — middleware が登録順に実行され、response cycle 終了で後段が skip される仕組み
- [Using middleware — Express](https://expressjs.com/en/guide/using-middleware.html) — 「Express application は本質的に middleware function 呼び出しの連なり」
- [expressjs/compression — README](https://github.com/expressjs/compression) — 「simply `app.use` the module as high as you like」
- [expressjs/compression — `index.js` source](https://github.com/expressjs/compression/blob/master/index.js) — `res.write` / `res.end` を wrap して zlib にパイプする実装

---

## 新規パターンをどのカテゴリに分類するか

判別フローの 4 問を順に確認してください → [判別フロー](#判別フロー)

パターンの追加手順は [CONTRIBUTING.md](../CONTRIBUTING.md) を参照してください。
