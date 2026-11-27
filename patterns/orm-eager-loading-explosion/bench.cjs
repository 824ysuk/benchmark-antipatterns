const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

const client = new PrismaClient();
const orderBy = { id: 'asc' };
const include = {
  orders: {
    orderBy,
    include: { items: { orderBy, include: { reviews: { orderBy } } } },
  },
};

const run = strategy => client.user.findMany({
  relationLoadStrategy: strategy,
  orderBy,
  include,
});

function median(samples) {
  const sorted = samples.toSorted((a, b) => a - b);
  return (sorted[4] + sorted[5]) / 2;
}

async function main() {
  const strategies = ['join', 'query'];
  const samples = { join: [], query: [] };
  const counts = await client.$transaction([
    client.user.count(),
    client.order.count(),
    client.orderItem.count(),
    client.itemReview.count(),
  ]);
  assert.deepStrictEqual(counts, [100, 1000, 5000, 15000], 'Run the complete seed in a fresh benchmark database.');
  const [{ server_version: postgres }] = await client.$queryRaw`SHOW server_version`;
  console.log(`node=${process.version} prisma=6.19.3 postgres=${postgres} users=${counts[0]}`);

  for (let round = 0; round < 12; round++) {
    const results = {};
    const order = round % 2 === 0 ? strategies : [...strategies].reverse();
    for (const strategy of order) {
      const start = performance.now();
      results[strategy] = await run(strategy);
      const elapsed = performance.now() - start;
      if (round >= 2) samples[strategy].push(elapsed);
    }
    assert.deepStrictEqual(results.query, results.join);
  }

  for (const strategy of strategies) {
    console.log(`${strategy} median=${median(samples[strategy]).toFixed(2)}ms`);
  }
  console.log(`ratio=${(median(samples.join) / median(samples.query)).toFixed(1)}×`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => client.$disconnect());
