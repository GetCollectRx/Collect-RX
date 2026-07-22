import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { raiseMissingPatientDataGate } from '../../src/server/frontDesk/patientDataCompleteness.js';

function gatePrisma(existingGate: { id: string } | null) {
  return {
    claimRecoveryAction: {
      findFirst: vi.fn(async () => existingGate),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
  };
}

const params = {
  practiceId: 'p1',
  claimId: 'claim-1',
  claimNumber: 'CN-100',
  outstandingAmount: 450.5,
  missing: ['subscriberId', 'dateOfBirth'],
};

describe('raiseMissingPatientDataGate', () => {
  it('creates a BLOCKING practice gate with human-readable fields and the blocked dollar amount', async () => {
    const prisma = gatePrisma(null);
    const result = await raiseMissingPatientDataGate(prisma as unknown as PrismaClient, params);

    expect(result.raised).toBe(true);
    expect(prisma.claimRecoveryAction.create).toHaveBeenCalledTimes(1);
    const data = prisma.claimRecoveryAction.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      practiceId: 'p1',
      claimId: 'claim-1',
      actionType: 'MISSING_PATIENT_DATA',
      status: 'BLOCKING',
      route: 'PRACTICE_GATE',
      metadata: { missing: ['subscriberId', 'dateOfBirth'] },
    });
    expect(data.title).toBe('Missing subscriber ID, date of birth — $450.50 blocked from collection');
    expect(data.detail).toContain('CN-100');
    expect(data.detail).toContain('$450.50');
  });

  it('does not duplicate the gate while one is still open', async () => {
    const prisma = gatePrisma({ id: 'gate-1' });
    const result = await raiseMissingPatientDataGate(prisma as unknown as PrismaClient, params);

    expect(result.raised).toBe(false);
    expect(prisma.claimRecoveryAction.create).not.toHaveBeenCalled();
  });

  it('never stores patient identity in the gate', async () => {
    const prisma = gatePrisma(null);
    await raiseMissingPatientDataGate(prisma as unknown as PrismaClient, {
      ...params,
      missing: ['patientName'],
    });

    const data = prisma.claimRecoveryAction.create.mock.calls[0][0].data;
    const stored = JSON.stringify(data);
    // Field labels only — no PHI values are available to this function at all,
    // but pin the contract: the gate mentions WHICH field, never a value.
    expect(stored).toContain('patient name');
    expect(stored).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
