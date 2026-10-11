// Step 1 (AC8, T1, T2, T7): the scheduled path and the manual "Call now" route
// make the same eligibility and mode decision and send the same call. Both are
// driven here with the same claim, the Vapi client and the guard are spies, and
// the parameters each path hands over are compared.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';

const h = vi.hoisted(() => ({
  validateDispatch: vi.fn(),
  checkCarrierBlock: vi.fn(),
  initiateCall: vi.fn(),
  endVapiCall: vi.fn(),
  detokenize: vi.fn(),
  completeness: vi.fn(),
  createEscalation: vi.fn(),
  canMakeCall: vi.fn(),
  haOverride: { value: null as boolean | null },
  telusPhone: { value: '+18005550111' as string | null },
  routePrisma: {} as Record<string, unknown>,
  logger: { warn: vi.fn(), error: vi.fn(), audit: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/lib/prisma.js', () => ({ prisma: h.routePrisma }));

vi.mock('../../src/carriers/adapter.js', () => ({
  validateDispatch: (...a: unknown[]) => h.validateDispatch(...a),
  checkCarrierBlock: (...a: unknown[]) => h.checkCarrierBlock(...a),
  isWithinCallWindow: () => true,
  getTelusDialPhone: () => h.telusPhone.value,
  CARRIER_CONFIGS: {
    sun_life: { carrierId: 'sun_life', displayName: 'Sun Life', phone: '+18005550100', ivrHints: ['Press 2'] },
    telus_adjudicare: { carrierId: 'telus_adjudicare', displayName: 'TELUS', phone: '+18005550199', ivrHints: [] },
  },
}));

vi.mock('../../src/vapi/client.js', () => ({
  initiateCall: (...a: unknown[]) => h.initiateCall(...a),
  endVapiCall: (...a: unknown[]) => h.endVapiCall(...a),
  vapiClient: {
    initiateCall: (...a: unknown[]) => h.initiateCall(...a),
    endVapiCall: (...a: unknown[]) => h.endVapiCall(...a),
  },
  getHumanAssistedSquadId: () => 'squad-hold-sentinel',
  VapiAmbiguousOutcomeError: class VapiAmbiguousOutcomeError extends Error {},
}));

vi.mock('../../src/billing/entitlements.js', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../../src/billing/entitlements.js')>();
  return {
    ...original,
    effectiveHumanAssisted: (...a: Parameters<typeof original.effectiveHumanAssisted>) =>
      h.haOverride.value ?? original.effectiveHumanAssisted(...a),
  };
});

vi.mock('../../src/server/plans/practiceEntitlements.js', () => ({
  planTierForPractice: vi.fn(async () => 'core'),
  practiceHasFeature: vi.fn(async () => true),
}));
vi.mock('../../src/server/plans/planBridge.js', () => ({
  canMakeCall: (...a: unknown[]) => h.canMakeCall(...a),
  gateBlockMessage: vi.fn(() => 'blocked'),
}));
vi.mock('../../src/server/services/practiceSettingsService.js', () => ({
  getPracticeSettings: vi.fn(async () => ({
    voiceAgentEnabled: true,
    billingPhone: '416-555-0100',
    escalationPhoneNumber: '416-555-0101',
    carrierConfigs: [{ carrierId: 'sun_life', providerNumber: 'ON-1', languagePreference: 'en' }],
  })),
}));
vi.mock('../../src/pii-vault.js', () => ({ piiVault: { detokenize: (...a: unknown[]) => h.detokenize(...a) } }));
vi.mock('../../src/server/frontDesk/patientDataCompleteness.js', () => ({
  checkPatientDataCompleteness: (...a: unknown[]) => h.completeness(...a),
  raiseMissingPatientDataGate: vi.fn(),
}));
vi.mock('../../src/server/services/escalationService.js', () => ({
  createEscalation: (...a: unknown[]) => h.createEscalation(...a),
}));
// The scheduler's row-locked reservation uses raw SQL, which this fake client
// cannot run; it is covered against Postgres in dispatchConcurrency.integration.test.ts.
vi.mock('../../src/server/frontDesk/dispatchReservation.js', () => ({
  reserveSchedulerSlot: vi.fn(async () => ({ ok: true, priorClaimStatus: 'IN_QUEUE' })),
  releaseSchedulerSlot: vi.fn(async () => undefined),
}));
vi.mock('../../src/server/triage/claimStatusProbe.js', () => ({ probeClaimStatus: vi.fn(async () => null) }));
vi.mock('../../src/server/recovery/transitionClaimRecovery.js', () => ({ transitionClaimRecovery: vi.fn() }));
vi.mock('../../src/server/learning/carrierLessons.js', () => ({ getApprovedNavigationNotes: vi.fn(async () => '') }));
vi.mock('../../src/server/learning/submissionChannelMemory.js', () => ({
  getKnownSubmissionChannel: vi.fn(async (_p: unknown, _c: unknown, type: string) => `known ${type}`),
}));
vi.mock('../../src/server/discovery/carrierDiscoveryService.js', () => ({ getPublishedNavigationSteps: vi.fn(async () => []) }));
vi.mock('../../src/server/db/rlsContext.js', () => ({
  runWithPracticeRls: (_id: string, fn: () => Promise<unknown>) => fn(),
  runWithRlsBypass: (fn: () => Promise<unknown>) => fn(),
  preserveRlsAcrossMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../src/server/frontDesk/deskQueueBroadcast.js', () => ({ refreshDeskQueueBroadcast: vi.fn() }));
vi.mock('../../src/server/frontDesk/deskWs.js', () => ({ broadcastDesk: vi.fn() }));
vi.mock('../../src/server/frontDesk/deskMappers.js', () => ({ mapActiveCall: vi.fn(() => ({})) }));
vi.mock('../../src/server/audit/auditLog.js', () => ({ appendPhiAccessEvent: vi.fn(), appendAuditLog: vi.fn() }));
vi.mock('../../src/server/observability/logger.js', () => ({ default: h.logger, logger: h.logger }));
vi.mock('../../src/services/insurance-denial-analytics.js', () => ({ getDenialAnalytics: vi.fn() }));
vi.mock('../../src/services/guardrails/index.js', () => ({ writeDispatchAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/server/middleware/requireClaimScope.js', () => ({
  requireClaimScope: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../src/server/middleware/ownerPracticeApi.js', () => ({
  useOwnerPracticeApi: () => {},
  useOwnerPracticeApiAuthOnly: () => {},
}));
vi.mock('../../src/server/insurance/manualDispatchCompensation.js', () => ({
  compensateFailedManualDispatch: vi.fn().mockResolvedValue({ terminationError: null }),
}));

import { runDeskQueueTick } from '../../src/server/frontDesk/queueEngine.js';
const { default: insuranceRouter } = await import('../../src/routes/insurance.js');

const CLAIM = {
  id: 'claim-1',
  practiceId: 'practice-1',
  carrierId: 'sun_life',
  claimNumber: 'CN-1',
  billedAmount: 250,
  outstandingAmount: 250,
  expectedAmount: null,
  daysOutstanding: 45,
  servicedAt: null,
  submittedAt: null,
  treatmentCodes: null,
  patientToken: 'tok-1',
  status: 'IN_QUEUE',
  priority: 'NORMAL',
  payerType: null as string | null,
};

const PHI = {
  success: true,
  phi: {
    patientName: 'Test Patient',
    dateOfBirth: '1990-01-01',
    subscriberId: 'SUB-1',
    groupPolicyNumber: 'GRP-1',
    subscriberName: 'Test Patient',
    subscriberDateOfBirth: '1990-01-01',
  },
};

function tickPrisma(claim: typeof CLAIM) {
  return {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ id: 'practice-1' }]),
    practice: {
      findMany: vi.fn(async () => [{ id: 'practice-1' }]),
      findUnique: vi.fn(async () => ({
        name: 'Demo Practice',
        billingPhone: null,
        npi: null,
        taxId: null,
        practiceAddress: '1 Main St',
      })),
    },
    practiceDeskState: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    callQueue: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => [
        { id: 'q-1', practiceId: 'practice-1', claimId: claim.id, attempts: 0, scheduledFor: new Date(Date.now() - 60_000), priority: 'NORMAL', claim },
      ]),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    callAttempt: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(async () => ({ id: 'attempt-1' })),
      update: vi.fn(async () => ({})),
    },
    insuranceClaim: { update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    callEscalation: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    featureFlag: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

/** Reservation transaction fake: raw SQL is routed on the statement text. */
function routeTx(attempts: number) {
  return {
    $executeRawUnsafe: vi.fn(async () => 1),
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      if (sql.includes('FROM call_queue')) {
        return [{ attempts, status: 'PENDING', last_attempt_at: null, dispatch_deferral_code: null, dispatch_deferral_next_action: null, dispatch_deferred_at: null }];
      }
      if (sql.includes('SELECT status FROM insurance_claims')) return [{ status: 'IN_QUEUE' }];
      return [];
    }),
  };
}

function setupRoutePrisma(claim: typeof CLAIM, opts: { attempts?: number; flagPaused?: boolean } = {}) {
  const attempts = opts.attempts ?? 0;
  const p = h.routePrisma as Record<string, unknown>;
  for (const k of Object.keys(p)) delete p[k];
  Object.assign(p, {
    insuranceClaim: {
      findFirst: vi.fn(async () => ({ ...claim, callAttempts: [], queueEntry: { attempts } })),
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({ status: 'IN_QUEUE' })),
    },
    callQueue: {
      findUnique: vi.fn(async () => ({ id: 'q-1' })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    callAttempt: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({ id: 'attempt-1' })) },
    callEscalation: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    practice: {
      findUnique: vi.fn(async () => ({ name: 'Demo Practice', billingPhone: null, npi: null, taxId: null, practiceAddress: '1 Main St' })),
    },
    featureFlag: { findMany: vi.fn(async () => (opts.flagPaused ? [{ paused: true }] : [])) },
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg === 'function') return (arg as (tx: unknown) => Promise<unknown>)(routeTx(attempts));
      return Promise.all(arg as Promise<unknown>[]);
    }),
  });
  return p as unknown as {
    insuranceClaim: { update: ReturnType<typeof vi.fn> };
    callQueue: { update: ReturnType<typeof vi.fn> };
    callAttempt: { upsert: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = { role: 'practice_owner', userId: 'user-1', practiceId: 'practice-1', phiAccess: true };
    next();
  });
  a.use('/api/insurance', insuranceRouter);
  return a;
}

const trigger = () => request(app()).post('/api/insurance/queue/trigger/claim-1');

async function runScheduled(claim: typeof CLAIM) {
  const prisma = tickPrisma(claim);
  await runDeskQueueTick(prisma as unknown as PrismaClient);
  return prisma;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.haOverride.value = null;
  h.telusPhone.value = '+18005550111';
  h.validateDispatch.mockResolvedValue({ allowed: true });
  h.checkCarrierBlock.mockResolvedValue({ allowed: true });
  h.canMakeCall.mockResolvedValue({ allowed: true });
  h.detokenize.mockReturnValue(PHI);
  h.completeness.mockReturnValue({ ok: true, missing: [], warnings: [] });
  h.initiateCall.mockResolvedValue({ vapiCallId: 'vapi-1', status: 'queued' });
  h.createEscalation.mockResolvedValue({});
});

describe('T1 parity: same claim through the scheduled path and the manual route', () => {
  it('hands the guard the same eligibility inputs, including payer program and mode', async () => {
    const claim = { ...CLAIM, payerType: 'PRIVATE' };
    await runScheduled(claim);
    const scheduledGuard = h.validateDispatch.mock.calls[0][1];
    h.validateDispatch.mockClear();
    setupRoutePrisma(claim);
    const res = await trigger();
    expect(res.status).toBe(200);
    const manualGuard = h.validateDispatch.mock.calls[0][1];

    const pick = (g: Record<string, unknown>) => ({
      practiceId: g.practiceId, claimId: g.claimId, carrierId: g.carrierId, daysOutstanding: g.daysOutstanding,
      attemptsSoFar: g.attemptsSoFar, claimStatus: g.claimStatus, payerType: g.payerType, humanAssisted: g.humanAssisted,
      hasConcurrencySnapshot: g.carrierActiveCounts instanceof Map,
    });
    expect(pick(manualGuard)).toEqual(pick(scheduledGuard));
    expect(pick(manualGuard)).toMatchObject({ payerType: 'PRIVATE', humanAssisted: true, hasConcurrencySnapshot: true });
  });

  it('sends the same call variables, squad and idempotency key from both paths', async () => {
    await runScheduled({ ...CLAIM });
    const scheduledParams = h.initiateCall.mock.calls[0][0];
    h.initiateCall.mockClear();
    setupRoutePrisma({ ...CLAIM });
    expect((await trigger()).status).toBe(200);
    const manualParams = h.initiateCall.mock.calls[0][0];

    expect(manualParams).toEqual(scheduledParams);
    expect(manualParams).toMatchObject({
      squadId: 'squad-hold-sentinel',
      idempotencyKey: 'claim-1:1',
      practiceAddress: '1 Main St',
      knownResubmissionChannel: 'known CLAIM_RESUBMISSION',
      carrierIvrInstructions: 'Press 2',
    });
  });

  it('flags an unclassified claim on both paths, and in the manual response', async () => {
    h.validateDispatch.mockResolvedValue({ allowed: true, payerTypeAssumed: true });
    await runScheduled({ ...CLAIM, payerType: null });
    expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining('no payerType'), expect.objectContaining({ claimId: 'claim-1' }));
    h.logger.warn.mockClear();
    setupRoutePrisma({ ...CLAIM, payerType: null });
    const res = await trigger();
    expect(res.body).toMatchObject({ success: true, payerTypeAssumed: true });
    expect(h.logger.warn).toHaveBeenCalledWith(expect.stringContaining('no payerType'), expect.objectContaining({ claimId: 'claim-1' }));
  });
});

describe('T2 mode and squad', () => {
  it('records the attempt as human-assisted on both paths', async () => {
    const scheduled = await runScheduled({ ...CLAIM });
    expect(scheduled.callAttempt.upsert.mock.calls[0][0].create.isHumanAssisted).toBe(true);
    const route = setupRoutePrisma({ ...CLAIM });
    await trigger();
    expect(route.callAttempt.upsert.mock.calls[0][0].create.isHumanAssisted).toBe(true);
    expect(route.callAttempt.upsert.mock.calls[0][0].update.isHumanAssisted).toBe(true);
  });

  it('leaves squadId unset and the attempt not human-assisted on both paths for an autonomous practice', async () => {
    h.haOverride.value = false;
    const scheduled = await runScheduled({ ...CLAIM });
    expect(h.initiateCall.mock.calls[0][0].squadId).toBeUndefined();
    expect(scheduled.callAttempt.upsert.mock.calls[0][0].create.isHumanAssisted).toBe(false);
    h.initiateCall.mockClear();
    const route = setupRoutePrisma({ ...CLAIM });
    const res = await trigger();
    expect(h.initiateCall.mock.calls[0][0].squadId).toBeUndefined();
    expect(route.callAttempt.upsert.mock.calls[0][0].create.isHumanAssisted).toBe(false);
    expect(res.body.executionMode).toBe('autonomous');
  });
});

describe('rollout flag: the manual route only', () => {
  it('pauses manual calling without reserving a slot or dialing, and leaves the scheduler alone', async () => {
    const route = setupRoutePrisma({ ...CLAIM }, { flagPaused: true });
    const res = await trigger();
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MANUAL_DISPATCH_PAUSED');
    expect(h.initiateCall).not.toHaveBeenCalled();
    expect(route.$transaction).not.toHaveBeenCalled();
    expect(route.insuranceClaim.update).not.toHaveBeenCalled();

    await runScheduled({ ...CLAIM });
    expect(h.initiateCall).toHaveBeenCalledTimes(1);
  });

  it('applies the payer-program rule before the flag, so a paused flag cannot expose or hide it', async () => {
    h.validateDispatch.mockResolvedValue({ allowed: false, code: 'PAYER_PROGRAM_NOT_ENABLED', reason: 'CDCP not enabled' });
    setupRoutePrisma({ ...CLAIM, payerType: 'CDCP' }, { flagPaused: true });
    const res = await trigger();
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PAYER_PROGRAM_NOT_ENABLED');
    expect(h.initiateCall).not.toHaveBeenCalled();
    expect(h.validateDispatch.mock.calls[0][1].payerType).toBe('CDCP');
  });

  it('refuses a disabled payer program on the scheduled path too, with no dial', async () => {
    h.validateDispatch.mockResolvedValue({ allowed: false, code: 'PAYER_PROGRAM_NOT_ENABLED', reason: 'CDCP not enabled' });
    const prisma = await runScheduled({ ...CLAIM, payerType: 'CDCP' });
    expect(h.initiateCall).not.toHaveBeenCalled();
    expect(prisma.callQueue.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ dispatchDeferralCode: 'PAYER_PROGRAM_NOT_ENABLED' }),
    }));
  });
});

describe('T7 the attempt cap leaves a staff action on both paths', () => {
  it('escalates identically: claim ESCALATED, queue ESCALATED, one open escalation', async () => {
    h.validateDispatch.mockResolvedValue({ allowed: false, code: 'MAX_ATTEMPTS', reason: 'Maximum 3 call attempts reached' });
    const scheduled = await runScheduled({ ...CLAIM });
    expect(scheduled.insuranceClaim.update).toHaveBeenCalledWith({ where: { id: 'claim-1' }, data: { status: 'ESCALATED' } });
    expect(h.createEscalation).toHaveBeenCalledTimes(1);
    const scheduledEscalation = h.createEscalation.mock.calls[0][1];

    h.createEscalation.mockClear();
    const route = setupRoutePrisma({ ...CLAIM }, { attempts: 3 });
    const res = await trigger();
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MAX_ATTEMPTS');
    expect(route.insuranceClaim.update).toHaveBeenCalledWith({ where: { id: 'claim-1' }, data: { status: 'ESCALATED' } });
    expect(route.callQueue.update).toHaveBeenCalledWith({ where: { id: 'q-1' }, data: { status: 'ESCALATED' } });
    expect(h.createEscalation).toHaveBeenCalledTimes(1);
    expect(h.createEscalation.mock.calls[0][1]).toEqual(scheduledEscalation);
    expect(scheduledEscalation).toMatchObject({ reason: 'Maximum automated call attempts reached', attemptNumber: 3 });
    expect(h.initiateCall).not.toHaveBeenCalled();
  });

  it('does not escalate an over-90 claim that was refused for an unrelated reason', async () => {
    h.validateDispatch.mockResolvedValue({ allowed: false, code: 'OUTSIDE_CALL_WINDOW', reason: 'outside window' });
    const route = setupRoutePrisma({ ...CLAIM, daysOutstanding: 120 });
    const res = await trigger();
    expect(res.status).toBe(422);
    expect(route.insuranceClaim.update).not.toHaveBeenCalled();
    expect(h.createEscalation).not.toHaveBeenCalled();
  });
});

describe('manual route refusals after the slot is reserved give the slot back', () => {
  it('refuses incomplete patient data and restores the claim and attempt count', async () => {
    h.completeness.mockReturnValue({ ok: false, missing: ['subscriberId'], warnings: [] });
    const route = setupRoutePrisma({ ...CLAIM });
    const res = await trigger();
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MISSING_REQUIRED_CLAIM_DATA');
    expect(h.initiateCall).not.toHaveBeenCalled();
    expect(route.insuranceClaim.update).toHaveBeenCalledWith({ where: { id: 'claim-1' }, data: { status: 'IN_QUEUE' } });
    expect(route.callQueue.update).toHaveBeenCalledWith({ where: { claimId: 'claim-1' }, data: { status: 'PENDING', attempts: { decrement: 1 } } });
  });

  it('refuses TELUS with no verified TPA number instead of dialing the placeholder', async () => {
    h.telusPhone.value = null;
    const route = setupRoutePrisma({ ...CLAIM, carrierId: 'telus_adjudicare' });
    const res = await trigger();
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('TELUS_TPA_PHONE_UNVERIFIED');
    expect(h.initiateCall).not.toHaveBeenCalled();
    expect(route.insuranceClaim.update).toHaveBeenCalledWith({ where: { id: 'claim-1' }, data: { status: 'IN_QUEUE' } });
  });

  it('dials the verified TPA number for TELUS on both paths', async () => {
    await runScheduled({ ...CLAIM, carrierId: 'telus_adjudicare' });
    expect(h.initiateCall.mock.calls[0][0].carrierPhone).toBe('+18005550111');
    h.initiateCall.mockClear();
    setupRoutePrisma({ ...CLAIM, carrierId: 'telus_adjudicare' });
    await trigger();
    expect(h.initiateCall.mock.calls[0][0].carrierPhone).toBe('+18005550111');
  });
});
