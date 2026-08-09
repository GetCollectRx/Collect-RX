// Round-trips the Kill Test 1 synthetic-call fields (isSynthetic, testRunId,
// repPersona) against the real local Postgres — confirms the migration
// applied cleanly and that the new columns are 100% backward-compatible:
// a CallAttempt written the old way (no synthetic fields set) still defaults
// to isSynthetic=false with null testRunId/repPersona.
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch {
  dbReady = false;
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const practiceIds: string[] = [];

async function makePracticeAndClaim(): Promise<{ practiceId: string; claimId: string }> {
  const practice = await prisma.practice.create({
    data: {
      name: `Synthetic Fields Fixture ${suffix}-${practiceIds.length}`,
      passwordHash: 'synthetic-fields-test-password-hash',
    },
  });
  practiceIds.push(practice.id);

  const claim = await prisma.insuranceClaim.create({
    data: {
      practiceId: practice.id,
      carrierId: 'green_shield',
      claimNumber: `SYNTH-${suffix}-${practiceIds.length}`,
      patientToken: randomUUID(),
      billedAmount: 100,
      outstandingAmount: 100,
      daysOutstanding: 45,
    },
  });

  return { practiceId: practice.id, claimId: claim.id };
}

describe.skipIf(!dbReady)('CallAttempt synthetic test-call fields', () => {
  it('round-trips isSynthetic, testRunId, and repPersona for a Rep Simulator call', async () => {
    const { claimId } = await makePracticeAndClaim();
    const testRunId = randomUUID();

    const created = await prisma.callAttempt.create({
      data: {
        claimId,
        vapiCallId: `synthetic-${randomUUID()}`,
        initiatedAt: new Date(),
        isSynthetic: true,
        testRunId,
        repPersona: 'green_shield_carrier_rep',
      },
    });

    const fetched = await prisma.callAttempt.findUniqueOrThrow({ where: { id: created.id } });
    expect(fetched.isSynthetic).toBe(true);
    expect(fetched.testRunId).toBe(testRunId);
    expect(fetched.repPersona).toBe('green_shield_carrier_rep');
  });

  it('defaults isSynthetic to false with null testRunId/repPersona for a real call attempt', async () => {
    const { claimId } = await makePracticeAndClaim();

    const created = await prisma.callAttempt.create({
      data: {
        claimId,
        vapiCallId: `real-${randomUUID()}`,
        initiatedAt: new Date(),
        // Deliberately omitting isSynthetic/testRunId/repPersona — this is
        // exactly what every pre-existing real-call code path still writes.
      },
    });

    const fetched = await prisma.callAttempt.findUniqueOrThrow({ where: { id: created.id } });
    expect(fetched.isSynthetic).toBe(false);
    expect(fetched.testRunId).toBeNull();
    expect(fetched.repPersona).toBeNull();
  });

  it('finds synthetic calls scoped to one testRunId without pulling in other runs or real calls', async () => {
    const { claimId } = await makePracticeAndClaim();
    const runA = randomUUID();
    const runB = randomUUID();

    await prisma.callAttempt.createMany({
      data: [
        { claimId, vapiCallId: `runA-1-${randomUUID()}`, initiatedAt: new Date(), isSynthetic: true, testRunId: runA },
        { claimId, vapiCallId: `runA-2-${randomUUID()}`, initiatedAt: new Date(), isSynthetic: true, testRunId: runA },
        { claimId, vapiCallId: `runB-1-${randomUUID()}`, initiatedAt: new Date(), isSynthetic: true, testRunId: runB },
        { claimId, vapiCallId: `real-1-${randomUUID()}`, initiatedAt: new Date() },
      ],
    });

    const runAAttempts = await prisma.callAttempt.findMany({
      where: { testRunId: runA, isSynthetic: true },
    });
    expect(runAAttempts).toHaveLength(2);
    expect(runAAttempts.every((a) => a.testRunId === runA)).toBe(true);
  });
});

afterAll(async () => {
  for (const practiceId of practiceIds) {
    await prisma.callAttempt.deleteMany({ where: { claim: { practiceId } } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId } });
    await prisma.practice.delete({ where: { id: practiceId } }).catch(() => undefined);
  }
  await prisma.$disconnect().catch(() => undefined);
});
