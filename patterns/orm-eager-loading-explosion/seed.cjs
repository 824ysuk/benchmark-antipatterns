const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const [U, O, I, R] = [100, 10, 5, 3];

(async () => {
  if (await p.user.count()) throw new Error("Use a fresh benchmark database.");

  await p.user.createMany({ data: Array.from({ length: U }, (_, i) => ({ name: `u${i}` })) });
  const users = await p.user.findMany();
  await p.order.createMany({ data: users.flatMap(u => Array.from({ length: O }, () => ({ userId: u.id }))) });
  const orders = await p.order.findMany();
  await p.orderItem.createMany({ data: orders.flatMap(o => Array.from({ length: I }, () => ({ orderId: o.id }))) });
  const items = await p.orderItem.findMany();
  await p.itemReview.createMany({ data: items.flatMap(i => Array.from({ length: R }, () => ({ itemId: i.id, score: 5 }))) });
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => p.$disconnect());
