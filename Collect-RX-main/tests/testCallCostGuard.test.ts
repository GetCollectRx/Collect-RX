// Exercises assertUnderTestCallCostCeiling against real CallAttempt rows in
// local Postgres (controlled minutesBilled values -> known cost), rather
// than mocking Prisma, since a real DB is available in CI/this environment.
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma.js';
import { CARRIER_TIMEOUTS, CALL_TIMEOUTS, UNIT_ECONOMICS } from '../src/billing/tiers.js';
import {
  assertUnderTestCallCostCeiling,
  SYNTHETIC_CALL_COST_PER_MINUTE_USD,
  TEST_CALL_COST_CEILING_USD,
  TestCallCostCeilingExceededError,
} from '../src/server/services/testCallCostGuard.js';

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

async function makePracticeAndClaim(): Promise<string> {
  const practice = await prisma.practice.create({
    data: {
      name: `Cost Guard Fixture ${suffix}-${practiceIds.length}`,
      passwordHash: 'cost-guard-test-password-hash',
    },
  });
  practiceIds.push(practice.id);

  const claim = await prisma.insuranceClaim.create({
    data: {
      practiceId: practice.id,
      carrierId: 'green_shield',
      claimNumber: `COSTGUARD-${suffix}-${practiceIds.length}`,
      patientToken: randomUUID(),
      billedAmount: 100,
      outstandingAmount: 100,
      daysOutstanding: 45,
    },
  });
  return claim.id;
}

async function recordSyntheticAttempt(claimId: string, testRunId: string, minutesBilled: number): Promise<void> {
  await prisma.callAttempt.create({
    data: {
      claimId,
      vapiCallId: `cost-guard-${randomUUID()}`,
      initiatedAt: new Date(),
      completedAt: new Date(),
      minutesBilled,
      isSynthetic: true,
      testRunId,
      repPersona: 'green_shield_carrier_rep',
    },
  });
}

describe.skipIf(!dbReady)('assertUnderTestCallCostCeiling', () => {
  it('reuses the existing billing UNIT_ECONOMICS.costPerMinute rate rather than a new placeholder', () => {
    expect(SYNTHETIC_CALL_COST_PER_MINUTE_USD).toBe(UNIT_ECONOMICS.costPerMinute);
  });

  it('allows a run well under the $30 ceiling', async () => {
    const claimId = await makePracticeAndClaim();
    const testRunId = randomUUID();
    // 10 minutes billed so far * $0.115/min = $1.15 existing cost.
    await recordSyntheticAttempt(claimId, testRunId, 10);

    const summary = await assertUnderTestCallCostCeiling(prisma, { testRunId, carrierId: 'green_shield' });

    expect(summary.existingCostUsd).toBeCloseTo(10 * UNIT_ECONOMICS.costPerMinute, 6);
    expect(summary.projectedTotalCostUsd).toBeLessThan(TEST_CALL_COST_CEILING_USD);
  });

  it('blocks (throws) when cumulative recorded cost already exceeds the $30 ceiling', async () => {
    const claimId = await makePracticeAndClaim();
    const testRunId = randomUUID();
    // 300 minutes billed * $0.115/min = $34.50 — already over the $30 ceiling
    // on its own, before any projected next-call cost is added.
    await recordSyntheticAttempt(claimId, testRunId, 300);

    await expect(
      assertUnderTestCallCostCeiling(prisma, { testRunId, carrierId: 'green_shield' }),
    ).rejects.toBeInstanceOf(TestCallCostCeilingExceededError);
  });

  it('blocks when existing cost is under the ceiling but the next call would push it over', async () => {
    const claimId = await makePracticeAndClaim();
    const testRunId = randomUUID();
    // Existing cost right at the edge: enough headroom for real dispatch,
    // but not enough for another full-length Green Shield call.
    const greenShieldMaxMinutes = Math.min(CARRIER_TIMEOUTS['green-shield'], CALL_TIMEOUTS.absoluteMaxMinutes);
    const worstCaseNextCallCost = greenShieldMaxMinutes * UNIT_ECONOMICS.costPerMinute;
    const existingMinutes = Math.ceil((TEST_CALL_COST_CEILING_USD - worstCaseNextCallCost / 2) / UNIT_ECONOMICS.costPerMinute);
    await recordSyntheticAttempt(claimId, testRunId, existingMinutes);

    await expect(
      assertUnderTestCallCostCeiling(prisma, { testRunId, carrierId: 'green_shield' }),
    ).rejects.toBeInstanceOf(TestCallCostCeilingExceededError);
  });

  it('scopes the sum to isSynthetic rows for the given testRunId only — ignores other runs and real calls', async () => {
    const claimId = await makePracticeAndClaim();
    const testRunId = randomUUID();
    const otherRunId = randomUUID();

    // A hugely expensive OTHER run must not bleed into this run's total.
    await recordSyntheticAttempt(claimId, otherRunId, 1_000);
    // A real (non-synthetic) call attempt on the same claim must not count either.
    await prisma.callAttempt.create({
      data: {
        claimId,
        vapiCallId: `real-cost-guard-${randomUUID()}`,
        initiatedAt: new Date(),
        completedAt: new Date(),
        minutesBilled: 1_000,
      },
    });
    await recordSyntheticAttempt(claimId, testRunId, 5);

    const summary = await assertUnderTestCallCostCeiling(prisma, { testRunId, carrierId: 'green_shield' });
    expect(summary.existingCostUsd).toBeCloseTo(5 * UNIT_ECONOMICS.costPerMinute, 6);
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
