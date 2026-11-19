import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  sweepCdcpPortalVerification,
  sweepAccertaCobRouting,
  sweepAccertaCobEscalation,
} from './ontarioArAgingSweep.js';

vi.mock('../services/escalationService.js', () => ({
  createEscalation: vi.fn().mockResolvedValue({}),
}));
vi.mock('../services/practiceNotificationService.js', () => ({
  sendPracticeNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../emrSyncOutbox.js', () => ({
  enqueueEmrClaimEvent: vi.fn().mockResolvedValue(undefined),
}));

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    insuranceClaim: { findMany: vi.fn().mockResolvedValue([]) },
    claimRecoveryAction: { create: vi.fn().mockResolvedValue({}) },
    cdcpCoverage: { findUnique: vi.fn().mockResolvedValue(null) },
    cobRoute: { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    claimSubmission: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  } as unknown as PrismaClient;
}

const asOf = new Date('2026-09-05T00:00:00Z');

describe('sweepCdcpPortalVerification', () => {
  it('opens a PAYMENT_VERIFY_SYNC action for each candidate claim', async () => {
    const prisma = mockPrisma({
      insuranceClaim: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'claim-1', practiceId: 'practice-1', claimNumber: 'CLM-001' },
        ]),
      },
    });

    const opened = await sweepCdcpPortalVerification(prisma, asOf);

    expect(opened).toBe(1);
    expect(prisma.claimRecoveryAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          claimId: 'claim-1',
          actionType: 'PAYMENT_VERIFY_SYNC',
          status: 'OPEN',
        }),
      }),
    );
  });

  it('queries only PENDING CDCP claims with no existing open verify action', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = mockPrisma({ insuranceClaim: { findMany } });

    await sweepCdcpPortalVerification(prisma, asOf);

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.payerType).toBe('CDCP');
    expect(whereArg.status).toBe('PENDING');
    expect(whereArg.recoveryActions.none.actionType).toBe('PAYMENT_VERIFY_SYNC');
  });
});

describe('sweepAccertaCobRouting', () => {
  it('skips a claim whose patient has no provincial secondary', async () => {
    const prisma = mockPrisma({
      insuranceClaim: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'claim-1',
            practiceId: 'practice-1',
            claimNumber: 'CLM-001',
            patientToken: 'token-1',
            resolvedAt: asOf,
          },
        ]),
      },
      cdcpCoverage: { findUnique: vi.fn().mockResolvedValue({ hasProvincialSecondary: false }) },
    });

    const routed = await sweepAccertaCobRouting(prisma, asOf);

    expect(routed).toBe(0);
    expect(prisma.cobRoute.create).not.toHaveBeenCalled();
  });

  it('creates a CobRoute with a 30-day filing deadline when the patient has a provincial secondary', async () => {
    const cobRouteCreate = vi.fn().mockResolvedValue({});
    const claimSubmissionCreate = vi.fn().mockResolvedValue({});
    const prisma = mockPrisma({
      insuranceClaim: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'claim-1',
            practiceId: 'practice-1',
            claimNumber: 'CLM-001',
            patientToken: 'token-1',
            resolvedAt: asOf,
          },
        ]),
      },
      cdcpCoverage: { findUnique: vi.fn().mockResolvedValue({ hasProvincialSecondary: true }) },
      cobRoute: { create: cobRouteCreate },
      claimSubmission: { create: claimSubmissionCreate },
    });

    const routed = await sweepAccertaCobRouting(prisma, asOf);

    expect(routed).toBe(1);
    const data = cobRouteCreate.mock.calls[0][0].data;
    expect(data.secondaryCarrierName).toBe('Accerta');
    expect(data.secondaryFilingDeadline.toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(claimSubmissionCreate).toHaveBeenCalled();
  });
});

describe('sweepAccertaCobEscalation', () => {
  it('escalates a CobRoute unresolved 45+ days after submission and marks it escalated', async () => {
    const submittedAt = new Date(asOf.getTime() - 46 * 24 * 60 * 60 * 1000);
    const update = vi.fn().mockResolvedValue({});
    const prisma = mockPrisma({
      cobRoute: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'cob-1',
            secondaryCarrierName: 'Accerta',
            submittedAt,
            claim: {
              id: 'claim-1',
              practiceId: 'practice-1',
              claimNumber: 'CLM-001',
              carrierId: 'sun_life',
              outstandingAmount: 250,
            },
          },
        ]),
        update,
      },
    });

    const escalated = await sweepAccertaCobEscalation(prisma, asOf);

    expect(escalated).toBe(1);
    expect(update).toHaveBeenCalledWith({ where: { id: 'cob-1' }, data: { escalatedAt: asOf } });
  });
});
