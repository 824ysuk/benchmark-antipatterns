# V8 Element Kinds 学習ノート

> 本書はパターンではなく学習ノート。本 repo の掲載基準 (実測 9× 以上 / JIT 非吸収 / 手元で動くベンチ / アルゴリズム層) のうち (a) 9× を構造的に満たせないため [`patterns/`](../patterns/) には含めない。一方で機構解説・kind 機械検証手順・実測値整理は将来 (i) hot path で 9× を達成する workload が発見された場合、(ii) CONTRIBUTING.md 9× 基準が改訂された場合、(iii) [docs/bottleneck-types.md](./bottleneck-types.md) に新カテゴリが追加された場合 (Issue [#11](https://github.com/824ysuk/benchmark-antipatterns/issues/11)) の出発点として保全する。
>
> **学習ノート枠の濫用防止 (新規追加基準)**: 本書は exceptional treatment であり repo の defaults ではない。「9× 未達なら `docs/<topic>-note.md` で保全」を標準動線として運用しない。`docs/<topic>-note.md` の新規追加は **(i)** pattern として 9× 未達 **かつ (ii)** V8 公式 docs / ECMA-262 / engine team member 公開資料等の **一次情報を verbatim 引用可能** **かつ (iii)** 機構解説に独立した学習価値がある (本 repo の 3 カテゴリ判別フローに該当しない engine 内部表現の理解、など) 場合に限る。3 条件を満たさない 9× 未達 Issue は学習ノートではなく Issue コメント / decision log で記録する。

## 背景

V8 は同じ `Array` オブジェクトでも、その瞬間の中身に応じて内部表現を **Element Kind** という分類で管理し、builtin (`reduce` / `map` / `filter` / `forEach` 等) を kind 単位で特殊化された fast path にディスパッチする。Kind は 2 軸からなる lattice を下方向にのみ遷移する。

- **specificity 軸**: `SMI` (31bit 整数 tagged) → `DOUBLE` (unboxed Float64 を `FixedDoubleArray` に raw double で格納) → 汎用 `ELEMENTS` (任意の JS 値、`HeapObject*` を保持)
- **density 軸**: `PACKED` (穴なし) → `HOLEY` (穴あり)

[V8 公式 verbatim](https://v8.dev/blog/elements-kinds):

> elements kind transitions only go in one direction: from specific (e.g. PACKED_SMI_ELEMENTS) to more general (e.g. PACKED_ELEMENTS)

> Once a hole is created in an array, it's marked as holey forever, even when you fill it later.

### `fill` 例外 (2025-02-28 Update)

[Chromium CL 6285929](https://chromium-review.googlesource.com/c/v8/v8/+/6285929) で `Array.prototype.fill` のみ HOLEY → PACKED 復帰経路が明示的に追加された。それ以外の埋め戻し (`for` ループ代入・`copyWithin` 等) はこの例外に含まれない。

## 機械検証手順 (`%DebugPrint`)

V8 native API を `node --allow-natives-syntax` で有効化し、`eval` 経由で関数化することで `%DebugPrint(arr)` が呼べる。

```javascript
// run: node --allow-natives-syntax probe.js
const debugPrint = eval('(function(x) { return %DebugPrint(x); })');
const a = [1, 2, 3];
debugPrint(a);
// stdout に "elements kind: PACKED_SMI_ELEMENTS" などが出力される
```

`HasFastElements` / `HasDictionaryElements` も同様に取得可能:

```javascript
const HasFastElements = eval('(function(x) { return %HasFastElements(x); })');
const HasDictionaryElements = eval('(function(x) { return %HasDictionaryElements(x); })');
```

## 観察済 kind 遷移 (Node v24.14.1 / V8 13.6.233.17)

| ケース | 操作 | 観察された kind |
|---|---|---|
| `new Array(N)` 事前確保 | `new Array(1000)` | `HOLEY_SMI_ELEMENTS` (空配列ではなく hole 配列) |
| sparse 代入 | `[1,2,3]; arr[100]=4` | `PACKED_SMI_ELEMENTS` → `HOLEY_SMI_ELEMENTS` |
| 穴を埋め戻す (`for`) | `for(i=0;i<6;i++) a[i]=i` | **`HOLEY_SMI` のまま** (戻らない) |
| `fill` で埋め戻す | `a.fill(0)` | **`HOLEY_SMI` → `PACKED_SMI`** (例外復帰) |
| 整数→浮動小数 | `[1,2,3].push(1.5)` | `PACKED_SMI` → `PACKED_DOUBLE` |
| 浮動小数→文字列 | `[1.5,2.5,3.5].push('x')` | `PACKED_DOUBLE` → `PACKED_ELEMENTS` |
| specificity 復帰 | 上記後 `a[0] = 1` | `PACKED_ELEMENTS` のまま (戻らない) |
| `push` 連鎖 | `for(i=0;i<1000;i++) a.push(i)` | `PACKED_SMI_ELEMENTS` 維持 |
| `Array.from` | `Array.from({length:1000}, (_,i)=>i)` | `PACKED_SMI_ELEMENTS` |
| `null`/`undefined` 代入 | `[1,2,3]; a[1]=undefined` | `PACKED_ELEMENTS` (oddball, hole にはならない) |

### DICTIONARY_ELEMENTS への遷移条件

`DICTIONARY_ELEMENTS` (hash table 化、slow elements) は **配列サイズと sparse 比率に依存**:

| 配列サイズ | 操作 | DICTIONARY 化 |
|---|---|---|
| n=100 | 95 個 `delete` | ❌ 未発生 (fast 維持) |
| n=10000 | 9990 個 `delete` | ✅ 発生 |
| n=10 → length 拡張 | `c[100000] = 1` (length=100001) | ✅ 発生 |
| 初期化のみ | `new Array(1e8)` | ✅ 発生 |
| 直接 sparse | `[]; d[1000000] = 1` | ✅ 発生 |

> 「`delete arr[i]` で常に DICTIONARY 化」ではない。小配列では fast 維持。V8 公式 docs に具体的閾値は公開されていない (実装依存)。

## 実測値 (Phase B / Issue [#10](https://github.com/824ysuk/benchmark-antipatterns/issues/10))

Node v24.14.1 / V8 13.6.233.17 / macOS Apple Silicon / 11 iter median, warmup=3 (本 repo の `benchmark()` ヘルパー準拠)。

### default JIT (Maglev+TurboFan) — `PACKED_SMI` 基準の倍率

| n | workload | HOLEY_SMI | HOLEY_DOUBLE | HOLEY_ELEMENTS | SPARSE_DELETED |
|---|---|---|---|---|---|
| 1,000 | `reduce` | 0.94× | **2.51×** | 1.35× | 0.91× |
| 1,000 | `map` | 0.91× | 1.25× | 0.82× | 0.75× |
| 1,000 | `for` ループ | 1.94× | 2.09× | 1.61× | 2.04× |
| 100,000 | `reduce` | 0.87× | 0.84× | 0.79× | **0.45×** |
| 100,000 | `map` | 1.06× | 1.06× | 0.92× | 0.61× |
| 100,000 | `for` ループ | 0.65× | 1.12× | 0.64× | 0.88× |

### `--jitless` — 倍率

| n | workload | HOLEY_DOUBLE (最大) |
|---|---|---|
| 100,000 | `reduce` | **1.92×** |
| 100,000 | `map` | 1.89× |

### 読み取り

1. **`PACKED_SMI` 基準の最大倍率は default JIT で 2.51×、`--jitless` で 1.92×** — 本 repo の掲載基準 (実測 9× 以上) には届かない。
2. **n=1k で kind 差が最も見える** — n=100k 以上では memory bandwidth が dominant になり kind 差は誤差に collapse する。Issue [#10](https://github.com/824ysuk/benchmark-antipatterns/issues/10) §4.3.3 の「n=100k で kind 影響が見える」予測とは逆向きの観測。
3. **`SPARSE_DELETED` (DICTIONARY 化) が `reduce` で 0.45×** — 実要素数が減少しているため scan 量自体が減り、kind 劣化コストより workload 削減効果が支配的になる。「dict 化したから遅い」とは限らない (workload と confound する)。
4. **`--jitless` でも倍率の order は同じ** — JIT 有効/無効で 1.92×/2.51× で同 order。「JIT が kind 劣化を吸収しない」(IC 機構で固定される) ことの傍証。

## 推奨される書き方 (kind 劣化を避ける)

「現実コードで 9× 改善する actionable パターン」ではないが、コードレビュー時の検出シグナル + 代替は以下のように整理できる。

| 検出シグナル | 代替 |
|---|---|
| `new Array(N)` で事前確保 | `[]` + `.push()` ループ (PACKED_SMI 維持) / `Array.from({length:N}, (_,i)=>...)` |
| 飛び番代入 `arr[10000] = v` | 連続インデックスで埋める |
| 数値配列に文字列混入 | 別配列に分離 / `Int32Array` 等の TypedArray |
| `delete arr[i]` | スワップ削除 (末尾と交換して `pop`) / `filter` で再構築 |

`Array.prototype.fill` は HOLEY → PACKED 復帰経路として安全 ([Chromium CL 6285929](https://chromium-review.googlesource.com/c/v8/v8/+/6285929))。

## なぜパターン化しないか

本 repo の掲載基準 [CONTRIBUTING.md](../CONTRIBUTING.md) は以下を要求する:

- (a) 実測で **9× 以上**の改善が確認できること
- (b) JIT / オプティマイザが自動吸収しないパターンであること
- (c) 手元で動くベンチマークコードが添付されていること
- (d) アルゴリズム・レベルのパターンであること

本機構は:

- (a) **未達** — Phase B 実測で max 2.51× (default JIT) / 1.92× (`--jitless`)
- (b) ✓ V8 公式が機構的に保証する一方向遷移
- (c) ✓ 本書 `%DebugPrint` probe + 上記実測表で再現可能
- (d) **不一致** — Issue [#10](https://github.com/824ysuk/benchmark-antipatterns/issues/10) §4.3.2 が自認する通り「Big-O は両者とも O(n)。差は per-element の IC dispatch コスト」で、**定数項層の劣化** (algorithmic ではない)

[docs/bottleneck-types.md](./bottleneck-types.md) の 3 カテゴリ (計算量の無駄 / 非同期の直列化 / 重複処理) のいずれにも該当しない。

## 再開条件

将来 [`patterns/`](../patterns/) への昇格を検討する trigger:

- **(A) 9× 達成 workload の発見**: ある engine × JIT 状態 × workload × n × kind の組み合わせで n=100k median ≥ 9× かつ n=1k median ≥ 5× を再現スクリプト付きで提示できる (例: hot-path TBT 直結シナリオ・Node v22 系 / V8 12.4 系での再現・engine 横断検証)
- **(B) CONTRIBUTING.md 9× 基準の改訂**: constant-factor JIT-resistance 系の lane 分離 (例: 2× + 構造証明) が承認される
- **(C) 新カテゴリの確立**: Issue [#11](https://github.com/824ysuk/benchmark-antipatterns/issues/11) で「JIT 最適化阻害」「データ構造の内部表現劣化」が確立する

## 参考

- [V8 blog: Elements kinds in V8](https://v8.dev/blog/elements-kinds) — 一方向遷移の公式解説 + 2025-02-28 fill 例外 Update
- [Chromium CL 6285929](https://chromium-review.googlesource.com/c/v8/v8/+/6285929) — fill HOLEY → PACKED 復帰実装
- [Mathias Bynens — Shapes and Inline Caches](https://mathiasbynens.be/notes/shapes-ics) — shape / IC・elements kind の包括解説
- [Mathias Bynens — Array holes (fill undefined)](https://mathiasbynens.be/notes/javascript-array-fill-undefined) — hole vs `undefined` の違い
- [V8 blog: Fast properties in V8](https://v8.dev/blog/fast-properties) — hidden class / dictionary mode の概念
- Issue [#10](https://github.com/824ysuk/benchmark-antipatterns/issues/10) — pattern 化を defer-needs-rebench とした検証結果コメント
