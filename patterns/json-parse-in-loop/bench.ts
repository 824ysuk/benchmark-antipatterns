import assert from 'node:assert/strict';
import { benchmark } from '../../scripts/bench.ts';

const N = 100_000;
const obj = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`key${i}`, i]));
const jsonString = JSON.stringify(obj);
const keys = Array.from({ length: N }, (_, i) => `key${i % 100}`);

const before = () => {
  const r = [];
  for (const key of keys) { const c = JSON.parse(jsonString); r.push(c[key]); }
  return r;
};
const after = () => {
  const c = JSON.parse(jsonString);
  const r = [];
  for (const key of keys) r.push(c[key]);
  return r;
};

assert.deepStrictEqual(after(), before());
const options = { warmupRounds: 2, iterations: 10 };
const slow = benchmark('before', before, N, options);
const fast = benchmark('after', after, N, options);
console.log(`ratio=${(slow.median / fast.median).toFixed(1)}×`);
