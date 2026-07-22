import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('../emrSyncOutbox.js', () => ({
  enqueueEmrPreVisitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./preVisitJobs.js', () => ({
  enqueuePreVisitJob: vi.fn().mockResolvedValue('job-recall-1'),
}));

vi.mock('../adjudication/writeAdjudicationEvent.js', () => ({
  writeAdjudicationEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../vapi/vapiWebhook.js', () => ({
  scrubTranscriptPhi: vi.fn((t: string) => t),
}));

import { processPreVisitCallEnded } from './preVisitWebhook.js';
import { enqueuePreVisitJob } from './preVisitJobs.js';
import {
  buildPreVisitApprovedPayload,
  buildPreVisitDeniedPayload,
} from '../../../tests/fixtures/preVisitWebhooks.js';

function makeVerificationPrisma(verification: {
  id: string;
  practiceId: string;
  patientToken: string;
  carrierId: 'sun_life';
  procedureCodes: string[];
  appointmentAt: Date;
  attemptCount: number;
  missingArtifacts: string[];
}) {
  const updates: Array<Record<string, unknown>> = [];
  const createdCases: Array<Record<string, unknown>> = [];

  return {
    appointmentVerification: {
      findUnique: vi.fn().mockResolvedValue(verification),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return { ...verification, ...data };
      }),
    },
    cdcpReconsiderationCase: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({
        id: 'cdcp-case-new',
        practiceId: verification.practiceId,
        patientToken: verification.patientToken,
        claimRef: 'PD-FIXTURE-DENIED',
        procedureCode: 'D2750',
        denialDate: new Date(),
        status: 'open',
        exclusionReason: null,
        clinicalEvidenceSummary: 'test',
        originalAdjudicatorHint: null,
        metadata: null,
        carrierCode: 'cdcp_sunlife',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdCases.push(data);
        return { id: 'cdcp-case-new', ...data };
      }),
    },
    eligibilitySnapshot: {
      create: vi.fn().mockResolvedValue({ id: 'snap-1' }),
    },
    getLastUpdate: () => updates.at(-1),
    createdCases,
  } as unknown as PrismaClient & {
    getLastUpdate: () => Record<string, unknown> | undefined;
    createdCases: Array<Record<string, unknown>>;
  };
}

describe('processPreVisitCallEnded', () => {
  const baseVerification = {
    id: 'verification-fixture',
    practiceId: 'practice-fixture',
    patientToken: '00000000-0000-4000-8000-00000000a001',
    carrierId: 'sun_life' as const,
    procedureCodes: ['D2750'],
    appointmentAt: new Date('2026-06-28T15:00:00Z'),
    attemptCount: 1,
    missingArtifacts: ['periapical_xray'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks verification GREEN when predet is approved', async () => {
    const prismaState = makeVerificationPrisma(baseVerification);
    const payload = buildPreVisitApprovedPayload({
      metadata: {
        appointmentVerificationId: baseVerification.id,
        practiceId: baseVerification.practiceId,
        patientToken: baseVerification.patientToken,
        carrierId: 'sun_life',
        preVisitType: 'cdcp_predet',
        cdcpContext: true,
      },
    });

    const handled = await processPreVisitCallEnded(payload, prismaState);
    expect(handled).toBe(true);
    expect(prismaState.getLastUpdate()).toMatchObject({
      status: 'GREEN',
      reason: 'cdcp_predet_approved',
    });
  });

  it('marks verification RED and creates CDCP case when predet is denied', async () => {
    const prismaState = makeVerificationPrisma(baseVerification);
    const payload = buildPreVisitDeniedPayload({
      metadata: {
        appointmentVerificationId: baseVerification.id,
        practiceId: baseVerification.practiceId,
        patientToken: baseVerification.patientToken,
        carrierId: 'sun_life',
        preVisitType: 'cdcp_predet',
        cdcpContext: true,
      },
    });

    const handled = await processPreVisitCallEnded(payload, prismaState);
    expect(handled).toBe(true);
    expect(prismaState.getLastUpdate()?.status).toBe('RED');
    expect(prismaState.createdCases.length).toBeGreaterThan(0);
  });

  it('enqueues a recall job when call fails and attempts remain', async () => {
    const prismaState = makeVerificationPrisma({ ...baseVerification, attemptCount: 1 });
    const payload = {
      type: 'call.failed' as const,
      call: {
        id: 'vapi-failed-1',
        status: 'failed' as const,
        endedAt: '2026-06-26T12:00:00.000Z',
      },
      metadata: {
        appointmentVerificationId: baseVerification.id,
        practiceId: baseVerification.practiceId,
        patientToken: baseVerification.patientToken,
        carrierId: 'sun_life' as const,
        preVisitType: 'cdcp_predet' as const,
        cdcpContext: true,
      },
    };

    await processPreVisitCallEnded(payload, prismaState);
    expect(prismaState.getLastUpdate()).toMatchObject({
      status: 'YELLOW',
      reason: 'call_failed_retry',
    });
    expect(enqueuePreVisitJob).toHaveBeenCalledWith(
      'PRE_VISIT_CDCP_PREDET',
      expect.objectContaining({
        appointmentVerificationId: baseVerification.id,
        cdcpContext: true,
      }),
      4 * 60 * 60 * 1000,
    );
  });
});
