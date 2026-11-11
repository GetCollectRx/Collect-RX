import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyBatch, reopen } = vi.hoisted(() => ({
  verifyBatch: vi.fn(),
  reopen: vi.fn(),
}));

vi.mock('../src/pii-vault.js', () => ({ piiVault: { tokenize: vi.fn(() => 'token-1') } }));
vi.mock('../src/server/recovery/paymentVerification.js', () => ({ runPaymentVerificationBatch: verifyBatch }));
vi.mock('../src/server/pms/absentClaimHandler.js', () => ({ reopenIfReappeared: reopen }));
vi.mock('../src/server/recovery/denialEvidenceService.js', () => ({ syncDenialEvidenceItems: vi.fn() }));
vi.mock('../src/server/reconciliation/underpaymentDetector.js', () => ({
  detectUnderpayment: vi.fn(() => null),
  upsertUnderpaymentCase: vi.fn(),
}));
vi.mock('../src/server/reconciliation/submissionQualityGate.js', () => ({ evaluateSubmissionQuality: vi.fn() }));
vi.mock('../src/server/recovery/cdcpRecoveryBridge.js', () => ({
  buildPmsT11DenialSignal: vi.fn(),
  linkRecoveryActionToCdcpCase: vi.fn(),
}));
vi.mock('../src/server/canadianExpansion/autoReconsideration.js', () => ({ upsertReconsiderationFromSignal: vi.fn() }));
vi.mock('../src/server/services/billing/validateTreatingDentist.js', () => ({ validateTreatingDentistForClaim: vi.fn() }));

import { importPmsClaimsToPrisma } from '../src/server/pms/prismaClaimImporter.js';

const line = (code: string, amount: string) => ({
  claim_number: 'CLM-7',
  patient_first_name: 'Test',
  patient_last_name: 'Patient',
  carrier_name: 'Sun Life',
  procedure_code: code,
  amount_billed: amount,
  amount_outstanding: amount,
  days_outstanding: '45',
});

function prismaWith(existing: { id: string; outstandingAmount: number; recoveryRoute: string | null } | null) {
  return {
    insuranceClaim: {
      findUnique: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({ id: 'claim-7' }),
    },
  };
}

describe('importPmsClaimsToPrisma with a line-level export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyBatch.mockResolvedValue([]);
  });

  it('writes one claim with the summed balance and reports no payment', async () => {
    const prisma = prismaWith(null);
    const result = await importPmsClaimsToPrisma(
      prisma as never,
      [line('27211', '400.00'), line('02391', '150.00'), line('01202', '50.00')],
      'practice-1',
      'generic',
    );

    expect(prisma.insuranceClaim.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.insuranceClaim.upsert.mock.calls[0][0].create.outstandingAmount).toBe(600);
    expect(result).toMatchObject({ imported: 1, failed: 0, sourceRowsAccounted: 3, importedBalanceTotal: 600 });
    expect(verifyBatch).toHaveBeenCalledWith(prisma, 'practice-1', [
      expect.objectContaining({ previousOutstanding: 600, newOutstanding: 600 }),
    ]);
    expect(result.dollarsRecoveredSyncVerified).toBe(0);
  });

  it('only credits verified payments in the import total', async () => {
    verifyBatch.mockResolvedValue([
      { claimId: 'a', verified: true, amountRecoveredCents: 10_000 },
      { claimId: 'b', verified: false, amountRecoveredCents: 25_000 },
    ]);
    const result = await importPmsClaimsToPrisma(
      prismaWith(null) as never,
      [line('01202', '50.00')],
      'practice-1',
      'generic',
    );
    expect(result.paymentsVerified).toBe(1);
    expect(result.dollarsRecoveredSyncVerified).toBe(100);
  });

  it('tries to reopen a claim that was closed and is listed again', async () => {
    const prisma = prismaWith({ id: 'claim-7', outstandingAmount: 600, recoveryRoute: 'STOP' });
    await importPmsClaimsToPrisma(prisma as never, [line('27211', '600.00')], 'practice-1', 'generic');
    expect(reopen).toHaveBeenCalledWith(prisma, 'practice-1', 'claim-7');
  });
});
