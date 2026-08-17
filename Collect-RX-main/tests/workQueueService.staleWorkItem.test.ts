/**
 * P10-12: syncWorkItemsForPractice only ever upserted WorkItems for claims
 * still in the open-status set — nothing ever closed a WorkItem whose source
 * claim resolved (or was soft-deleted). Same class of bug as the P10-03/04
 * call_escalations desync: a side table meant to mirror insurance_claims'
 * status silently drifted out of sync once the claim left the state that
 * created the row. Reproduced directly against real Postgres: an open claim's
 * WorkItem stayed 'open' after the claim was marked RESOLVED with $0
 * outstanding, even after a resync — it would show in the priority queue
 * forever.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { syncWorkItemsForPractice } from '../src/server/services/workQueueService.js';
import { createPracticeForTests } from './factories/practice.js';

const prisma = new PrismaClient();

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[workQueueService.staleWorkItem] DATABASE_URL unreachable — skipping:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!dbReady)('syncWorkItemsForPractice — closes WorkItems for claims that left the open set', () => {
  it('closes a WorkItem once its claim resolves, instead of leaving it open forever', async () => {
    const practice = await createPracticeForTests(prisma);
    try {
      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: 'STALE-WI-1',
          patientToken: 'tok-stale-wi-1',
          billedAmount: 300,
          outstandingAmount: 300,
          daysOutstanding: 40,
          status: 'PENDING',
        },
      });

      await syncWorkItemsForPractice(prisma, practice.id);
      const openItem = await prisma.workItem.findFirst({
        where: { practiceId: practice.id, sourceType: 'insurance_claim', sourceId: claim.id },
      });
      expect(openItem?.status).toBe('open');

      await prisma.insuranceClaim.update({
        where: { id: claim.id },
        data: { status: 'RESOLVED', outstandingAmount: 0 },
      });
      await syncWorkItemsForPractice(prisma, practice.id);

      const closedItem = await prisma.workItem.findFirst({
        where: { practiceId: practice.id, sourceType: 'insurance_claim', sourceId: claim.id },
      });
      expect(closedItem?.status).toBe('closed');
    } finally {
      await prisma.workItem.deleteMany({ where: { practiceId: practice.id } });
      await prisma.insuranceClaim.deleteMany({ where: { practiceId: practice.id } });
      await prisma.practice.delete({ where: { id: practice.id } }).catch(() => undefined);
    }
  });

  it('does not touch WorkItems belonging to other practices', async () => {
    const practiceA = await createPracticeForTests(prisma);
    const practiceB = await createPracticeForTests(prisma);
    try {
      const claimB = await prisma.insuranceClaim.create({
        data: {
          practiceId: practiceB.id,
          carrierId: 'sun_life',
          claimNumber: 'STALE-WI-B',
          patientToken: 'tok-stale-wi-b',
          billedAmount: 150,
          outstandingAmount: 150,
          daysOutstanding: 40,
          status: 'PENDING',
        },
      });
      await syncWorkItemsForPractice(prisma, practiceB.id);

      // Resyncing practice A must not close practice B's still-open item.
      await syncWorkItemsForPractice(prisma, practiceA.id);

      const itemB = await prisma.workItem.findFirst({
        where: { practiceId: practiceB.id, sourceType: 'insurance_claim', sourceId: claimB.id },
      });
      expect(itemB?.status).toBe('open');
    } finally {
      await prisma.workItem.deleteMany({ where: { practiceId: { in: [practiceA.id, practiceB.id] } } });
      await prisma.insuranceClaim.deleteMany({ where: { practiceId: { in: [practiceA.id, practiceB.id] } } });
      await prisma.practice.deleteMany({ where: { id: { in: [practiceA.id, practiceB.id] } } });
    }
  });
});
