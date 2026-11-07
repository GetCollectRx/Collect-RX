/**
 * The real desk queue tick with HYBRID_CALL_FLOW off and on: dispatch is
 * identical either way, and the flag only adds phase tracking and the chosen
 * ending to the call attempt. initiateCall is mocked, so no carrier is dialed.
 * Synthetic data only.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BillingTier, CarrierId } from '@prisma/client';

const CARRIER: CarrierId = 'sun_life';

const initiateCallMock = vi.fn(async (_params: unknown) => ({
  vapiCallId: `vapi-hybrid-${Math.random().toString(36).slice(2, 12)}`,
  status: 'queued' as const,
  createdAt: new Date().toISOString(),
}));

vi.mock('../src/vapi/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/vapi/client.js')>();
  return {
    ...actual,
    initiateCall: (params: unknown) => initiateCallMock(params),
    endVapiCall: vi.fn(async () => undefined),
  };
});

vi.mock('../src/carriers/adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/carriers/adapter.js')>();
  return { ...actual, isWithinCallWindow: () => true };
});

const scenario: { tier: BillingTier | null; graduated: boolean } = { tier: 'core', graduated: false };

vi.mock('../src/server/plans/practiceEntitlements.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/plans/practiceEntitlements.js')>();
  return { ...actual, planTierForPractice: async () => scenario.tier };
});

vi.mock('../src/server/learning/autonomyGraduation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/learning/autonomyGraduation.js')>();
  return { ...actual, isCarrierGraduated: async () => scenario.graduated };
});

const { prisma } = await import('../src/server/index.js');
const { runDeskQueueTick } = await import('../src/server/frontDesk/queueEngine.js');
const { createPracticeForTests } = await import('./factories/practice.js');
const { defaultPracticeSettings, updatePracticeSettings } = await import(
  '../src/server/services/practiceSettingsService.js'
);
const { piiVault } = await import('../src/pii-vault.js');
const { parsePhaseHistory } = await import('../src/server/frontDesk/callPhase.js');

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[hybridCallFlowTick] DATABASE_URL unreachable, skipping:', (e as Error).message);
}

describe.skipIf(!dbReady)('desk queue tick with the hybrid call flow flag', () => {
  let practiceId: string;

  async function dispatchOne(humanAssistedMode: boolean) {
    const settings = defaultPracticeSettings();
    settings.voiceAgentEnabled = true;
    settings.humanAssistedMode = humanAssistedMode;
    settings.carrierConfigs = settings.carrierConfigs.map((c) =>
      c.carrierId === CARRIER
        ? { ...c, authorizationSubmitted: true, providerNumber: `PN-HYB-${practiceId.slice(0, 8)}` }
        : c,
    );
    await updatePracticeSettings(prisma, practiceId, settings);

    const patientToken = piiVault.tokenize(
      {
        patientName: 'Synthetic Patient',
        dateOfBirth: '1985-06-15',
        subscriberId: `SUB-${practiceId.slice(0, 8)}`,
        groupPolicyNumber: `GRP-${practiceId.slice(0, 8)}`,
      },
      'hybrid_call_flow_tick_test',
      practiceId,
    );
    const claim = await prisma.insuranceClaim.create({
      data: {
        practiceId,
        carrierId: CARRIER,
        claimNumber: `CLM-HYB-${Math.random().toString(36).slice(2, 10)}`,
        patientToken,
        billedAmount: 250,
        outstandingAmount: 250,
        daysOutstanding: 45,
        status: 'PENDING',
      },
    });
    await prisma.callQueue.create({
      data: { practiceId, claimId: claim.id, scheduledFor: new Date(Date.now() - 1000), status: 'PENDING' },
    });
    // Earlier scenarios leave an open attempt; the desk allows one live call per practice.
    await prisma.callAttempt.updateMany({
      where: { claim: { practiceId }, completedAt: null },
      data: { completedAt: new Date() },
    });
    await prisma.callQueue.updateMany({
      where: { practiceId, status: 'IN_PROGRESS' },
      data: { status: 'COMPLETED' },
    });
    initiateCallMock.mockClear();
    // The tick holds a global lease; clear it so back-to-back ticks in one file all run.
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    await runDeskQueueTick(prisma);
    const dialed = initiateCallMock.mock.calls.filter(
      (c) => (c[0] as { claimId?: string }).claimId === claim.id,
    );
    const attempt = await prisma.callAttempt.findFirst({ where: { claimId: claim.id } });
    return { dialed, attempt, claimId: claim.id };
  }

  beforeAll(async () => {
    // The call-window guard reads the clock inside its own module, which a module
    // mock cannot reach, so pin the clock to a Tuesday 10:00 Eastern.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T14:00:00Z') });
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    // The slot budget counts open attempts globally, so leave room for noise from other files.
    vi.stubEnv('VAPI_MAX_CONCURRENT_CALLS', '500');
    vi.stubEnv('VAPI_CONCURRENCY_RESERVE', '0');
    practiceId = (await createPracticeForTests(prisma)).id;
  }, 30_000);

  afterEach(() => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'false');
    vi.stubEnv('AUTONOMOUS_PLAN_TIERS', '');
  });

  afterAll(async () => {
    await prisma.callAttempt.deleteMany({ where: { claim: { practiceId } } });
    await prisma.callQueue.deleteMany({ where: { practiceId } });
    await prisma.insuranceClaim.deleteMany({ where: { practiceId } });
    await prisma.practiceDeskState.deleteMany({ where: { practiceId } });
    await prisma.practice.delete({ where: { id: practiceId } }).catch(() => undefined);
    await prisma.queueEngineLease.deleteMany({ where: { id: 'global' } });
    vi.unstubAllEnvs();
    vi.useRealTimers();
    await prisma.$disconnect().catch(() => undefined);
  });

  it('flag off: dials as before and records no phase data', async () => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'false');
    scenario.tier = 'core';
    scenario.graduated = false;
    const { dialed, attempt } = await dispatchOne(true);
    expect(dialed).toHaveLength(1);
    expect(attempt).not.toBeNull();
    expect(attempt?.callPhase).toBeNull();
    expect(attempt?.phaseHistory).toBeNull();
    expect(attempt?.callEnding).toBeNull();
    expect(attempt?.callEndingReason).toBeNull();
  }, 30_000);

  it('flag on, hold sentinel only: staff ending, same squad as flag off', async () => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'false');
    const off = await dispatchOne(true);
    const squadOff = (off.dialed[0]?.[0] as { squadId?: string }).squadId;

    vi.stubEnv('HYBRID_CALL_FLOW', 'true');
    const on = await dispatchOne(true);
    const squadOn = (on.dialed[0]?.[0] as { squadId?: string }).squadId;

    expect(on.dialed).toHaveLength(1);
    expect(squadOn).toBe(squadOff);
    expect(on.attempt?.callPhase).toBe('dialing');
    expect(on.attempt?.callEnding).toBe('staff');
    expect(on.attempt?.callEndingReason).toBe('plan_excludes_autonomous');
    const history = parsePhaseHistory(on.attempt?.phaseHistory);
    expect(history?.map((h) => h.phase)).toEqual(['dialing']);
    expect(history?.[0]?.at).toBe(on.attempt?.initiatedAt.toISOString());
  }, 30_000);

  it('flag on, autonomous plan, graduated carrier, practice allows it: agent ending', async () => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'true');
    vi.stubEnv('AUTONOMOUS_PLAN_TIERS', 'core');
    scenario.tier = 'core';
    scenario.graduated = true;
    const { dialed, attempt } = await dispatchOne(false);
    expect(dialed).toHaveLength(1);
    expect((dialed[0]?.[0] as { squadId?: string }).squadId).toBeUndefined();
    expect(attempt?.callEnding).toBe('agent');
    expect(attempt?.callEndingReason).toBe('autonomous_allowed');
  }, 30_000);

  it('flag on, autonomous plan but carrier not graduated: staff ending and the human squad', async () => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'true');
    vi.stubEnv('AUTONOMOUS_PLAN_TIERS', 'core');
    scenario.tier = 'core';
    scenario.graduated = false;
    const { dialed, attempt } = await dispatchOne(false);
    expect(dialed).toHaveLength(1);
    expect((dialed[0]?.[0] as { squadId?: string }).squadId).toBeDefined();
    expect(attempt?.callEnding).toBe('staff');
    expect(attempt?.callEndingReason).toBe('carrier_not_graduated');
  }, 30_000);

  it('flag on, plan without autonomous: staff even when the carrier graduated and the practice allows it', async () => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'true');
    scenario.tier = 'core';
    scenario.graduated = true;
    const { attempt } = await dispatchOne(false);
    expect(attempt?.callEnding).toBe('staff');
    expect(attempt?.callEndingReason).toBe('plan_excludes_autonomous');
  }, 30_000);
});
