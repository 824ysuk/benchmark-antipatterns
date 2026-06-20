/**
 * Benchmark: ループ内 Array.prototype.unshift (O(n²)) vs push + reverse (O(n))
 * Pattern: patterns/loop-unshift (Issue #7 §4 設計準拠)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 実行方法
 * ─────────────────────────────────────────────────────────────────────────────
 *   node --allow-natives-syntax bench.ts   # %DebugPrint で elements kind を確認
 *   node bench.ts                          # %DebugPrint なし (実装系を問わず動く)
 *
 *   .ts のまま実行できない環境では事前トランスパイル:
 *     npx tsc --target esnext --module nodenext bench.ts && node --allow-natives-syntax bench.js
 *   Node 22+ は --experimental-strip-types で .ts 直実行可。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Motivation (なぜこの比較を行うか)
 * ─────────────────────────────────────────────────────────────────────────────
 *  ECMA-262 §23.1.3.37 (current editor's draft) Array.prototype.unshift は
 *  「既存全要素を後方に 1 つずらしてから先頭に書く」アルゴリズムで規定されており、
 *  V8/SpiderMonkey/JavaScriptCore の主要 engine が dense array を連続メモリ
 *  (FixedArray / DenseElements / Butterfly) で保持する実装選択により、
 *  1 回の unshift は実装上 O(現在の長さ) になる。N 回のループは合計 O(N²)。
 *
 *  対比対象 ECMA-262 §23.1.3.23 push は「length 位置に書いて length+1」する
 *  だけで shifting が無く、V8 の幾何成長 (NewElementsCapacity ≈ 1.5x + 16) と
 *  CLRS 17.4 Aggregate method で push N 回が合計 O(N)。最後の reverse は in-place
 *  O(N) なので合計 O(N)。
 *
 *  本ファイルは Issue #7 §4 で定義したベンチマーク設計の実装版。
 *  ─ N = 1,000 / 10,000 / 100,000 の 3 段階
 *  ─ warmup を固定 invocation 数で実施 (V8 階層 JIT のしきい値は版間で揺れるため保守的に多めに取る)
 *  ─ DCE 回避は globalThis.__bench_sink への escape
 *  ─ 統計は median + p95 + std を併記 (mean は外れ値耐性が無いため非採用)
 *  ─ elements kind が PACKED_SMI_ELEMENTS を維持していることを %DebugPrint で確認 (任意)
 *
 *  ※ 単一値の倍率断言はしない。出力は条件 (Node version / V8 version / n / iterations)
 *     を必ず併記し、§5 への引き継ぎ規律を守る。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Caveats
 * ─────────────────────────────────────────────────────────────────────────────
 *  - Maglev は mid-tier JIT で escape analysis を持たない (EA は TurboFan の
 *    intraprocedural + inlining 経由のみ)。本ベンチでは arr がループ外へ escape
 *    するため、いずれにせよ MoveElements (memmove) は省略されない。
 *  - %DebugPrint / %GetOptimizationStatus は V8 内部 intrinsic で出力フォーマットは
 *    安定 API ではない。SpiderMonkey/JSC では動かない。
 *  - 「全 engine で O(n²)」は仕様要件ではなく実装収束。JSC ArrayStorage は
 *    m_indexBias で unshift を amortized O(1) に近づける歴史的経路を持つ
 *    (SpiderMonkey Bugzilla #1348772 参照)。
 *  - Array.prototype.fill のように仕様 PR で観測 semantics が変わったケースもある
 *    (2025-02-28 の TC39 議論)。「現行 spec text」と「ある時点での実装」は分けて扱う。
 *  - workflow Run ID は実装の出典にしない (再現可能な一次情報は ECMA-262 / V8 source)。
 */

// ─────────────────────────────────────────────────────────────────────────────
// V8 native intrinsics (--allow-natives-syntax 指定時のみ利用可)
// ─────────────────────────────────────────────────────────────────────────────
declare function DebugPrint(o: unknown): void;
declare function GetOptimizationStatus(fn: Function): number;

// `globalThis` の sink 拡張 (DCE 回避)
declare global {
  // eslint-disable-next-line no-var
  var __bench_sink: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// 共通ユーティリティ
// ─────────────────────────────────────────────────────────────────────────────

const HAS_NATIVES: boolean = (() => {
  // --allow-natives-syntax があれば `%DebugPrint(0)` は parse 通過 + 実行成功する。
  // 無いと SyntaxError で parse 段階で失敗する (try-catch で捕捉可)。
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const probe = new Function("%DebugPrint(0); return true;") as () => boolean;
    return probe();
  } catch {
    return false;
  }
})();

function stats(samples: readonly number[]): { median: number; p95: number; std: number; n: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { median: NaN, p95: NaN, std: NaN, n: 0 };
  const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  // p95: linear interpolation (NIST type 7)
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
// 計測対象 — §4.5 の仕様準拠
// ─────────────────────────────────────────────────────────────────────────────

/** ❌ アンチパターン: ループ内 unshift (O(n²)) */
function runUnshift(n: number): number {
  const arr: number[] = []; // PACKED_SMI_ELEMENTS で開始
  for (let i = 0; i < n; i++) {
    arr.unshift(i); // O(len): V8 内部 MoveElements → memmove(len)
  }
  globalThis.__bench_sink = arr; // DCE 回避 (escape)
  return arr.length;
}

/** ✅ 改善: push + reverse (合計 O(N)) */
function runPushReverse(n: number): number {
  const arr: number[] = [];
  for (let i = 0; i < n; i++) {
    arr.push(i); // amortized O(1): NewElementsCapacity ≈ 1.5x + 16
  }
  arr.reverse(); // in-place O(N)
  globalThis.__bench_sink = arr;
  return arr.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// elements kind 確認 (任意・--allow-natives-syntax 限定)
// ─────────────────────────────────────────────────────────────────────────────

function probeElementsKind(label: string, factory: () => number[]): void {
  if (!HAS_NATIVES) return;
  // Function コンストラクタ経由で `%DebugPrint` を呼ぶ (TypeScript 構文を介さない)。
  // 出力フォーマットは V8 版間で変わるため、結果は stderr 側に出る点のみ保証する。
  const arr = factory();
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const probe = new Function(
      "arr",
      "label",
      "console.log('[elements-kind probe] ' + label); %DebugPrint(arr);"
    );
    probe(arr, label);
  } catch (e) {
    console.warn(`[elements-kind probe] ${label}: skipped (${(e as Error).message})`);
  }
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
  // Warmup: V8 階層実行 (Ignition インタプリタ → Sparkplug / Maglev / TurboFan JIT) の昇格しきい値は
  // 公開 API ではなく版間で揺れる。保守的に多めの invocation で tier 到達を狙う。
  // n の影響を打ち消すため warmup は小さい n で十分回数行う。
  const warmupN = Math.min(spec.n, 256);
  for (let i = 0; i < spec.warmupInvocations; i++) {
    spec.fn(warmupN);
  }

  // ループ前に GC ヒント (Node の --expose-gc が無くても害は無い)
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
// メイン
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  // 環境メタデータ — §4.9 引き継ぎ規律: 単一値断言禁止、条件併記必須
  console.log("=".repeat(72));
  console.log("loop-unshift benchmark (Issue #7 §4)");
  console.log("=".repeat(72));
  console.log(`Node.js:           ${process.version}`);
  console.log(`V8:                ${process.versions.v8}`);
  console.log(`Platform / arch:   ${process.platform} / ${process.arch}`);
  console.log(`CPU model:         ${(process as unknown as { report?: { getReport(): { header: { cpus?: Array<{ model: string }> } } } }).report?.getReport().header.cpus?.[0]?.model ?? "(unknown)"}`);
  console.log(`%DebugPrint:       ${HAS_NATIVES ? "available (--allow-natives-syntax)" : "unavailable (run with --allow-natives-syntax to enable)"}`);
  console.log(`Date (UTC):        ${new Date().toISOString()}`);
  console.log("");
  console.log("Note: median ± std を主指標とし、単一値 (mean) の倍率断言はしない。");
  console.log("      p95/median > 2 のときは外れ値支配のため再測定推奨 (§4.6)。");
  console.log("");

  // elements kind 確認 — PACKED_SMI_ELEMENTS を維持していることをログに残す
  // (出力フォーマットは V8 版間で安定ではない)
  if (HAS_NATIVES) {
    probeElementsKind("after unshift loop  (n=1024)", () => {
      const a: number[] = [];
      for (let i = 0; i < 1024; i++) a.unshift(i);
      return a;
    });
    probeElementsKind("after push+reverse  (n=1024)", () => {
      const a: number[] = [];
      for (let i = 0; i < 1024; i++) a.push(i);
      a.reverse();
      return a;
    });
    console.log("");
  }

  // 計測対象 — §4.6 の反復回数表
  // n=100,000 で unshift は秒オーダーになりうるため iterations を減らす
  const matrix: Array<{ n: number; iterations: number }> = [
    { n: 1_000, iterations: 100 },
    { n: 10_000, iterations: 30 },
    { n: 100_000, iterations: 10 },
  ];
  const WARMUP = 20_000;

  const rows: Array<{
    n: number;
    iterations: number;
    unshift: BenchResult;
    push: BenchResult;
    speedup_median: number;
  }> = [];

  for (const { n, iterations } of matrix) {
    console.log(`── n = ${n.toLocaleString()} (warmup ${WARMUP} invocations / ${iterations} iterations) ──`);
    const u = bench({
      label: "loop unshift",
      fn: runUnshift,
      n,
      warmupInvocations: WARMUP,
      iterations,
    });
    const p = bench({
      label: "push + reverse",
      fn: runPushReverse,
      n,
      warmupInvocations: WARMUP,
      iterations,
    });

    console.log(
      `  ❌ loop unshift  : median=${fmtMs(u.median)} ms  p95=${fmtMs(u.p95)} ms  std=${fmtMs(u.std)} ms`
    );
    console.log(
      `  ✅ push + reverse: median=${fmtMs(p.median)} ms  p95=${fmtMs(p.p95)} ms  std=${fmtMs(p.std)} ms`
    );
    const ratioU = u.p95 / Math.max(u.median, Number.EPSILON);
    const ratioP = p.p95 / Math.max(p.median, Number.EPSILON);
    if (ratioU > 2 || ratioP > 2) {
      console.log(
        `  ⚠ p95/median > 2 (unshift=${ratioU.toFixed(2)}, push+reverse=${ratioP.toFixed(2)}). ` +
          `外れ値支配の可能性 — 再測定を検討 (§4.6)。`
      );
    }
    const speedup = u.median / Math.max(p.median, Number.EPSILON);
    console.log(
      `  → median speedup: ${speedup.toFixed(1)}× (条件: Node ${process.version} / V8 ${process.versions.v8} / n=${n})`
    );
    console.log("");
    rows.push({ n, iterations, unshift: u, push: p, speedup_median: speedup });
  }

  // サマリ表 — 単一値断言ではなく条件併記の形で出す
  console.log("=".repeat(72));
  console.log("Summary (条件付き — 出典に使うときは Node / V8 / n / iterations を必ず併記)");
  console.log("=".repeat(72));
  console.log(
    "| n        | unshift median±std (ms)   | push+rev median±std (ms)  | speedup |"
  );
  console.log(
    "|----------|---------------------------|---------------------------|---------|"
  );
  for (const r of rows) {
    const u = `${fmtMs(r.unshift.median).padStart(7)} ± ${fmtMs(r.unshift.std).padStart(7)}`;
    const p = `${fmtMs(r.push.median).padStart(7)} ± ${fmtMs(r.push.std).padStart(7)}`;
    console.log(
      `| ${String(r.n).padStart(8)} | ${u.padEnd(25)} | ${p.padEnd(25)} | ${r.speedup_median.toFixed(1).padStart(5)}× |`
    );
  }
  console.log("");
  console.log("引用例: \"Node v22 / V8 12.x / n=10,000 で約 N× の median speedup を観測 (PACKED_SMI 維持)\"");
  console.log("       ↑ engine / n / elements kind / iterations を併記しない単一値断言は避ける。");

  // sink を 1 回だけ参照して escape を確実にする (DCE 防止の最終保険)
  void (globalThis.__bench_sink as unknown[] | undefined)?.length;
}

main();
