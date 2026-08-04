/**
 * Two DSO-scale correctness properties of the desk queue dispatch tick:
 *
 * 1. Distributed lease — if the app is ever horizontally scaled, only one
 *    replica's tick body should run per cycle (queueEngine.ts's in-process
 *    isTickRunning guard alone doesn't cover that).
 * 2. Fairness rotation — a practice skipped this tick due to slot-budget
 *    exhaustion must not be skipped again next tick just because it's
 *    earlier in creation-id order; it should move to the front.
 *
 * DB-dependent; skipped with a clear log if DATABASE_URL is unreachable.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/server/index.js';
import { claimTickLease, orderPracticesByFairness } from '../src/server/frontDesk/queueEngine.js';
import { createPracticeForTests } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[queueEngineFairnessAndLease] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!dbReady)('claimTickLease — fleet-wide distributed lock', () => {
  it('grants the lease to only one of two concurrent claimants', async () => {
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    try {
      const [a, b] = await Promise.all([claimTickLease(prisma), claimTickLease(prisma)]);
      // Exactly one of the two concurrent claims wins — this is what stops
      // two replicas from both running the tick body in the same cycle.
      expect([a, b].filter(Boolean)).toHaveLength(1);
    } finally {
      await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    }
  });

  it('rejects a second claim while the lease is still live', async () => {
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    try {
      const first = await claimTickLease(prisma);
      expect(first).toBe(true);
      const second = await claimTickLease(prisma);
      expect(second).toBe(false);
    } finally {
      await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    }
  });

  it('allows reclaiming a stale (expired) lease', async () => {
    await prisma.queueEngineLease.upsert({
      where: { id: 'global' },
      create: { id: 'global', lockedUntil: new Date(Date.now() - 60_000), lockedBy: 'dead-instance' },
      update: { lockedUntil: new Date(Date.now() - 60_000), lockedBy: 'dead-instance' },
    });
    try {
      const claimed = await claimTickLease(prisma);
      expect(claimed).toBe(true);
    } finally {
      await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    }
  });
});

describe.skipIf(!dbReady)('orderPracticesByFairness — no practice starved indefinitely', () => {
  it('orders never-served practices before ones served recently, oldest first', async () => {
    const neverServed = await createPracticeForTests(prisma);
    const servedLongAgo = await createPracticeForTests(prisma);
    const servedRecently = await createPracticeForTests(prisma);
    try {
      await prisma.practiceDeskState.create({
        data: { practiceId: servedLongAgo.id, lastServedAt: new Date(Date.now() - 60 * 60 * 1000) },
      });
      await prisma.practiceDeskState.create({
        data: { practiceId: servedRecently.id, lastServedAt: new Date() },
      });

      const order = await orderPracticesByFairness(prisma);
      const ids = order.map((p) => p.id);
      const posNever = ids.indexOf(neverServed.id);
      const posLongAgo = ids.indexOf(servedLongAgo.id);
      const posRecent = ids.indexOf(servedRecently.id);

      expect(posNever).toBeGreaterThanOrEqual(0);
      // Never-served (NULL lastServedAt) sorts before any timestamp — first in line.
      expect(posNever).toBeLessThan(posLongAgo);
      // Served-longer-ago sorts before served-more-recently.
      expect(posLongAgo).toBeLessThan(posRecent);
    } finally {
      await prisma.practiceDeskState.deleteMany({
        where: { practiceId: { in: [neverServed.id, servedLongAgo.id, servedRecently.id] } },
      });
      await prisma.practice.deleteMany({ where: { id: { in: [neverServed.id, servedLongAgo.id, servedRecently.id] } } });
    }
  });

  it('a practice skipped this tick (never touched) rotates to the front next tick', async () => {
    // Simulates the exact starvation scenario: with slot budget for only 1 of
    // 2 practices, whichever the loop reaches first gets its lastServedAt
    // bumped; the other keeps its old value and must lead the very next order.
    const reached = await createPracticeForTests(prisma);
    const skipped = await createPracticeForTests(prisma);
    try {
      const initialOrder = await orderPracticesByFairness(prisma);
      const initialIds = initialOrder.map((p) => p.id);
      expect(initialIds.indexOf(reached.id)).toBeGreaterThanOrEqual(0);
      expect(initialIds.indexOf(skipped.id)).toBeGreaterThanOrEqual(0);

      // Simulate the tick loop reaching only the first practice in order and
      // touching its lastServedAt, exactly as runDeskQueueTick does per entry.
      const firstInLine = initialIds[0] === reached.id || initialIds[0] === skipped.id ? initialIds[0] : reached.id;
      await prisma.practiceDeskState.upsert({
        where: { practiceId: firstInLine },
        create: { practiceId: firstInLine, lastServedAt: new Date() },
        update: { lastServedAt: new Date() },
      });
      const neverTouched = firstInLine === reached.id ? skipped.id : reached.id;

      const nextOrder = await orderPracticesByFairness(prisma);
      const nextIds = nextOrder.map((p) => p.id);
      // The untouched practice (skipped last time) now leads over the one that was just served.
      expect(nextIds.indexOf(neverTouched)).toBeLessThan(nextIds.indexOf(firstInLine));
    } finally {
      await prisma.practiceDeskState.deleteMany({ where: { practiceId: { in: [reached.id, skipped.id] } } });
      await prisma.practice.deleteMany({ where: { id: { in: [reached.id, skipped.id] } } });
    }
  });
});
