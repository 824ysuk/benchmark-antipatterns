# sequential await

**カテゴリ**: [非同期の直列化](../../docs/bottleneck-types.md#非同期の直列化)  
**計算量の変化**: O(n × latency) → O(max latency)  
**実測改善比**: 94×（n=100、latency=2ms、参考値）

## 問題

> カテゴリの詳細解説は [docs/bottleneck-types.md#非同期の直列化](../../docs/bottleneck-types.md#非同期の直列化) を参照。

`await` は Promise が解決するまで次の行に進めない「待機ゲート」。`for...of` ループの中で `await` を使うと、1 件ずつ順番に待つ直列処理になる。n=100・latency=2ms なら合計 **200ms** かかる。

API リクエスト・DB クエリ・外部サービス呼び出しなど、処理間に依存関係がない場合は `Promise.all` で同時に開始できる。すべてが同時に開始されるため、合計時間は「最も遅い 1 件の時間」だけになる。

## ❌ アンチパターン

```typescript
const results = [];
for (const id of ids) {
  results.push(await fetchItem(id)); // 1 件ずつ順番に待つ
}
```

## ✅ 改善後

依存関係がない処理はすべて同時に開始する。

```typescript
const results = await Promise.all(ids.map(id => fetchItem(id)));
```

## 計測環境

- Node.js: v24.14.1（`node -v`）
- V8: 13.6.233.17-node.44（`node -p process.versions.v8`）
- OS / CPU: macOS / Apple Silicon

## ベンチマーク

非同期処理のため計測ヘルパーは不要です（待ち時間が支配的で JIT warmup の影響は小さい）。以下をそのまま実行してください。

```javascript
const delay = ms => new Promise(r => setTimeout(r, ms));
const ids = Array.from({ length: 100 }, (_, i) => i);

(async () => {
  let start = performance.now();
  for (const id of ids) await delay(2);
  console.log(`[❌ sequential] ${(performance.now() - start).toFixed(1)}ms（期待値: 200ms）`);

  start = performance.now();
  await Promise.all(ids.map(() => delay(2)));
  console.log(`[✅ Promise.all] ${(performance.now() - start).toFixed(1)}ms（期待値: 2ms）`);
})();
```

## 実測値（参考）

| 条件 | 改善前 | 改善後 | 倍率 |
|---|---|---|---|
| n=10、latency=2ms | 22.9 ms | 2.4 ms | **9.4×** |
| n=100、latency=2ms | 228.0 ms | 2.4 ms | **94×** |

> 結果は実行環境・ハードウェアによって変わります。上記「計測環境」と同じ条件で改善前後を比較することが重要です。

## 注意・例外

以下の場合は直列処理が**正しい選択**:

- **前の結果に依存する場合**: `const b = await fetchB(a.id)` のように次の呼び出しが前の結果を必要とするとき
- **レート制限がある場合**: API に同時リクエスト数の制限がある場合は直列化または `p-limit` 等で並列数を制御する
- **順序が重要な場合**: 副作用の実行順序が保証されなければならないとき

変更前に必ず処理間の依存関係を確認する。

## 他言語での同等パターン

| 言語 | 並列化の手段 |
|---|---|
| Python | `asyncio.gather(*[fetch(id) for id in ids])` |
| Go | goroutine + `sync.WaitGroup` または `errgroup` |
| Rust | `futures::future::join_all()` |
| C# | `Task.WhenAll(ids.Select(id => FetchItemAsync(id)))` |

## 参考

- [カテゴリ解説: 非同期の直列化 — docs/bottleneck-types.md](../../docs/bottleneck-types.md#非同期の直列化) — 出典・引用を含む詳細解説
- [MDN: Promise.all()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all)
