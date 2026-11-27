import assert from 'node:assert/strict';

const ids = Array.from({ length: 100 }, (_, i) => i);
const latencyMs = 2;
const delay = (id: number) => new Promise<number>(resolve =>
  setTimeout(() => resolve(id), latencyMs));

async function sequential() {
  const results = [];
  for (const id of ids) results.push(await delay(id));
  return results;
}

function concurrent() {
  return Promise.all(ids.map(delay));
}

async function measure(label: string, run: () => Promise<number[]>) {
  const samples: number[] = [];
  for (let i = 0; i < 12; i++) {
    const start = performance.now();
    const results = await run();
    const elapsed = performance.now() - start;
    assert.deepStrictEqual(results, ids);
    if (i >= 2) samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  const median = (samples[4] + samples[5]) / 2;
  const mean = samples.reduce((sum, time) => sum + time, 0) / samples.length;
  const variance = samples.reduce((sum, time) => sum + (time - mean) ** 2, 0) / samples.length;
  console.log(`${label} median=${median.toFixed(3)}ms (±std=${Math.sqrt(variance).toFixed(3)}ms)`);
  return median;
}

console.log(`node=${process.version} v8=${process.versions.v8} n=${ids.length} timer=${latencyMs}ms iter=10 warmup=2`);
const slow = await measure('before', sequential);
const fast = await measure('after', concurrent);
console.log(`ratio=${(slow / fast).toFixed(1)}×`);
