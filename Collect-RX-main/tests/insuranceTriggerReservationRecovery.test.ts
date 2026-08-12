// Regression test for the trigger-endpoint reservation-transaction defect:
// if prisma.$transaction() throws after (or during) flipping the claim to
// CALLING — e.g. an interactive-transaction timeout under contention — the
// claim must self-heal back to its prior status instead of sticking in
// CALLING with no automatic recovery. See src/routes/insurance.ts,
// POST /queue/trigger/:claimId.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';

const { claimFindFirst, insuranceClaimUpdate, insuranceClaimFindUnique, callQueueUpdateMany, transactionMock } =
  vi.hoisted(() => ({
    claimFindFirst: vi.fn(),
    insuranceClaimUpdate: vi.fn().mockResolvedValue({}),
    insuranceClaimFindUnique: vi.fn(),
    callQueueUpdateMany: vi.fn().mockResolvedValue({ count: 1 }),
    transactionMock: vi.fn(),
  }));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    insuranceClaim: {
      findFirst: claimFindFirst,
      update: insuranceClaimUpdate,
      findUnique: insuranceClaimFindUnique,
    },
    callQueue: {
      updateMany: callQueueUpdateMany,
    },
    $transaction: transactionMock,
  },
}));

vi.mock('../src/vapi/client.js', () => ({
  vapiClient: { initiateCall: vi.fn(), endVapiCall: vi.fn() },
  VapiAmbiguousOutcomeError: class VapiAmbiguousOutcomeError extends Error {},
}));

vi.mock('../src/carriers/adapter.js', () => ({
  validateDispatch: vi.fn().mockResolvedValue({ allowed: true }),
  CARRIER_CONFIGS: {
    sun_life: { carrierId: 'sun_life', displayName: 'Sun Life', phone: '+18005550100', ivrHints: [] },
  },
}));

vi.mock('../src/services/insurance-denial-analytics.js', () => ({
  getDenialAnalytics: vi.fn(),
}));

vi.mock('../src/services/guardrails/index.js', () => ({
  writeDispatchAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/server/middleware/requireClaimScope.js', () => ({
  requireClaimScope: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// The real useOwnerPracticeApi registers `authenticate`, which reads a signed
// cookie and would overwrite the req.auth set by our test harness below.
vi.mock('../src/server/middleware/ownerPracticeApi.js', () => ({
  useOwnerPracticeApi: () => {},
  useOwnerPracticeApiAuthOnly: () => {},
}));

vi.mock('../src/server/plans/planBridge.js', () => ({
  canMakeCall: vi.fn().mockResolvedValue({ allowed: true }),
  gateBlockMessage: vi.fn(() => 'blocked'),
}));

vi.mock('../src/server/services/practiceSettingsService.js', () => ({
  getPracticeSettings: vi.fn().mockResolvedValue({ carrierConfigs: [], billingPhone: null, escalationPhoneNumber: null }),
}));

vi.mock('../src/pii-vault.js', () => ({
  piiVault: { detokenize: vi.fn() },
}));

const loggerMock = { warn: vi.fn(), error: vi.fn(), audit: vi.fn() };
vi.mock('../src/server/observability/logger.js', () => ({
  default: loggerMock,
  logger: loggerMock,
}));

vi.mock('../src/server/audit/auditLog.js', () => ({
  appendAuditLog: vi.fn(),
  appendPhiAccessEvent: vi.fn(),
}));

vi.mock('../src/server/insurance/manualDispatchCompensation.js', () => ({
  compensateFailedManualDispatch: vi.fn().mockResolvedValue({ terminationError: null }),
}));

const { default: insuranceRouter } = await import('../src/routes/insurance.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.auth = {
      role: 'practice_owner',
      userId: 'user-1',
      practiceId: 'practice-1',
      phiAccess: true,
    };
    next();
  });
  app.use('/api/insurance', insuranceRouter);
  return app;
}

function claimFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'claim-1',
    practiceId: 'practice-1',
    carrierId: 'sun_life',
    status: 'IN_QUEUE',
    daysOutstanding: 45,
    patientToken: 'tok-1',
    priority: 1,
    callAttempts: [],
    queueEntry: { attempts: 0 },
    ...overrides,
  };
}

describe('POST /api/insurance/queue/trigger/:claimId — reservation transaction failure recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insuranceClaimUpdate.mockResolvedValue({});
    callQueueUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('restores claim to its prior status when the reservation transaction throws after committing CALLING', async () => {
    claimFindFirst.mockResolvedValue(claimFixture());
    // The reservation $transaction throws (e.g. interactive-transaction timeout),
    // but the underlying commit already landed — DB now shows CALLING.
    transactionMock.mockImplementationOnce(async () => {
      throw new Error('Transaction API error: Transaction already closed');
    });
    insuranceClaimFindUnique.mockResolvedValue({ status: 'CALLING' });
    // Compensation runs via a second $transaction([...]) call (array form).
    transactionMock.mockImplementationOnce(async (ops: Promise<unknown>[]) => Promise.all(ops));

    const res = await request(buildApp()).post('/api/insurance/queue/trigger/claim-1');

    expect(res.status).toBe(500);
    expect(insuranceClaimUpdate).toHaveBeenCalledWith({
      where: { id: 'claim-1' },
      data: { status: 'IN_QUEUE' },
    });
    expect(callQueueUpdateMany).toHaveBeenCalledWith({
      where: { claimId: 'claim-1', status: 'IN_PROGRESS' },
      data: { status: 'PENDING' },
    });
  });

  it('does not touch claim/queue state when the transaction throws before anything committed', async () => {
    claimFindFirst.mockResolvedValue(claimFixture());
    transactionMock.mockImplementationOnce(async () => {
      throw new Error('connection reset');
    });
    // DB state was never changed — claim is still IN_QUEUE, not CALLING.
    insuranceClaimFindUnique.mockResolvedValue({ status: 'IN_QUEUE' });

    const res = await request(buildApp()).post('/api/insurance/queue/trigger/claim-1');

    expect(res.status).toBe(500);
    expect(insuranceClaimUpdate).not.toHaveBeenCalled();
    expect(callQueueUpdateMany).not.toHaveBeenCalled();
  });
});
