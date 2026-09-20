/**
 * computeAgingReport used to filter its claim query by `createdAt >= since`
 * under a '30d'/'90d'/'all' timeframe that defaulted to '30d' -- and was
 * hardcoded to '30d' for the practice dashboard summary and the PDF/HTML
 * export regardless of what a user selected. daysOutstanding (the age
 * bucket) is frequently backfilled from the practice's prior PMS data at
 * CSV import time, so a claim's createdAt (when it entered CollectRx) has
 * no relationship to its actual age -- a claim imported 45 days ago that
 * was already 95 days outstanding at import time vanished from every
 * "Open claims by age bucket" view except the one nobody defaults to
 * ('all'). Reproduced live via the real /reports/aging endpoint before
 * this fix: the 31-60/61-90/90+ buckets all read $0 for a practice that
 * actually had six figures of cents aging past 30 days.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/server/index.js';
import { computeAgingReport } from '../src/server/services/platformReports.js';
import { createPracticeForTests } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[agingReportTimeframe] DATABASE_URL unreachable — skipping:', (e as Error).message);
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

(dbReady ? describe : describe.skip)('computeAgingReport — claims are bucketed regardless of when they were imported', () => {
  it('includes a claim created long ago that is still outstanding, in the correct age bucket', async () => {
    const practice = await createPracticeForTests(prisma);
    try {
      await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: 'AGE-TEST-OLD-IMPORT',
          patientToken: 'test-token-not-real-phi',
          billedAmount: 800,
          outstandingAmount: 800,
          daysOutstanding: 95,
          status: 'PENDING',
          // Simulates a CSV import that backfilled daysOutstanding from the
          // practice's prior PMS export — the row entered CollectRx long
          // after the claim itself first went outstanding.
          createdAt: new Date(Date.now() - 45 * 86400000),
        },
      });

      const { buckets } = await computeAgingReport(prisma, practice.id);
      const over90 = buckets.find((b) => b.label === '90+');
      expect(over90?.claimCount).toBe(1);
      expect(over90?.totalAmount).toBe(80000);
    } finally {
      await prisma.insuranceClaim.deleteMany({ where: { practiceId: practice.id } });
      await prisma.practice.delete({ where: { id: practice.id } });
    }
  });
});
