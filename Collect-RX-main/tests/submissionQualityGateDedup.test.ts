/**
 * evaluateSubmissionQuality()'s "does a gate already exist" dedup check only
 * matched status: 'BLOCKING' -- but a YELLOW clearance creates a gate with
 * status: 'OPEN' (RED creates 'BLOCKING'). A claim with a persistent YELLOW
 * finding (e.g. no expectedAmount set) got a brand new SUBMISSION_QUALITY
 * ClaimRecoveryAction every time this ran instead of reusing the existing
 * one -- and this runs on every CSV import/re-import
 * (prismaClaimImporter.ts calls it unconditionally per upserted claim, and
 * CSV re-import of the same practice data is a normal, recurring
 * operation). Reproduced live via a direct script: 3 evaluations of one
 * claim produced 3 duplicate gate rows.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/server/index.js';
import { evaluateSubmissionQuality } from '../src/server/reconciliation/submissionQualityGate.js';
import { createPracticeForTests } from './factories/practice.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[submissionQualityGateDedup] DATABASE_URL unreachable — skipping:', (e as Error).message);
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

(dbReady ? describe : describe.skip)('evaluateSubmissionQuality — gate dedup', () => {
  it('re-evaluating a claim with a persistent YELLOW finding does not create duplicate gates', async () => {
    const practice = await createPracticeForTests(prisma);
    try {
      const claim = await prisma.insuranceClaim.create({
        data: {
          practiceId: practice.id,
          carrierId: 'sun_life',
          claimNumber: 'SUBQ-DEDUP-1',
          patientToken: 'test-token-not-real-phi',
          billedAmount: 500,
          outstandingAmount: 500,
          daysOutstanding: 20,
          status: 'PENDING',
          treatmentCodes: 'D2750',
          submittedAt: new Date(),
          servicedAt: new Date(),
          // expectedAmount intentionally left unset -> MISSING_EXPECTED (YELLOW)
        },
      });

      const r1 = await evaluateSubmissionQuality(prisma, practice.id, claim.id);
      expect(r1.clearance).toBe('YELLOW');
      const r2 = await evaluateSubmissionQuality(prisma, practice.id, claim.id);
      expect(r2.clearance).toBe('YELLOW');
      const r3 = await evaluateSubmissionQuality(prisma, practice.id, claim.id);
      expect(r3.clearance).toBe('YELLOW');

      const actions = await prisma.claimRecoveryAction.findMany({
        where: { claimId: claim.id, actionType: 'SUBMISSION_QUALITY' },
      });
      expect(actions).toHaveLength(1);
    } finally {
      await prisma.claimRecoveryAction.deleteMany({ where: { practiceId: practice.id } });
      await prisma.insuranceClaim.deleteMany({ where: { practiceId: practice.id } });
      await prisma.practice.delete({ where: { id: practice.id } });
    }
  });
});
