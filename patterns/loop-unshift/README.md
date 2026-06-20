# ループ内 unshift = O(n²)

**カテゴリ**: [計算量の無駄](../../docs/bottleneck-types.md#計算量の無駄)
**計算量の変化**: O(n²) → O(n)
**実測改善比**: 約 200× オーダー（Node v24.14.1 / V8 13.6 / Apple M5 Pro / n=10,000 で 207.8×。環境・CPU・engine version で大きく変動するため詳細は [実測値](#実測値参考) と注意・例外節を参照）

## 問題

> Big-O 記法の前提は [docs/performance-basics.md](../../docs/performance-basics.md) を参照。

`Array.prototype.unshift` は ECMA-262 が要求する observable semantics（全インデックスの再配置）と、主要エンジン（V8 / JSC / SpiderMonkey）が dense array を連続メモリの backing store で保持する実装戦略の組み合わせから、1 回あたり現在の配列長に比例する O(len) 操作になる。これをループで N 回呼ぶと合計 `0 + 1 + ... + (N-1) = O(N²)` になる。

末尾追加の `push` は仕様上 `len` 位置に書くだけで shifting を含まず、V8 は backing store を幾何級数的（おおむね 1.5×+16）に拡張するため amortized O(1)。「先頭か末尾か」というたった 1 文字の選択が、合計 O(N²) と O(N) を分ける。

## ❌ アンチパターン

「ログを新しい順に並べたい」「逆順の配列が欲しい」という素直な発想から書かれることが多い。結果は正しいため動作確認では露見しにくいが、N が 1 桁増えると実行時間は約 100 倍に伸びる。

```typescript
type LogEntry = { ts: number; msg: string };

const source: LogEntry[] = fetchLogsAscending(); // length === N
const newestFirst: LogEntry[] = [];
for (const entry of source) {
  newestFirst.unshift(entry); // 毎回 O(newestFirst.length) の memmove 相当
}
// N=10,000 で内部的に約 5×10^7 要素分のシフトが発生する
```

## ✅ 改善後

末尾追加で組み立てて最後に 1 回反転する。`push` は amortized O(1)、`reverse` は in-place O(N)、合計 O(N)。

```typescript
const result: LogEntry[] = [];
for (const entry of source) {
  result.push(entry);   // amortized O(1)
}
result.reverse();       // in-place O(N)
```

別解として、入力を逆順に走査して `push` だけで済ませる方法もある（`reverse` 1 回分の N 要素ムーブを省ける）。ループ中に先頭挿入と末尾追加・index 参照が混在する用途では自前の circular buffer（Deque）を検討する。

## ベンチマーク

[計測ヘルパー](../../CONTRIBUTING.md#計測ヘルパー)を先に実行してから以下を実行してください。`unshift` は破壊的操作なので、1 回の計測ごとに新規 `[]` から開始する（流用すると 2 回目以降が「既に長さ N の配列に対する unshift」となり計算量が変わる）。

```javascript
const N = 10_000;

benchmark('❌ ループ内 unshift', () => {
  const arr = [];
  for (let i = 0; i < N; i++) arr.unshift(i); // O(len) per call → 合計 O(N²)
  globalThis.__bench_sink = arr;              // DCE 回避
});
benchmark('✅ push + reverse', () => {
  const arr = [];
  for (let i = 0; i < N; i++) arr.push(i);    // amortized O(1)
  arr.reverse();                              // in-place O(N)
  globalThis.__bench_sink = arr;
});
```

V8 の階層実行（Ignition インタプリタ → Sparkplug / Maglev / TurboFan JIT）の昇格しきい値は版間で変わるため、計測前に warmup として同関数を数千回呼んでから本計測に入ることが望ましい。Tier 到達を自分で確認したい場合は `node --allow-natives-syntax` で起動して `%GetOptimizationStatus(fn)` を観測する（`--allow-natives-syntax` は V8 専用・bit 配置は版間で変わるため自己検証用）。

完成版の TypeScript 実装は本ディレクトリ同梱の [`bench.ts`](./bench.ts) を参照。N=1,000 / 10,000 / 100,000 の 3 段階計測、warmup（n を 256 に cap した上で 20,000 invocation – JIT tier 到達狙いで n に依存しない）、DCE 回避（`globalThis.__bench_sink`）、median+p95+std 表示、elements kind 確認用 `%DebugPrint` probe を含む。

**実行前提**:

- **Node v22.6 以上**（`--experimental-strip-types` で .ts 直実行が可能になったバージョン）。v22.0–22.5 では `npx tsx bench.ts` または `tsc` でトランスパイル後実行する
- elements kind 確認まで取りたい場合は `node --allow-natives-syntax --experimental-strip-types --no-warnings bench.ts` で起動する

## 実測値（参考）

`bench.ts` を `node --allow-natives-syntax --experimental-strip-types --no-warnings bench.ts` で実行した結果（warmup 20,000 invocations、iterations 100 / 30 / 10）:

| 条件 | unshift median ± std (ms) | push+reverse median ± std (ms) | median 倍率 |
|---|---|---|---|
| n=1,000 / Node v24.14.1 / V8 13.6 / darwin arm64 / Apple M5 Pro / PACKED_SMI_ELEMENTS | 0.050 ± 0.014 | 0.002 ± 0.003 | **25.2×** |
| n=10,000 / 同上 | 4.05 ± 0.058 | 0.019 ± 0.013 | **207.8×** |
| n=100,000 / 同上 | 608.1 ± 41.18 | 0.633 ± 0.432 | **961.2×** |

- elements kind は `%DebugPrint(arr)` で両者とも `PACKED_SMI_ELEMENTS` を維持していることを確認（出力フォーマットは V8 版間で安定 API ではない）。
- 理論比は `O(N²)/O(N) ≈ N/2` (例: n=10,000 で 5,000×)。実測は warmup 後の `push + reverse` 側の reverse パスや SIMD memmove の定数倍で下振れするが、n を 1 桁増やすと倍率も 1 桁スケールしており Big-O オーダーが N の関数として開いていく挙動と整合する。
- 数値は実行環境・ハードウェアで変わる。「Node v24 / V8 13.6 / n=10,000 で約 200× の median speedup を観測 (PACKED_SMI_ELEMENTS 維持)」のように engine・version・n・elements kind を必ず併記し、単一値の断言（「9× である」等）はしない。

## 注意・例外

- **N が小さいときの差は実測で消える**: N < 100 程度では memmove のスループット・分岐予測・命令キャッシュが支配的で、両者の差は埋もれる。書き換えるかどうかは N の上限と実測の両方で判断する。
- **「先頭追加」自体が設計上の意図のとき**: タイムライン逆順表示・操作履歴の最新優先・FIFO キューの enqueue 側など、先頭挿入そのものが semantics の一部であるなら `push + reverse` は意味を壊す。N が小さいなら `unshift` のまま残し、N が大きく両端操作が頻繁なら Deque 系データ構造を検討する。
- **自前 Deque が組み込み Array より遅いことがある**: Linked list / ring buffer の自前実装はオブジェクト割当・GC pressure・ポインタ追跡による cache miss を生む。N が中規模（数千〜数万）かつ両端操作が混在しない限り、`push + reverse` のほうが速いことが多い。Deque を選ぶ前にベンチで比較する。
- **`new Array(N)` での事前確保は Big-O を変えない**: capacity hint は `push` の再確保償却には効くが、`unshift` のコストの本質は「既存要素を 1 つずつ後ろにずらす」要素移動なので、capacity を確保しても O(N²) のまま変わらない。
- **エンジンによる収束ではないケース**: JavaScriptCore（JSC）の `ArrayStorage` は `m_indexBias` で先頭側余白を持ち、条件次第で `unshift` を amortized O(1) に近づける歴史的経路がある。「JS の `unshift` は全 engine で O(n)」とも「最適化される」とも断言せず、対象 engine ごとに計測する。

## 他言語での同等パターン

| 言語 | O(N) になる代替 | 備考 |
|---|---|---|
| Python | `list.append()` + `list.reverse()` または `collections.deque.appendleft()` | `list.insert(0, x)` がループ内呼び出しで同じ問題（CPython の list は連続メモリ配列） |
| Java | `ArrayDeque.addFirst()` | `ArrayList.add(0, x)` がループ内呼び出しで同じ問題 |
| Go | `append` + 末尾構築 → 逆順走査 | slice の先頭挿入 `append([]T{x}, s...)` がループ内で同じ問題 |
| Ruby | `Array#push` + `Array#reverse!` | `Array#unshift` のループ内呼び出しが同じ問題 |

## 参考

引用 Tier は [docs/primary-sources.md](../../docs/primary-sources.md) 体系に従う（Tier 1: 公式 / spec、Tier 2: engine team、Tier 3: 信頼性ある二次、Tier 4: 理論）。

- **Tier 1**: [ECMA-262 §23.1.3.37 Array.prototype.unshift（current editor's draft）](https://tc39.es/ecma262/#sec-array.prototype.unshift) — `k > 0` を満たす間、全要素を後方コピーする loop の仕様根拠
- **Tier 1**: [ECMA-262 §23.1.3.23 Array.prototype.push（current editor's draft）](https://tc39.es/ecma262/#sec-array.prototype.push) — `len` 位置に書いて `len = len + 1` のみで shifting を含まない
- **Tier 1**: [V8 blog: Elements kinds in V8](https://v8.dev/blog/elements-kinds) — `PACKED`/`HOLEY` × `SMI`/`DOUBLE`/`OBJECT` の representation specialization（constant factor 最適化の文脈、`unshift` の O(N) を直接論じる文書ではない）
- **Tier 4**: [SpiderMonkey Bugzilla #1348772 — Array.prototype.shift を O(1) にする実装 (Firefox 55 で投入)](https://bugzilla.mozilla.org/show_bug.cgi?id=1348772) — 「`shift`/`unshift` の O(N) は仕様要件ではなく実装選択」の一次根拠
- **Tier 4**: CLRS *Introduction to Algorithms* §17.4 Dynamic tables — `push` の amortized O(1) の標準解析（aggregate method）
- [カテゴリ解説: 計算量の無駄 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#計算量の無駄)
- [Issue #7](https://github.com/824ysuk/benchmark-antipatterns/issues/7) — 本パターンの元提案（仕様引用・engine 実装ソース・ベンチマーク設計の詳細）
