import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  ensureCdcpCaseForClaim,
  findCdcpCaseForRecovery,
  hasOpenCdcpCaseForClaim,
  primaryProcedureFromTreatmentCodes,
} from '../../src/server/recovery/cdcpRecoveryBridge.js';

describe('primaryProcedureFromTreatmentCodes', () => {
  it('extracts the first CDT code from a comma-separated list', () => {
    expect(primaryProcedureFromTreatmentCodes('D2750, D1110')).toBe('D2750');
  });

  it('returns null for empty input', () => {
    expect(primaryProcedureFromTreatmentCodes(null)).toBeNull();
    expect(primaryProcedureFromTreatmentCodes('')).toBeNull();
  });
});

describe('findCdcpCaseForRecovery', () => {
  it('finds predet case by patient and procedure when claim ref differs', async () => {
    const predetCase = {
      id: 'case-predet',
      claimRef: 'PD-001',
    };
    const prisma = {
      cdcpReconsiderationCase: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(predetCase),
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const found = await findCdcpCaseForRecovery(prisma, {
      practiceId: 'practice-1',
      patientToken: 'patient-token',
      claimRef: 'CLM-123',
      procedureCode: 'D2750',
    });

    expect(found).toEqual({ id: 'case-predet', claimRef: 'PD-001' });
  });

  it('finds case via linkedClaimRefs in metadata', async () => {
    const prisma = {
      cdcpReconsiderationCase: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'case-linked',
            claimRef: 'PD-002',
            metadata: { linkedClaimRefs: ['CLM-456'] },
          },
        ]),
      },
    } as unknown as PrismaClient;

    const found = await findCdcpCaseForRecovery(prisma, {
      practiceId: 'practice-1',
      patientToken: 'patient-token',
      claimRef: 'CLM-456',
    });

    expect(found).toEqual({ id: 'case-linked', claimRef: 'PD-002' });
  });
});

describe('ensureCdcpCaseForClaim', () => {
  it('links post-visit claim ref to existing predet case instead of creating duplicate', async () => {
    const predetCase = {
      id: 'case-predet',
      claimRef: 'PD-001',
      metadata: null,
    };
    const update = vi.fn().mockResolvedValue({});
    const create = vi.fn();

    const prisma = {
      cdcpReconsiderationCase: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(predetCase),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ id: 'case-predet', metadata: null }),
        create,
        update,
      },
    } as unknown as PrismaClient;

    const result = await ensureCdcpCaseForClaim(prisma, {
      practiceId: 'practice-1',
      patientToken: 'patient-token',
      claimRef: 'CLM-123',
      procedureCode: 'D2750',
    });

    expect(result).toEqual({ caseId: 'case-predet', created: false });
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 'case-predet' },
      data: { metadata: { linkedClaimRefs: ['CLM-123'] } },
    });
  });
});

describe('hasOpenCdcpCaseForClaim', () => {
  it('returns true when predet case matches procedure', async () => {
    const prisma = {
      cdcpReconsiderationCase: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'case-1', claimRef: 'PD-001' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const open = await hasOpenCdcpCaseForClaim(prisma, {
      practiceId: 'practice-1',
      patientToken: 'patient-token',
      claimRef: 'CLM-999',
      procedureCode: 'D2750',
    });

    expect(open).toBe(true);
  });
});
