# ループ内 unshift → push + reverse

**カテゴリ**: [計算量の無駄](../../docs/bottleneck-types.md#計算量の無駄)  
**計算量の変化**: O(n²) → O(n)  
**実測改善比**: 117×（n=10,000、参考値）

## 問題

> Big-O 記法の前提は [docs/performance-basics.md](../../docs/performance-basics.md) を参照。

`Array.prototype.unshift` は配列の先頭に要素を挿入するため、既存全要素を 1 つずつ後方にずらす O(n) 操作。これをループ内で呼ぶと外側 n 回 × 内側の要素シフトで全体が O(n²) になる。

末尾追加 `push` は O(1) amortized（V8 は backing store を約 1.5 倍 + 16 で幾何拡張）。「先頭に積みたい」だけなら `push` で末尾に積んで最後に 1 回 `reverse` すれば全体 O(n) になる。

> **パターン「ループ内 線形探索 / ループ内 includes → Set」との違い**: 前者 2 つは read-side の O(n) スキャンを Map / Set で O(1) 化する。本パターンは write-side の要素シフトを「処理順の反転」（push + reverse）で O(n) 化する。代替データ構造ではなく処理順を変える点が異なる。

## ❌ アンチパターン

```typescript
// 古い順に届いたログを「新しい順」に並べ替えたいケース
const newestFirst: LogEntry[] = [];
for (const entry of source) {
  newestFirst.unshift(entry); // 毎回 O(newestFirst.length) の要素シフト
}
// N=10,000 で内部的に約 5×10^7 要素分のシフトが発生する
```

## ✅ 改善後

> **前提**: 以下の改善案は配列を **mutate する** (`push` / `reverse` がいずれも破壊的)。React state / Redux reducer / Immer draft などの immutable context では、`setItems(prev => [newItem, ...prev])` のような spread ベースの prepend を使う (これは別物で本パターン対象外)。

末尾に push して最後に 1 回 reverse する。全体 O(n)。

```typescript
const newestFirst: LogEntry[] = [];
for (const entry of source) {
  newestFirst.push(entry); // amortized O(1)
}
newestFirst.reverse();     // in-place O(n)
```

reverse すら不要なら逆順ループで `push` する（最少コピー）。

```typescript
const newestFirst: LogEntry[] = [];
for (let i = source.length - 1; i >= 0; i--) {
  newestFirst.push(source[i]);
}
```

ループ中に先頭挿入と末尾追加・index 参照が混在する場合は自前 Deque（circular buffer）を使う。詳細は [Issue #7](https://github.com/824ysuk/benchmark-antipatterns/issues/7) §3 C 案を参照。

## ベンチマーク

[計測ヘルパー](../../CONTRIBUTING.md#計測ヘルパー)を先に実行してから以下を実行してください。

```javascript
const N = 10_000;
globalThis.__bench_sink = undefined; // DCE 回避

benchmark('❌ ループ内 unshift', () => {
  const arr = [];
  for (let i = 0; i < N; i++) arr.unshift(i);
  globalThis.__bench_sink = arr;
});
benchmark('✅ push + reverse', () => {
  const arr = [];
  for (let i = 0; i < N; i++) arr.push(i);
  arr.reverse();
  globalThis.__bench_sink = arr;
});
```

## 実測値（参考）

| 条件 | 改善前 | 改善後 | 倍率 |
|---|---|---|---|
| n = 10,000（Node.js v24.14 / V8 13.6） | 4.22 ms | 0.04 ms | **117×** |

> 結果は実行環境・ハードウェア・Node.js / V8 バージョンによって変わります。同じ環境で改善前後を比較することが重要です。

## 注意・例外

- 配列が小さい（n < 数百）と差は定数倍に埋もれる。プロファイルで確認してから適用する
- 「先頭追加」自体が正しい設計（タイムライン逆順表示・操作履歴の最新優先・FIFO エンキュー）の場合、`push + reverse` への置換は semantics を壊す。N の規模に応じて自前 Deque を検討する
- 自前 Deque は組み込み `Array` の memmove より定数倍遅いことが多い。中規模（数千〜数万）かつ両端操作が混在しない限り `push + reverse` のほうが速いことが多い。両端操作 (ring buffer / time-series window / tail viewer / streaming decoder) で本当に必要な場合は、capacity 拡張・iteration 順・JSON 直列化の罠を踏まないよう既存 OSS (例: `@datastructures-js/deque`) や typed-array ベースの ring buffer の利用を検討する
- ブラウザ engine では挙動が異なる場合がある（JavaScriptCore は `ArrayStorage::m_indexBias` で amortized O(1) 化する歴史的経路を持つ）。本実測値は Node.js (V8) 前提
- **A 案 (push + reverse) は `arr` が空である前提**。pre-existing 要素を持つ配列に適用すると、それらも `reverse` で逆転する。例: `['X','Y']` に `['a','b','c']` を unshift すると `['c','b','a','X','Y']` だが、push + reverse では `['c','b','a','Y','X']` になり X/Y も逆転する。既存要素がある場合は `arr = [...newItems.reverse(), ...arr]` を使う
- **B 案 (逆順ループ + push) は `source` が Array (または length + 整数 index アクセス可能な array-like) であるときのみ使える**。Set / Map / generator / 任意の Iterable / AsyncIterator では silent empty 配列を返す（`Set.length` が `undefined` のため）。これらは A 案 (`for...of` + push) を使う
- **B 案は string に対して surrogate pair を分割する**。`for...of` は code point 単位で iterate するが `source[i]` は code unit 単位で access するため、絵文字 (`'a😀b'`) を含む string で出力が壊れる。string には A 案を使う
- **AsyncIterator (`for await...of`) では A 案のみ採用可能**。B 案は `source.length` 不在のため適用不可。WebSocket / SSE / DB cursor 等で `for await (const x of stream) arr.unshift(x)` する場合は A 案 (`arr.push(x)` の後にループ終了時 1 回 `arr.reverse()`)
- **同一配列での自己参照 (`arr === source`) は元コード・改善案ともに未定義動作**。`for (const x of arr) arr.unshift(x)` は無限ループ / OOM。読み元と書き先を分けること
- **イベント駆動の累積 (`onmessage` ハンドラ内の単発 `items.unshift(event.data)` 等) も session 全体で O(n²) になる**。構文的にループに見えないが累積回数が増えると同じ問題が発生する。長時間配信では deque や逆順表示 (末尾追加 + reverse-iteration での render) を検討
- **例外発生時の途中状態が元コードと異なる**。元 (`unshift`) は途中までの要素が正しい newest-first 順で `arr` に残る。A 案は途中で例外が起きると `reverse` 前で停止するため oldest-first で残る。`catch` 内で `arr` を観察するコード (UI 表示・ログ・recovery) は挙動が変わる
- **ループ中に `source` を伸縮させる場合 B 案は使えない**。B 案は開始時の `source.length` をキャッシュするため、ループ中に他コード (またはループ本体) が `source.push` / `splice` しても見えない。`for...of` の Array iterator は live length を見るため挙動が異なる
- **`source` が `[Symbol.iterator]` を override している (filtering iterator 等) 場合 B 案は使えない**。B 案は raw index access のため iterator override を無視する。`FilteredArray` のような subclass や `Symbol.iterator` を返す Proxy には A 案 (`for...of`)
- **ループ中に `arr` を他コードが読む (Proxy / async / getter) 場合、A 案は中間状態の順序が逆**。元は newest-first prefix を常に維持するが、A 案は `reverse()` 完了前 oldest-first を露出する。観察者がいる場合は元の `unshift` を保つか、ループ全体を critical section で囲う

## 他言語での同等パターン

| 言語 | O(n) 構造（アンチ） | O(1) 構造（推奨） |
|---|---|---|
| Python | `list.insert(0, x)` | `collections.deque.appendleft` |
| Java | `ArrayList.add(0, x)` | `ArrayDeque.addFirst` |
| Go | `append([]T{x}, s...)` | 逆順 iterate + `append`（`container/list` は非 idiomatic で型安全性を失うため非推奨）|
| C# | `List.Insert(0, x)` | `List<T>.Add` + `List<T>.Reverse()`（両端 O(1) が必要なら `LinkedList<T>.AddFirst`）|
| Ruby | `Array#unshift` | `Array#push` + `Array#reverse`（標準 Deque 同等なし。MRI は `Array#shift` だけ amortized O(1) 最適化を持ち `unshift` は O(n)）|

## 参考

- [カテゴリ解説: 計算量の無駄 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#計算量の無駄)
- [ECMA-262 §23.1.3.37 Array.prototype.unshift](https://tc39.es/ecma262/#sec-array.prototype.unshift) — 先頭挿入で全要素を後方シフトする loop アルゴリズム
- [ECMA-262 §23.1.3.23 Array.prototype.push](https://tc39.es/ecma262/#sec-array.prototype.push) — 末尾書き込みのみ
- [V8 blog: Elements kinds in V8](https://v8.dev/blog/elements-kinds) — backing store と elements kind の解説
- [Issue #7](https://github.com/824ysuk/benchmark-antipatterns/issues/7) — engine 横断挙動・fast-path 条件・Tier 別 一次情報の深掘り
