import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CdcpReconsiderationCase, PrismaClient } from '@prisma/client';

vi.mock('../../carriers/adapter.js', () => ({
  checkCarrierBlock: vi.fn().mockResolvedValue({ allowed: true }),
  checkCarrierAuthorizationGate: vi.fn().mockResolvedValue({ allowed: true }),
  isWithinCallWindow: vi.fn().mockReturnValue(true),
}));

vi.mock('./preVisitJobs.js', () => ({
  enqueuePreVisitJob: vi.fn().mockResolvedValue('job-123'),
}));

vi.mock('../emrSyncOutbox.js', () => ({
  enqueueEmrPreVisitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./electronicPreVisit.js', () => ({
  tryCanadaLifePortalPreVisit: vi.fn().mockResolvedValue({ resolved: false }),
  checkTelusTx23Support: vi.fn().mockReturnValue({ supported: false, reason: 'tx23_not_supported' }),
}));

import { verifyBeforeAppointment } from './appointmentVerification.js';
import { enqueuePreVisitJob } from './preVisitJobs.js';
import { checkTelusTx23Support } from './electronicPreVisit.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makeCdcpCase(
  overrides: Partial<CdcpReconsiderationCase> & Pick<CdcpReconsiderationCase, 'procedureCode' | 'denialDate'>,
): CdcpReconsiderationCase {
  return {
    id: 'case-1',
    practiceId: 'prac-1',
    patientToken: 'tok-1',
    claimRef: 'CLM-001',
    carrierCode: 'cdcp_sunlife',
    status: 'open',
    exclusionReason: null,
    clinicalEvidenceSummary: null,
    originalAdjudicatorHint: null,
    metadata: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makePrisma(opts: {
  cdcpCases?: CdcpReconsiderationCase[];
  cdcpFindFirst?: ReturnType<typeof vi.fn>;
  eligibilityThrows?: boolean;
  finalStatus?: string;
  finalReason?: string | null;
}) {
  const updates: Array<{ status: string; reason: string | null }> = [];
  const cdcpFindFirst =
    opts.cdcpFindFirst ??
    vi.fn(async ({ where }: { where: { procedureCode?: { in: string[] } } }) => {
      const variants = where.procedureCode?.in ?? [];
      const matches = (opts.cdcpCases ?? []).filter(
        (c) => c.procedureCode && variants.includes(c.procedureCode),
      );
      return matches.sort((a, b) => b.denialDate.getTime() - a.denialDate.getTime())[0] ?? null;
    });

  return {
    appointmentVerification: {
      create: vi.fn(async () => ({ id: 'av-1' })),
      update: vi.fn(async ({ data }: { data: { status: string; reason?: string | null } }) => {
        updates.push({ status: data.status, reason: data.reason ?? null });
        return { id: 'av-1', ...data };
      }),
      findUnique: vi.fn(async () => ({
        id: 'av-1',
        practiceId: 'prac-1',
        patientToken: 'tok-1',
        procedureCodes: ['D6010'],
        appointmentAt: new Date(),
      })),
    },
    eligibilitySnapshot: {
      findFirst: opts.eligibilityThrows
        ? vi.fn().mockRejectedValue(new Error('db blip'))
        : vi.fn().mockResolvedValue({
            verifiedAt: new Date(Date.now() - 5 * MS_PER_DAY),
          }),
    },
    cdcpReconsiderationCase: {
      findFirst: cdcpFindFirst,
    },
    getLastUpdate: () => updates.at(-1),
    cdcpFindFirst,
  };
}

describe('verifyBeforeAppointment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches CDCP case by appointment procedure code, not most recent denial', async () => {
    const crownCase = makeCdcpCase({
      id: 'crown',
      procedureCode: 'D2740',
      denialDate: new Date(Date.now() - 10 * MS_PER_DAY),
    });
    const implantCase = makeCdcpCase({
      id: 'implant',
      procedureCode: 'D6010',
      denialDate: new Date(Date.now() - 70 * MS_PER_DAY),
    });

    const prismaState = makePrisma({ cdcpCases: [crownCase, implantCase] });
    const prisma = prismaState as unknown as PrismaClient;

    const result = await verifyBeforeAppointment(prisma, {
      practiceId: 'prac-1',
      patientToken: 'tok-1',
      carrierId: 'sun_life',
      procedureCodes: ['D6010'],
      appointmentAt: new Date('2026-06-26T15:00:00Z'),
    });

    expect(result.status).toBe('RED');
    expect(result.reason).toBe('cdcp_window_expired');
    expect(prismaState.cdcpFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          procedureCode: { in: expect.arrayContaining(['D6010', '6010']) },
        }),
      }),
    );
  });

  it('flags tx23CheckRequired and enqueues PRE_VISIT_TELUS_TX23 instead of resolving inline', async () => {
    vi.mocked(checkTelusTx23Support).mockReturnValue({ supported: true });
    const prismaState = makePrisma({});
    const prisma = prismaState as unknown as PrismaClient;

    const result = await verifyBeforeAppointment(prisma, {
      practiceId: 'prac-1',
      patientToken: 'tok-1',
      carrierId: 'telus_adjudicare',
      procedureCodes: ['D0120'],
      appointmentAt: new Date('2026-06-26T15:00:00Z'),
    });

    expect(result.tx23CheckRequired).toBe(true);
    expect(result.tx23Resolved).toBeUndefined();
    expect(enqueuePreVisitJob).toHaveBeenCalledWith(
      'PRE_VISIT_TELUS_TX23',
      expect.objectContaining({ carrierId: 'telus_adjudicare' }),
      undefined,
    );

    // (d) eligibility staleness must run before (f) TELUS Tx23 flag — the old
    // code resolved Tx23 inline and returned before reaching the eligibility
    // check for a TELUS carrier.
    const eligibilityCallOrder = (prismaState.eligibilitySnapshot.findFirst as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const tx23CallOrder = (checkTelusTx23Support as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(eligibilityCallOrder).toBeLessThan(tx23CallOrder);
  });

  it('does not flag tx23CheckRequired when the TPA does not support Tx23', async () => {
    vi.mocked(checkTelusTx23Support).mockReturnValue({ supported: false, reason: 'tx23_not_supported' });
    const prismaState = makePrisma({});
    const prisma = prismaState as unknown as PrismaClient;

    const result = await verifyBeforeAppointment(prisma, {
      practiceId: 'prac-1',
      patientToken: 'tok-1',
      carrierId: 'telus_adjudicare',
      procedureCodes: ['D0120'],
      appointmentAt: new Date('2026-06-26T15:00:00Z'),
    });

    expect(result.tx23CheckRequired).toBeUndefined();
    expect(enqueuePreVisitJob).not.toHaveBeenCalledWith(
      'PRE_VISIT_TELUS_TX23',
      expect.anything(),
      expect.anything(),
    );
  });

  it('marks verification RED and rethrows when an intermediate step fails', async () => {
    const prismaState = makePrisma({ eligibilityThrows: true });
    const prisma = prismaState as unknown as PrismaClient;

    await expect(
      verifyBeforeAppointment(prisma, {
        practiceId: 'prac-1',
        patientToken: 'tok-1',
        carrierId: 'manulife',
        procedureCodes: ['D0120'],
        appointmentAt: new Date('2026-06-26T15:00:00Z'),
      }),
    ).rejects.toThrow('db blip');

    expect(prismaState.getLastUpdate()).toEqual({
      status: 'RED',
      reason: 'verification_error',
    });
  });
});
