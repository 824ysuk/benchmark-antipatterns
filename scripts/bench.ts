// bench.ts — benchmark helper (Issue #15 §2 ドラフトの完成版)
//
// 想定 engine: Node.js v22+ (V8 12.x 系)。Bun (JSC) / Deno (V8) / ブラウザでは
// `performance.now()` 経路は動くが、`%GetOptimizationStatus` は V8 系限定。
//
// 設計参考:
//   - tinybench (https://github.com/tinylibs/tinybench): time-budget 型
//   - mitata    (https://github.com/evanwashere/mitata): time-budget 型
// 本 helper は教材用途のため iterations 固定型 (再現性優先)。
//
// 規律 (CONTRIBUTING.md 連携):
//   - engine / version 出力を benchmark() 内で実施 (process.versions.v8 / .node)
//   - 単一値断言禁止 — median は必ず std と pair で出力する
//   - 数値は条件付き引用 — 例: "Node v22 / V8 12.x / n=10000 で 42.6× 報告例"
//   - 出典は ECMA-262 current draft を section 番号付きで参照
//       unshift   §23.1.3.37  https://tc39.es/ecma262/#sec-array.prototype.unshift
//       push      §23.1.3.23  https://tc39.es/ecma262/#sec-array.prototype.push
//     Array.prototype.fill の Stage / 仕様変更を踏む場合は 2025-02-28 例外を踏襲
//     (本 helper 自体は fill 非依存だが、利用パターンが触れたとき誤記しない)
//   - Maglev は escape analysis を持たない mid-tier 設計
//     (https://v8.dev/blog/maglev) であり、TurboFan と区別して扱う
//   - workflow Run ID を一次情報として引用しない (検討経緯メモのみで使う)
//
// 実行例:
//   node --allow-natives-syntax --experimental-strip-types ./bench.ts
//   (Node v22 LTS 以降: TypeScript の type stripping が experimental。
//    要 stable な実行: `tsx ./bench.ts` または `ts-node ./bench.ts`)

declare const globalThis: any;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchOptions {
  /** 未指定なら n から auto-tune される。明示すれば auto-tune を上書き。 */
  iterations?: number;
  /** 未指定なら n から auto-tune される。warmup loop の回数。 */
  warmupRounds?: number;
  /**
   * %GetOptimizationStatus(fn) を出力に併記する。
   * 要 `--allow-natives-syntax`、V8 系 engine のみ。
   * それ以外の環境では自動的に skip され null が入る。
   */
  reportOptStatus?: boolean;
  /**
   * Engine 情報の出力を抑制したい場合のみ true。
   * 既定 false: re-producibility のため毎回出力する。
   */
  silentEngineInfo?: boolean;
}

export interface EngineInfo {
  /** Node.js version (例: "22.13.0")。Node 以外では undefined */
  node?: string;
  /** V8 version (例: "12.4.254.21")。V8 系以外では undefined */
  v8?: string;
  /** runtime 名 ("node" | "bun" | "deno" | "browser" | "unknown") */
  runtime: string;
}

export interface BenchResult {
  label: string;
  n: number;
  /** 中央値 (ms)。単一値断言禁止のため必ず std と pair で評価する */
  median: number;
  /** 95 パーセンタイル (ms) */
  p95: number;
  /** population stdev (ms) */
  std: number;
  /** 平均値 (ms)。median と乖離が大きければ分布形状が歪んでいる */
  mean: number;
  iterations: number;
  warmupRounds: number;
  /** null = native syntax 不可で skip (V8 以外 or flag なし) */
  optStatus: number | null;
  /** 実行時 engine 情報 (process.versions.* など) */
  engine: EngineInfo;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * workload size n に応じて iterations / warmup を自動調整。
 * 小 n: per-call が短いので iterations を増やしてばらつきを潰す。
 * 大 n: 1 回が重いので iterations を減らして総時間を抑える。
 * warmup は TurboFan の関数 hot threshold (経験的に数千 invocation) を超える数を選ぶ。
 */
function autoTune(n: number): { iterations: number; warmupRounds: number } {
  if (n <= 1_000) return { iterations: 200, warmupRounds: 10_000 };
  if (n <= 100_000) return { iterations: 50, warmupRounds: 2_000 };
  return { iterations: 20, warmupRounds: 1_000 };
}

/**
 * 線形補間 quantile。tinybench も同等の方式。
 * 前提: sorted は昇順ソート済み。O(1) でアクセスする。
 */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lo = sorted[base]!;
  const hi = sorted[base + 1];
  return hi !== undefined ? lo + rest * (hi - lo) : lo;
}

/** Population standard deviation. 分母は N (N-1 ではない)。 */
function stdev(xs: number[], mean: number): number {
  if (xs.length === 0) return NaN;
  const sumSq = xs.reduce((s, x) => s + (x - mean) ** 2, 0);
  return Math.sqrt(sumSq / xs.length);
}

/**
 * %GetOptimizationStatus(fn) を Function コンストラクタ越しに読む。
 * --allow-natives-syntax 無し: parse 段階で SyntaxError → catch
 * V8 以外 (JSC/SpiderMonkey): 未定義参照で ReferenceError → catch
 * 戻り値の bit mask 解釈は V8 ソース src/runtime/runtime-test.cc の
 *   OptimizationStatus enum を参照 (bit 配置は V8 version 間で変動)。
 *   kIsFunction(1<<0) / kMarkedForOptimization(1<<3) / kOptimized(1<<4)
 *   / kTurboFanned(1<<7) / kInterpreted(1<<8) / kMaglevved(1<<11) 等。
 * 数値リテラルでの判定はせず、実行時の V8 ソースを引き直す。
 */
function readOptStatus(fn: Function): number | null {
  try {
    const reader = new Function(
      "fn",
      "return %GetOptimizationStatus(fn);"
    ) as (f: Function) => number;
    return reader(fn);
  } catch {
    return null;
  }
}

/** runtime 種別と version 文字列を取得 (subprocess を起動せず in-process で完結)。 */
function detectEngine(): EngineInfo {
  const g = globalThis as any;
  // Bun: globalThis.Bun が存在 (https://bun.sh/docs/api/globals)
  if (typeof g.Bun !== "undefined") {
    return { runtime: "bun", node: g.Bun?.version, v8: undefined };
  }
  // Deno: globalThis.Deno が存在 (https://docs.deno.com/api/deno/)
  if (typeof g.Deno !== "undefined") {
    return {
      runtime: "deno",
      node: g.Deno?.version?.deno,
      v8: g.Deno?.version?.v8,
    };
  }
  // Node.js: process.versions に node/v8 を持つ
  if (typeof g.process !== "undefined" && g.process?.versions) {
    return {
      runtime: "node",
      node: g.process.versions.node,
      v8: g.process.versions.v8,
    };
  }
  // ブラウザ等
  return { runtime: "unknown" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Benchmark a function with warmup, DCE 抑止, p95/std reporting.
 *
 * @param label   表示・結果ラベル (パターン名等)
 * @param fn      計測対象 (副作用なしを推奨。戻り値は sink に書き出される)
 * @param n       workload size (要素数等)。auto-tune の入力でもある
 * @param opts    上書きオプション
 * @returns       BenchResult (median / p95 / std を必ず pair で持つ)
 *
 * @example
 *   const arr = Array.from({ length: 10_000 }, (_, i) => i);
 *   benchmark("reduce sum", () => arr.reduce((a, b) => a + b, 0), arr.length, {
 *     reportOptStatus: true,
 *   });
 */
export function benchmark<T>(
  label: string,
  fn: () => T,
  n: number,
  opts: BenchOptions = {}
): BenchResult {
  const tuned = autoTune(n);
  const iterations = opts.iterations ?? tuned.iterations;
  const warmupRounds = opts.warmupRounds ?? tuned.warmupRounds;
  const engine = detectEngine();

  // ---- engine info を最初に出力 (再現性確保) ----
  if (!opts.silentEngineInfo) {
    const engStr =
      engine.runtime === "node"
        ? `node=${engine.node} v8=${engine.v8}`
        : engine.runtime === "deno"
        ? `deno=${engine.node} v8=${engine.v8}`
        : engine.runtime === "bun"
        ? `bun=${engine.node}`
        : `runtime=${engine.runtime}`;
    console.log(`[${label}] engine: ${engStr}`);
  }

  // ---- warmup ----
  // 戻り値を globalThis.__bench_sink に書き出して DCE 抑止 + JIT 昇格を促す。
  // TurboFan は escape analysis を持つため局所変数だけだと戻り値計算ごと削られうる。
  // Maglev は escape analysis を持たない mid-tier (https://v8.dev/blog/maglev) なので
  // Maglev 段階でも global property store 経路で十分。
  for (let i = 0; i < warmupRounds; i++) {
    globalThis.__bench_sink = fn();
  }

  // ---- 本計測 ----
  const times: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const start = performance.now(); // MDN: monotonic, sub-ms 解像度
    const ret = fn();
    const elapsed = performance.now() - start;
    globalThis.__bench_sink = ret; // DCE 回避 (本計測側にも必須)
    times[i] = elapsed;
  }

  times.sort((a, b) => a - b); // O(n log n), n = iterations (≤ 200)
  const median = quantile(times, 0.5);
  const p95 = quantile(times, 0.95);
  const mean = times.reduce((s, x) => s + x, 0) / times.length;
  const std = stdev(times, mean);

  const optStatus = opts.reportOptStatus ? readOptStatus(fn) : null;

  // ---- 出力 (単一値断言禁止: median は必ず ± std と pair) ----
  const fmt = (x: number) => x.toFixed(3);
  const optStr =
    optStatus == null ? "" : ` opt=0x${optStatus.toString(16)}`;
  console.log(
    `[${label}] n=${n} median=${fmt(median)}ms ` +
      `(±std=${fmt(std)}ms, p95=${fmt(p95)}ms, mean=${fmt(mean)}ms) ` +
      `iter=${iterations} warmup=${warmupRounds}${optStr}`
  );

  // ばらつき警告 (経験則: std/median > 0.5 は GC / 他プロセス干渉 /
  // iteration 不足 / kind 遷移混入 のいずれかを疑う閾値)
  if (std > 0.5 * median) {
    console.warn(
      `[${label}] WARN std/median=${(std / median).toFixed(2)} > 0.5. ` +
        `GC / 他プロセス / iter 不足 / kind 遷移混入の疑い。` +
        `iter を倍にする・他プロセスを落とす・warmup を伸ばす を試す。`
    );
  }

  // optStatus が報告依頼されたが取得不能だった場合の説明
  if (opts.reportOptStatus && optStatus == null) {
    console.warn(
      `[${label}] NOTE %GetOptimizationStatus skipped ` +
        `(--allow-natives-syntax 未指定 or V8 系以外の engine)。`
    );
  }

  return {
    label,
    n,
    median,
    p95,
    std,
    mean,
    iterations,
    warmupRounds,
    optStatus,
    engine,
  };
}

// ---------------------------------------------------------------------------
// Re-exports for power users (テスト / 検証用に internal を露出)
// ---------------------------------------------------------------------------

export { autoTune, quantile, stdev, readOptStatus, detectEngine };

// ---------------------------------------------------------------------------
// 利用例 (このファイルを直接実行したときの sanity check)
// ---------------------------------------------------------------------------
//
// 推奨実行コマンド:
//   node --allow-natives-syntax --import tsx ./scripts/bench.ts
// または:
//   npx tsx --allow-natives-syntax ./scripts/bench.ts
//
// 期待出力 (Node v22 / V8 12.x の報告例。手元環境で異なる):
//   [reduce sum] engine: node=22.13.0 v8=12.4.254.21
//   [reduce sum] n=10000 median=0.012ms (±std=0.003ms, p95=0.018ms, mean=0.013ms) iter=50 warmup=2000 opt=0x...
//
// import { benchmark } from "./bench.ts";
// const arr = Array.from({ length: 10_000 }, (_, i) => i);
// benchmark("reduce sum", () => arr.reduce((a, b) => a + b, 0), arr.length, {
//   reportOptStatus: true,
// });
//
// 注意:
// - 上記の数値は「報告例」であり、断言値ではない。Node v22 / V8 12.x / n=10000 で
//   同条件であれば近似値が出る、という条件付き引用として扱う。
// - 大量の % intrinsics や --jitless 比較は README §3 (検証手段付録) 参照。
// - ECMA-262 上で計算量が保証されない点に注意 (実装依存):
//     Array.prototype.unshift §23.1.3.37  https://tc39.es/ecma262/#sec-array.prototype.unshift
//     Array.prototype.push    §23.1.3.23  https://tc39.es/ecma262/#sec-array.prototype.push
