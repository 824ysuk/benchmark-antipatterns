/**
 * Benchmark: 不安定な cache key による cache miss 永続化 vs 安定 key
 * Pattern: patterns/unstable-cache-key (Issue #13 §ベンチマーク 設計準拠)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 実行方法
 * ─────────────────────────────────────────────────────────────────────────────
 *   node --experimental-strip-types bench.ts            # Node 22.6+
 *   node bench.ts                                       # Node 23.6+ (strip-types stable)
 *
 *   .ts 直実行できない環境では:
 *     npx tsc --target esnext --module nodenext bench.ts && node bench.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Motivation (なぜこの比較を行うか)
 * ─────────────────────────────────────────────────────────────────────────────
 *  TanStack Query / SWR / RTK Query / Apollo / urql など主要なクライアント
 *  キャッシュは queryKey を `JSON.stringify` ベースの deterministic hash で
 *  同一性判定する (TanStack Query v5 query-core/src/utils.ts hashKey 参照)。
 *
 *    JSON.stringify(queryKey, (_, val) =>
 *      isPlainObject(val) ? Object.keys(val).sort().reduce(...) : val)
 *
 *  この前提が崩れる値を key に渡すと、cache が「速度」または「正しさ」の
 *  どちらかの軸で静かに壊れる。本ベンチは速度軸 (mode 1: cache miss 永続化)
 *  を主対象とし、loop-invariant な fetch がレンダー (= cache.get 呼び出し)
 *  ごとに毎回走るコストを実測する。
 *
 *  - bad: 毎回 sessionId が変わる → 毎回 hash 変化 → cache miss → N 回 fetch
 *  - good: filters のみ → 1 回 fetch + (N-1) cache hit
 *
 *  benchmark-antipatterns repo は速度 repo のため mode 1 のみを benchmark
 *  対象とする。mode 2 (closure-only instance の hashKey 衝突) / mode 3
 *  (Map/Set の identity loss) は正しさ系で速度差ではなく hash collision を
 *  起こす類なので、本ファイル末尾で「unique hash count 検証」として
 *  ワンショット実行する (README の注釈節と対応)。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Caveats
 * ─────────────────────────────────────────────────────────────────────────────
 *  - 倍率は fetch のコスト (本ファイルでは int-math 50,000 iter で simulate)
 *    に対する N × fetch vs 1 × fetch + N × lookup の比なので、fetch_cost が
 *    大きいほど倍率も大きく出る。「Issue #13 の本文 251×」は fetch コスト
 *    50,000 iter / N=1000 / Node v20 での値。本ファイルの実測値は環境で変動。
 *  - QueryCache.hash は TanStack Query の hashKey と同じ「JSON.stringify +
 *    plain object key sort」を実装するが、isPlainObject は constructor === Object
 *    の簡易判定で代用 (TanStack の isPlainObject はもう一段判定するが、本
 *    シナリオでは等価)。
 *  - JIT-resistance: expensiveFetch は process.hrtime() 由来の不透明 seed +
 *    bitwise int 演算 + GLOBAL_SINK escape で V8 が定数畳み込み / dead code
 *    除去できないようにしてある。それでも tier 昇格による安定化が観測される
 *    まで warmup を多めに取る。
 *  - workflow Run ID は実装の出典にしない (一次情報は TanStack Query 公式
 *    docs / hashKey source / 各 cache library 公式 docs)。
 */

// ─────────────────────────────────────────────────────────────────────────────
// Node.js minimal type declarations (型チェック用最小宣言、@types/node 不要)
// ─────────────────────────────────────────────────────────────────────────────
declare const process: {
  readonly version: string;
  readonly versions: { readonly v8: string; readonly node: string };
  readonly platform: string;
  readonly arch: string;
  hrtime(): [number, number];
  readonly report?: {
    getReport(): { header: { cpus?: ReadonlyArray<{ model: string }> } };
  };
};

declare global {
  // eslint-disable-next-line no-var
  var __bench_sink: unknown;
  // eslint-disable-next-line no-var
  var __bench_fetch_sink: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 共通ユーティリティ
// ─────────────────────────────────────────────────────────────────────────────

function stats(samples: readonly number[]): { median: number; p95: number; std: number; n: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { median: NaN, p95: NaN, std: NaN, n: 0 };
  const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const rank = 0.95 * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const p95 = lo === hi ? sorted[lo] : sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
  const mean = samples.reduce((s, x) => s + x, 0) / n;
  const variance = samples.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  return { median, p95, std, n };
}

function fmtMs(x: number): string {
  if (!isFinite(x)) return "NaN";
  if (x >= 100) return x.toFixed(1);
  if (x >= 1) return x.toFixed(2);
  return x.toFixed(3);
}

// ─────────────────────────────────────────────────────────────────────────────
// 仮想 cache (TanStack Query 互換 hashKey)
// ─────────────────────────────────────────────────────────────────────────────

class QueryCache {
  private readonly store = new Map<string, number>();

  /**
   * TanStack Query v5 query-core/src/utils.ts の hashKey と同じ:
   *   plain object の key を sort してから JSON.stringify する。
   *   Map / Set / 関数のみの object は own enumerable property を持たない
   *   ため `'{}'` に潰れる (mode 2/3 が起きる原因)。
   */
  hash(queryKey: unknown): string {
    return JSON.stringify(queryKey, (_k, val: unknown) => {
      if (val !== null && typeof val === "object" && (val as object).constructor === Object) {
        const obj = val as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
        return sorted;
      }
      return val;
    });
  }

  get(queryKey: unknown, fetchFn: () => number): number {
    const h = this.hash(queryKey);
    const cached = this.store.get(h);
    if (cached !== undefined) return cached;
    const value = fetchFn();
    this.store.set(h, value);
    return value;
  }

  size(): number {
    return this.store.size;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JIT-resistant な expensiveFetch (network 往復のコスト simulator)
//   - process.hrtime()[1] (nanosecond) を seed にして V8 が定数畳み込みできない
//   - bitwise int 演算 (`| 0`) で V8 が値を捨てられない
//   - 結果を GLOBAL に XOR で書き出して escape させ dead code 化を防ぐ
// ─────────────────────────────────────────────────────────────────────────────

globalThis.__bench_fetch_sink = 0;

const FETCH_INNER_ITER = 50_000;

function expensiveFetch(): number {
  const seed = process.hrtime()[1];
  let s = seed | 0;
  for (let i = 0; i < FETCH_INNER_ITER; i++) {
    s = ((s * 31) + i) | 0;
  }
  globalThis.__bench_fetch_sink ^= s;
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// 計測対象
// ─────────────────────────────────────────────────────────────────────────────

const FILTERS = Object.freeze({ status: "open", page: 1 });

/** ❌ アンチパターン: 毎レンダー新しい sessionId → 毎回 cache miss → N 回 fetch */
function runUnstableKey(n: number): number {
  const cache = new QueryCache();
  let acc = 0;
  for (let i = 0; i < n; i++) {
    // 毎回新規の sessionId (Math.random + iteration index で確実に unique)
    const sessionId = `${Math.random()}-${i}`;
    acc = (acc + cache.get(["orders", { sessionId, filters: FILTERS }], expensiveFetch)) | 0;
  }
  globalThis.__bench_sink = { cacheSize: cache.size(), acc };
  return cache.size();
}

/** ✅ 改善: sessionId を key から外す → 1 回 fetch + (N-1) cache hit */
function runStableKey(n: number): number {
  const cache = new QueryCache();
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc = (acc + cache.get(["orders", { filters: FILTERS }], expensiveFetch)) | 0;
  }
  globalThis.__bench_sink = { cacheSize: cache.size(), acc };
  return cache.size();
}

// ─────────────────────────────────────────────────────────────────────────────
// ベンチハーネス
// ─────────────────────────────────────────────────────────────────────────────

interface BenchSpec {
  label: string;
  fn: (n: number) => number;
  n: number;
  warmupInvocations: number;
  iterations: number;
}

interface BenchResult {
  label: string;
  n: number;
  iterations: number;
  warmupInvocations: number;
  median: number;
  p95: number;
  std: number;
}

function bench(spec: BenchSpec): BenchResult {
  // Warmup: V8 階層実行の昇格しきい値は公開 API ではなく版間で揺れるため保守的に多めに取る。
  // n の影響を打ち消すため warmup は小さい n で十分回数行う。
  const warmupN = Math.min(spec.n, 64);
  for (let i = 0; i < spec.warmupInvocations; i++) {
    spec.fn(warmupN);
  }

  const gc = (globalThis as Record<string, unknown>).gc as (() => void) | undefined;
  if (typeof gc === "function") gc();

  const samples: number[] = [];
  for (let i = 0; i < spec.iterations; i++) {
    const t0 = performance.now();
    spec.fn(spec.n);
    const t1 = performance.now();
    samples.push(t1 - t0);
  }

  const s = stats(samples);
  return {
    label: spec.label,
    n: spec.n,
    iterations: spec.iterations,
    warmupInvocations: spec.warmupInvocations,
    median: s.median,
    p95: s.p95,
    std: s.std,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// mode 2/3 検証 (速度ではなく hashKey 衝突を可視化)
// ─────────────────────────────────────────────────────────────────────────────

function verifyHashCollisions(n: number): void {
  const cache = new QueryCache();

  // mode 2: closure に識別情報を閉じ込めた instance (関数 property のみ)
  const closureHashes = new Set<string>();
  for (let i = 0; i < n; i++) {
    const tenantId = `tenant-${i}`;
    const instance = { fetch: () => tenantId };
    closureHashes.add(cache.hash(["orders", instance]));
  }

  // mode 3a: Map (own enumerable property を持たないため '{}' に潰れる)
  const mapHashes = new Set<string>();
  for (let i = 0; i < n; i++) {
    const m = new Map([["role", `role-${i}`]]);
    mapHashes.add(cache.hash(["users", m]));
  }

  // mode 3b: Set
  const setHashes = new Set<string>();
  for (let i = 0; i < n; i++) {
    const s = new Set([`tag-${i}`]);
    setHashes.add(cache.hash(["tags", s]));
  }

  // 期待: いずれも 1 (全 instance が `'{}'` に潰れて cache collision)
  console.log(`  mode 2 (closure-only instance): unique hashes = ${closureHashes.size} / ${n}  (期待 1 = collision 発生)`);
  console.log(`  mode 3a (Map)                 : unique hashes = ${mapHashes.size} / ${n}  (期待 1)`);
  console.log(`  mode 3b (Set)                 : unique hashes = ${setHashes.size} / ${n}  (期待 1)`);

  // 参考: JSON.stringify が関数のみ object を `'{}'` にする仕様確認
  const sample = JSON.stringify({ fetch: () => {} });
  console.log(`  verify: JSON.stringify({fetch: () => {}}) === ${JSON.stringify(sample)}  (期待 '{}')`);
}

// ─────────────────────────────────────────────────────────────────────────────
// メイン
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  console.log("=".repeat(72));
  console.log("unstable-cache-key benchmark (Issue #13 §ベンチマーク)");
  console.log("=".repeat(72));
  console.log(`Node.js:           ${process.version}`);
  console.log(`V8:                ${process.versions.v8}`);
  console.log(`Platform / arch:   ${process.platform} / ${process.arch}`);
  console.log(`CPU model:         ${process.report?.getReport().header.cpus?.[0]?.model ?? "(unknown)"}`);
  console.log(`Date (UTC):        ${new Date().toISOString()}`);
  console.log(`fetch inner iter:  ${FETCH_INNER_ITER.toLocaleString()} (JIT-resistant int-math loop)`);
  console.log("");
  console.log("Note: median ± std を主指標とし、単一値 (mean) の倍率断言はしない。");
  console.log("      p95/median > 2 のときは外れ値支配のため再測定推奨。");
  console.log("");

  // 計測対象: N (= cache.get 呼び出し回数 = レンダー回数) を 3 段階
  const matrix: Array<{ n: number; iterations: number }> = [
    { n: 100, iterations: 30 },
    { n: 1_000, iterations: 20 },
    { n: 10_000, iterations: 5 },
  ];
  const WARMUP = 200;

  const rows: Array<{
    n: number;
    iterations: number;
    bad: BenchResult;
    good: BenchResult;
    speedup_median: number;
  }> = [];

  for (const { n, iterations } of matrix) {
    console.log(`── n = ${n.toLocaleString()} (warmup ${WARMUP} invocations / ${iterations} iterations) ──`);
    const bad = bench({
      label: "unstable key (cache always miss)",
      fn: runUnstableKey,
      n,
      warmupInvocations: WARMUP,
      iterations,
    });
    const good = bench({
      label: "stable key (1 miss + N-1 hits)",
      fn: runStableKey,
      n,
      warmupInvocations: WARMUP,
      iterations,
    });

    console.log(
      `  ❌ unstable key  : median=${fmtMs(bad.median)} ms  p95=${fmtMs(bad.p95)} ms  std=${fmtMs(bad.std)} ms`
    );
    console.log(
      `  ✅ stable key    : median=${fmtMs(good.median)} ms  p95=${fmtMs(good.p95)} ms  std=${fmtMs(good.std)} ms`
    );
    const ratioBad = bad.p95 / Math.max(bad.median, Number.EPSILON);
    const ratioGood = good.p95 / Math.max(good.median, Number.EPSILON);
    if (ratioBad > 2 || ratioGood > 2) {
      console.log(
        `  ⚠ p95/median > 2 (unstable=${ratioBad.toFixed(2)}, stable=${ratioGood.toFixed(2)}). ` +
          `外れ値支配の可能性 — 再測定を検討。`
      );
    }
    const speedup = bad.median / Math.max(good.median, Number.EPSILON);
    console.log(
      `  → median speedup: ${speedup.toFixed(1)}× (条件: Node ${process.version} / V8 ${process.versions.v8} / n=${n} / fetch_cost=${FETCH_INNER_ITER})`
    );
    console.log("");
    rows.push({ n, iterations, bad, good, speedup_median: speedup });
  }

  // mode 2/3: hash collision 検証 (速度ではなく正しさ系)
  console.log("── mode 2/3: hashKey collision 検証 (n=1,000) ──");
  verifyHashCollisions(1_000);
  console.log("");

  // サマリ表
  console.log("=".repeat(72));
  console.log("Summary (条件付き — 出典に使うときは Node / V8 / n / fetch_cost を必ず併記)");
  console.log("=".repeat(72));
  console.log(
    "| n        | unstable median±std (ms)  | stable median±std (ms)    | speedup |"
  );
  console.log(
    "|----------|---------------------------|---------------------------|---------|"
  );
  for (const r of rows) {
    const b = `${fmtMs(r.bad.median).padStart(7)} ± ${fmtMs(r.bad.std).padStart(7)}`;
    const g = `${fmtMs(r.good.median).padStart(7)} ± ${fmtMs(r.good.std).padStart(7)}`;
    console.log(
      `| ${String(r.n).padStart(8)} | ${b.padEnd(25)} | ${g.padEnd(25)} | ${r.speedup_median.toFixed(1).padStart(5)}× |`
    );
  }
  console.log("");
  console.log(`__bench_fetch_sink (escape 確認用): ${globalThis.__bench_fetch_sink}`);

  // sink を 1 回だけ参照して escape を確実にする (DCE 防止の最終保険)
  void (globalThis.__bench_sink as { cacheSize?: number } | undefined)?.cacheSize;
}

main();
