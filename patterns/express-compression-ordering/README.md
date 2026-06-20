# Express compression ordering

**カテゴリ**: [構成順序](../../docs/bottleneck-types.md#構成順序)
**指標**: wire-size (egress bytes over HTTP)
**計算量の変化**: —（構造問題）
**実測改善比**: 25.76×（n=1,000 records JSON、477,868 byte → 18,549 byte、Node v20.19.6 / express 4.22 / compression 1.8）

## 問題

> カテゴリの詳細解説は [docs/bottleneck-types.md#構成順序](../../docs/bottleneck-types.md#構成順序) を参照。

Express の middleware は `app.use()` 呼び出し順に linear chain で実行される:

> The order of middleware loading is important: middleware functions that are loaded first are also executed first.
>
> — [Writing middleware — Express](https://expressjs.com/en/guide/writing-middleware.html)

route handler が `res.send` / `res.json` / `res.end` で response cycle を終了すると、それより後に登録された middleware は **実行されない**:

> If `myLogger` is loaded after the route to the root path, the request never reaches it ... because the route handler of the root path terminates the request-response cycle.
>
> — [Writing middleware — Express](https://expressjs.com/en/guide/writing-middleware.html)

`compression()` middleware は内部で `res.write` / `res.end` を wrap して zlib にパイプする仕組み（[`expressjs/compression/index.js`](https://github.com/expressjs/compression/blob/master/index.js)）。route handler **より後** に登録すると wrap が間に合わず、bytes は wrap される前の生のまま socket に流れる。エラーも警告も出ず、`app.use(compression())` 自体は書かれているためコードレビューでも見逃しやすい。

公式 README は明示的に「as high as you like で登録せよ」と書いている:

> simply `app.use` the module as high as you like.
>
> — [expressjs/compression — README](https://github.com/expressjs/compression)

### `body-parser` との順序ではない（よくある誤解）

`compression()` は **response** 側 (`res.*` を wrap)、`body-parser` は **request** 側 (`req` stream を読む) で方向が違う。両者の前後関係は wire 圧縮には影響しない。compression 順序の正しい比較対象は **route handlers / `express.static`** であって、body-parser ではない。

## ❌ アンチパターン

```javascript
const express = require('express');
const compression = require('compression');
const app = express();

app.get('/data', (req, res) => res.json(makeLargeJson()));  // ← 先に登録
app.use(compression());                                      // ← 後に登録 → 永遠に通らない

app.listen(3022);
```

- `app.get('/data', ...)` が response cycle を終了させるため、後段の `compression()` は通らない
- レスポンスヘッダに `Content-Encoding: gzip` が **付かない**

## ✅ 改善後

`app.use(compression())` を route handler **より上** に置く。`express.static` も同様で、compression より後に置くと static asset が圧縮されない。

```javascript
const express = require('express');
const compression = require('compression');
const app = express();

app.use(compression());                                      // ← route より先
app.get('/data', (req, res) => res.json(makeLargeJson()));

app.listen(3021);
```

## ベンチマーク

手元で動かす最小セット。`express` と `compression` を install してから 3 ファイルを保存して実行する。

```bash
mkdir bench-compression && cd bench-compression
npm init -y
npm install express@4 compression@1
```

`payload.js`（JSON-heavy / 実 API らしい構造）:

```javascript
const CATEGORIES = ['logistics','logistics','logistics','transport','warehouse','fleet','driver','driver'];
const STATUSES   = ['pending','pending','in_progress','in_progress','completed','cancelled'];
const BOILERPLATE =
  'This shipment is part of the standard workflow. ' +
  'Status updates are propagated via the standard event bus. ' +
  'Refer to the operations manual for handling instructions. ';

function makeLargeJson() {
  const records = [];
  for (let i = 0; i < 1000; i += 1) {
    records.push({
      id: i,
      uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      category: CATEGORIES[i % CATEGORIES.length],
      status: STATUSES[i % STATUSES.length],
      title: `Shipment record ${i}`,
      description: BOILERPLATE + `Record number ${i}.`,
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:00.000Z',
      basePriceYen: 10000 + (i % 50) * 100,
      fuelSurchargeYen: (i % 20) * 50,
      tollFeeYen: (i % 15) * 200,
      tax: 0.1,
    });
  }
  return { records, total: records.length, generatedAt: '2026-06-20T00:00:00.000Z' };
}
module.exports = { makeLargeJson };
```

`server-good.js` / `server-bad.js`:

```javascript
// server-good.js — compression BEFORE routes
const express = require('express');
const compression = require('compression');
const { makeLargeJson } = require('./payload');
const app = express();
app.use(compression());
app.get('/data', (req, res) => res.json(makeLargeJson()));
app.listen(3021, () => console.log('good listening on 3021'));
```

```javascript
// server-bad.js — compression AFTER routes
const express = require('express');
const compression = require('compression');
const { makeLargeJson } = require('./payload');
const app = express();
app.get('/data', (req, res) => res.json(makeLargeJson()));
app.use(compression());
app.listen(3022, () => console.log('bad listening on 3022'));
```

起動・計測:

```bash
node server-good.js > /tmp/good.log 2>&1 & GOOD_PID=$!
node server-bad.js  > /tmp/bad.log  2>&1 & BAD_PID=$!
sleep 1

for i in 1 2 3 4 5; do
  BAD_SIZE=$(curl -s -o /tmp/bad.body  -H "Accept-Encoding: gzip" -w "%{size_download}" http://127.0.0.1:3022/data)
  GOOD_SIZE=$(curl -s -o /tmp/good.body -H "Accept-Encoding: gzip" -w "%{size_download}" http://127.0.0.1:3021/data)
  echo "run $i: bad=$BAD_SIZE byte, good=$GOOD_SIZE byte"
done
echo "ratio: $(echo "scale=2; $BAD_SIZE / $GOOD_SIZE" | bc)"

kill $GOOD_PID $BAD_PID
```

## 実測値（参考）

5 run 全てで完全に一致した安定値（サーバ側で gzip 圧縮するかしないかの二値問題のため、payload 同一なら出力 byte も決定論的）。

```text
run 1: bad=477868 byte, good=18549 byte
run 2: bad=477868 byte, good=18549 byte
run 3: bad=477868 byte, good=18549 byte
run 4: bad=477868 byte, good=18549 byte
run 5: bad=477868 byte, good=18549 byte
ratio: bad/good = 25.76
```

| 指標 | bad (compression 後置) | good (compression 前置) | 倍率 |
|---|---|---|---|
| wire-size | 477,868 byte | 18,549 byte | **25.76×** |
| `Content-Encoding` header | (なし) | `gzip` | — |
| TTLB (loopback) | ~2.2 ms | ~3.0 ms | bad の方が速い（loopback で帯域無制限、gzip CPU コストが上乗せされるため） |

`Accept-Encoding` を外すと両方 477,868 byte の同一 payload（`diff -q` 確認）。Content-Encoding header は `curl -sD - -H 'Accept-Encoding: gzip' <url>` で bad に付かないこと / good に `gzip` が付くことを確認できる。

> 結果は実行環境・payload 構造で変わります。同じ環境で改善前後を比較することが重要です。

## 注意・例外

- **メトリクスは wire-size であって サーバ RPS ではない**。loopback (bandwidth 無制限) では gzip CPU コストの分だけ bad の方が速い。**bandwidth 制限のある実回線（モバイル / WAN / VPN）/ Egress 課金される CDN・LB では bad が遅くなり、課金が増える**。
- **payload の compressibility に依存**する。JSON / HTML / CSS / SVG など repetitive な text は 5-15× で圧縮される。すでに圧縮済みのバイナリ（jpeg / mp4 / gzip / br）は ~1× で改善しない。`compressible` module が MIME type を判別し、`Cache-Control: no-transform` を含む response や threshold (default `1kb`) 未満の payload はそもそも圧縮対象外（[expressjs/compression](https://github.com/expressjs/compression) 参照）。
- **production の reverse proxy gzip 構成では効果が限定的**。Nginx / Cloudflare が前段で gzip する構成では Express → proxy 区間の wire-size のみが影響し、proxy → client 区間は proxy 側の設定で独立に圧縮される。Express を直接 public 公開する構成（small app / serverless）では full 25.76× が効く。
- **HTTP/2 環境は unverified**。compression の hook は Node の `http.ServerResponse` 側で、`http2.Http2ServerResponse` 経路での挙動は公式 README に明記がない。
- **HTTPS では BREACH 攻撃面に留意**。動的 secret を圧縮 response body に含めるケースは別途検討が必要。

## 検出方法

`Content-Encoding` header を確認すれば silent failure を observable にできる:

```bash
# bad: header なし
curl -sD - -o /dev/null -H 'Accept-Encoding: gzip' http://127.0.0.1:3022/data | grep -i content-encoding
# (出力なし)

# good: gzip 付与
curl -sD - -o /dev/null -H 'Accept-Encoding: gzip' http://127.0.0.1:3021/data | grep -i content-encoding
# Content-Encoding: gzip
```

integration test に組み込むなら（jest / supertest 例）:

```javascript
test('compressible response should be gzipped', async () => {
  const res = await request(app)
    .get('/data')
    .set('Accept-Encoding', 'gzip');
  expect(res.headers['content-encoding']).toBe('gzip');
});
```

CI で 1 endpoint だけでもこの assertion を入れておけば、middleware ordering の事故は machine-detectable になる。

## 他フレームワークでの同問題

| Framework | model | 同パターンの起きにくさ |
|---|---|---|
| **Express 4.x / 5.x** | linear chain, `app.use()` 順 | **本パターンが扱う事例**（最も起きやすい） |
| **Koa** | onion / cascading `await next()` | onion model の「ラッパは外側」直感で「compression は上流に書く」気づきが働きやすい。ただし `koa-compress` も後置すれば同様に silent no-op になりうる（構造的に防げているわけではない） |
| **Fastify** | named lifecycle hooks (`onSend` 等) | phase 間は hook 名で順序固定 (`onRequest` → `preHandler` → `onSend` …) のため「response より後ろに置く」失敗は起きにくい。ただし同一 phase 内（複数の `onSend` 等）の plugin 間順序は登録順 FIFO の影響を受ける |
| **Hono / Itty / etc.** | 主に Web Fetch API ベース | 同じ linear chain だが Web Streams 経由のため、compression は通常 transform stream で挿入する |

Express の middleware ordering API は「ひとつの順序付きリストで parse・auth・log・compress・route・error を全部表現する」設計のため、本パターンのような silent no-op を生む構造的余地が大きい。Fastify の hook 名による phase 固定は、登録順に依存しないクラスの footgun を減らす設計（phase 内の plugin 順序は依然登録順に依存する）。

## 参考

### Express 公式

- [Writing middleware — Express](https://expressjs.com/en/guide/writing-middleware.html)
- [Using middleware — Express](https://expressjs.com/en/guide/using-middleware.html)
- [Production best practices: Performance — Express](https://expressjs.com/en/advanced/best-practice-performance.html)

### compression middleware

- [expressjs/compression — README](https://github.com/expressjs/compression)
- [expressjs/compression — `index.js` source（`res.write` / `res.end` wrap）](https://github.com/expressjs/compression/blob/master/index.js)
- [compression resource page — Express](https://expressjs.com/en/resources/middleware/compression.html)

### 他フレームワーク

- [Koa — Cascading middleware](https://koajs.com/#cascading)
- [Fastify — Lifecycle hooks](https://fastify.dev/docs/latest/Reference/Hooks/)
- [Fastify Benchmarks](https://fastify.dev/benchmarks/)

### 関連 Issue / ADR

- [Issue #16 — pattern: Express の compression() を route handler より後に登録して silent egress regression を起こす](https://github.com/824ysuk/benchmark-antipatterns/issues/16)
- [ADR 0001 — scope を「構成順序」カテゴリに拡張する](../../docs/decisions/0001-scope-extension-configuration-ordering.md)
