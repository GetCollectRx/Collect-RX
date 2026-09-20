/**
 * getUsageSnapshot()'s lifetimeRecoveredCents summed outstandingAmount for
 * RESOLVED claims -- but transitionClaimRecovery.ts explicitly zeroes
 * outstandingAmount as part of the RESOLVED transition (data: { status:
 * 'RESOLVED', outstandingAmount: 0 }), so this always summed to 0
 * regardless of how much was actually recovered. Surfaced on
 * PracticeBillingPage.tsx as "Lifetime AR recovered" -- a key ROI/retention
 * metric a paying practice sees to know CollectRx is working. Reproduced
 * live via GET /api/billing/plan: recoveredCents: 0 for a demo practice
 * whose 25 resolved claims actually totaled $41,270 in
 * billedAmount-minus-outstandingAmount.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/server/index.js';
import { getUsageSnapshot } from '../src/server/plans/usagePeriodService.js';
import { createPracticeForTests } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[usageSnapshotLifetimeRecovered] DATABASE_URL unreachable — skipping:', (e as Error).message);
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

(dbReady ? describe : describe.skip)('getUsageSnapshot — lifetimeRecoveredCents', () => {
  it('reflects billedAmount minus outstandingAmount for resolved claims, not just outstandingAmount', async () => {
    const practice = await createPracticeForTests(prisma);
    try {
      // Mirrors the real RESOLVED transition (transitionClaimRecovery.ts):
      // outstandingAmount is zeroed out when a claim resolves.
      await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: 'RECOVERED-TEST-1',
          patientToken: 'test-token-not-real-phi',
          billedAmount: 500,
          outstandingAmount: 0,
          daysOutstanding: 20,
          status: 'RESOLVED',
        },
      });
      await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: 'RECOVERED-TEST-2',
          patientToken: 'test-token-not-real-phi',
          billedAmount: 300,
          outstandingAmount: 0,
          daysOutstanding: 15,
          status: 'RESOLVED',
        },
      });
      // A still-open claim must not contribute.
      await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: 'OPEN-TEST-1',
          patientToken: 'test-token-not-real-phi',
          billedAmount: 900,
          outstandingAmount: 900,
          daysOutstanding: 10,
          status: 'PENDING',
        },
      });

      const snapshot = await getUsageSnapshot(prisma, practice.id);
      expect(snapshot?.lifetimeRecoveredCents).toBe(80000);
    } finally {
      await prisma.insuranceClaim.deleteMany({ where: { practiceId: practice.id } });
      await prisma.practice.delete({ where: { id: practice.id } });
    }
  });
});
