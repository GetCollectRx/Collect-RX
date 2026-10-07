import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import type { BillingTier } from '@prisma/client';

const { claimFindFirst, planTier } = vi.hoisted(() => ({
  claimFindFirst: vi.fn(),
  planTier: { value: 'sentinel' as BillingTier },
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    insuranceClaim: { findFirst: claimFindFirst },
    claimEvidenceItem: { findMany: vi.fn().mockResolvedValue([]) },
    claimSubmission: { findMany: vi.fn().mockResolvedValue([]) },
    evidencePackExport: { findMany: vi.fn().mockResolvedValue([]) },
    underpaymentCase: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('../src/server/plans/practiceEntitlements.js', async () => {
  const { tierAllows } = await import('../src/billing/entitlements.js');
  return {
    practiceHasFeature: vi.fn(async (_prisma: unknown, _practiceId: string, feature: never) =>
      tierAllows(planTier.value, feature),
    ),
  };
});

vi.mock('../src/server/featureFlags/csvArFeatures.js', () => ({
  CSV_AR_FEATURES: { DENIAL_HUB: 'denial_hub' },
  isCsvArFeatureEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/vapi/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/vapi/client.js')>()),
  vapiClient: { initiateCall: vi.fn(), endVapiCall: vi.fn() },
}));

vi.mock('../src/server/middleware/requireClaimScope.js', () => ({
  requireClaimScope: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../src/server/middleware/ownerPracticeApi.js', () => ({
  useOwnerPracticeApi: () => {},
  useOwnerPracticeApiAuthOnly: () => {},
}));

const { default: insuranceRouter } = await import('../src/routes/insurance.js');

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

describe('plan locks on denial and underpayment tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planTier.value = 'sentinel';
  });

  it('locks denial evidence on a private claim for the Hold Sentinel plan', async () => {
    claimFindFirst.mockResolvedValue({ id: 'claim-1', payerType: 'PRIVATE' });
    const res = await request(app()).get('/api/insurance/claims/claim-1/evidence');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Recovery plan/);
  });

  it('keeps denial evidence open on a CDCP claim for the Hold Sentinel plan', async () => {
    claimFindFirst.mockResolvedValue({ id: 'claim-1', payerType: 'CDCP' });
    const res = await request(app()).get('/api/insurance/claims/claim-1/evidence');
    expect(res.status).toBe(200);
  });

  it('opens denial evidence on a private claim for the Recovery plan', async () => {
    planTier.value = 'core';
    claimFindFirst.mockResolvedValue({ id: 'claim-1', payerType: 'PRIVATE' });
    const res = await request(app()).get('/api/insurance/claims/claim-1/evidence');
    expect(res.status).toBe(200);
  });

  it('locks underpayment recovery on the Hold Sentinel plan and opens it on Recovery', async () => {
    expect((await request(app()).get('/api/insurance/underpayments')).status).toBe(403);
    planTier.value = 'core';
    expect((await request(app()).get('/api/insurance/underpayments')).status).toBe(200);
  });

  it('locks recording a resubmission on a private claim for the Hold Sentinel plan', async () => {
    claimFindFirst.mockResolvedValue({ id: 'claim-1', payerType: 'PRIVATE' });
    const res = await request(app())
      .post('/api/insurance/claims/claim-1/submissions')
      .send({ method: 'portal' });
    expect(res.status).toBe(403);
  });
});
