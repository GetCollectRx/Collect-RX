/**
 * Billing × safety matrix: the plan gate (callsPaused / minute limits) and
 * CARRIER_BLOCK are independent interlocks — each blocks dials on its own,
 * and clearing one never clears the other.
 *
 * DB-dependent — skipped with a warning if DATABASE_URL is unreachable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/server/index.js';
import { createPracticeForTests } from './factories/practice.js';
import { checkCarrierBlock } from '../src/carriers/adapter.js';
import { evaluateCallGate } from '../src/server/plans/usagePeriodService.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[billingSafetyMatrix] DATABASE_URL unreachable — skipping:', (e as Error).message);
}

describe.skipIf(!dbReady)('plan pause × CARRIER_BLOCK matrix', () => {
  let practiceId: string;

  beforeAll(async () => {
    const practice = await createPracticeForTests(prisma);
    practiceId = practice.id;
    await prisma.practice.update({
      where: { id: practiceId },
      data: {
        billingTier: 'trial',
        trialEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      },
    });
  });

  afterAll(async () => {
    await prisma.carrierBlockEvent.deleteMany({ where: { practiceId } });
    await prisma.usagePeriod.deleteMany({ where: { practiceId } });
    await prisma.practice.delete({ where: { id: practiceId } });
  });

  async function setPlanPaused(paused: boolean) {
    await prisma.practice.update({
      where: { id: practiceId },
      data: paused
        ? { callsPaused: true, callsPausedReason: 'overage_pending', callsPausedAt: new Date() }
        : { callsPaused: false, callsPausedReason: null, callsPausedAt: null },
    });
  }

  // Rows are written directly (not via applyCarrierBlock) so the test never
  // touches the live Vapi API when ending in-flight calls.
  async function setCarrierBlocked(blocked: boolean) {
    if (blocked) {
      await prisma.carrierBlockEvent.create({
        data: { practiceId, carrierId: 'sun_life', notes: 'automation detected (test)', blockedAt: new Date() },
      });
    } else {
      await prisma.carrierBlockEvent.updateMany({
        where: { practiceId, carrierId: 'sun_life', resumedAt: null },
        data: { resumedAt: new Date() },
      });
    }
  }

  it('neither blocked: both gates allow', async () => {
    await setPlanPaused(false);
    await setCarrierBlocked(false);
    expect((await evaluateCallGate(prisma, practiceId)).allowed).toBe(true);
    expect((await checkCarrierBlock(prisma, practiceId, 'sun_life')).allowed).toBe(true);
  });

  it('plan paused only: plan gate blocks while the carrier gate still allows', async () => {
    await setPlanPaused(true);
    const plan = await evaluateCallGate(prisma, practiceId);
    expect(plan.allowed).toBe(false);
    expect((await checkCarrierBlock(prisma, practiceId, 'sun_life')).allowed).toBe(true);
  });

  it('carrier blocked only: carrier gate blocks while the plan gate still allows', async () => {
    await setPlanPaused(false);
    await setCarrierBlocked(true);
    const carrier = await checkCarrierBlock(prisma, practiceId, 'sun_life');
    expect(carrier.allowed).toBe(false);
    expect(carrier.code).toBe('CARRIER_BLOCK');
    expect((await evaluateCallGate(prisma, practiceId)).allowed).toBe(true);
  });

  it('both blocked: each gate reports its own block', async () => {
    await setPlanPaused(true);
    const plan = await evaluateCallGate(prisma, practiceId);
    const carrier = await checkCarrierBlock(prisma, practiceId, 'sun_life');
    expect(plan.allowed).toBe(false);
    expect(carrier.allowed).toBe(false);
  });

  it('clearing the carrier block does not clear the plan pause', async () => {
    await setCarrierBlocked(false);
    expect((await checkCarrierBlock(prisma, practiceId, 'sun_life')).allowed).toBe(true);
    expect((await evaluateCallGate(prisma, practiceId)).allowed).toBe(false);
  });
});
