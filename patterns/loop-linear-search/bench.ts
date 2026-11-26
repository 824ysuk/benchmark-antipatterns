import assert from 'node:assert/strict';
import { benchmark } from '../../scripts/bench.ts';

const N = 10_000;
const orders = Array.from({ length: N }, (_, i) => ({ userId: i, data: 'x' }));
orders.push({ userId: 0, data: 'duplicate' });
const users  = Array.from({ length: N }, (_, i) => ({ id: i }));

const before = () => {
  const r = [];
  for (const u of users) r.push(orders.find(o => o.userId === u.id) ?? null);
  return r;
};
const after = () => {
  const m = new Map();
  for (const order of orders) {
    if (!m.has(order.userId)) m.set(order.userId, order);
  }
  const r = [];
  for (const u of users) r.push(m.get(u.id) ?? null);
  return r;
};

assert.deepStrictEqual(after(), before());
const options = { warmupRounds: 2, iterations: 10 };
const slow = benchmark('before', before, N, options);
const fast = benchmark('after', after, N, options);
console.log(`ratio=${(slow.median / fast.median).toFixed(1)}×`);
