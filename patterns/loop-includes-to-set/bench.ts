import assert from 'node:assert/strict';
import { benchmark } from '../../scripts/bench.ts';

const N = 10_000;
const allowList = Array.from({ length: N }, (_, i) => `role_${i}`);
const items     = Array.from({ length: N }, (_, i) => ({ role: `role_${(i * 2) % N}` }));

const before = () => {
  const r = [];
  for (const item of items) {
    if (allowList.includes(item.role)) r.push(item);
  }
  return r;
};
const after = () => {
  const s = new Set(allowList);
  const r = [];
  for (const item of items) {
    if (s.has(item.role)) r.push(item);
  }
  return r;
};

assert.deepStrictEqual(after(), before());
const options = { warmupRounds: 2, iterations: 10 };
const slow = benchmark('before', before, N, options);
const fast = benchmark('after', after, N, options);
console.log(`ratio=${(slow.median / fast.median).toFixed(1)}×`);
