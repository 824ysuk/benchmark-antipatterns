import assert from 'node:assert/strict';
import { benchmark } from '../../scripts/bench.ts';

const N = 1_000;
const items = Array.from({ length: N }, (_, i) => ({ name: `key${i}`, value: i }));

const before = () => {
  return items.reduce((acc, item) => ({ ...acc, [item.name]: item.value }), {});
};
const after = () => {
  return items.reduce<Record<string, number>>((acc, item) => {
    acc[item.name] = item.value;
    return acc;
  }, {});
};

assert.deepStrictEqual(after(), before());
const options = { warmupRounds: 2, iterations: 10 };
const slow = benchmark('before', before, N, options);
const fast = benchmark('after', after, N, options);
console.log(`ratio=${(slow.median / fast.median).toFixed(1)}×`);
