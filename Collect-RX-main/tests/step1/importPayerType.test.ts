// Step 1 (DEC-10): new claims must be classified by payer program on import.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyBatch } = vi.hoisted(() => ({ verifyBatch: vi.fn() }));
vi.mock('../../src/pii-vault.js', () => ({ piiVault: { tokenize: vi.fn(() => 'token-1') } }));
vi.mock('../../src/server/recovery/paymentVerification.js', () => ({ runPaymentVerificationBatch: verifyBatch }));
vi.mock('../../src/server/pms/absentClaimHandler.js', () => ({ reopenIfReappeared: vi.fn() }));
vi.mock('../../src/server/recovery/denialEvidenceService.js', () => ({ syncDenialEvidenceItems: vi.fn() }));
vi.mock('../../src/server/reconciliation/underpaymentDetector.js', () => ({
  detectUnderpayment: vi.fn(() => null),
  upsertUnderpaymentCase: vi.fn(),
}));
vi.mock('../../src/server/reconciliation/submissionQualityGate.js', () => ({ evaluateSubmissionQuality: vi.fn() }));
vi.mock('../../src/server/recovery/cdcpRecoveryBridge.js', () => ({
  buildPmsT11DenialSignal: vi.fn(),
  linkRecoveryActionToCdcpCase: vi.fn(),
}));
vi.mock('../../src/server/canadianExpansion/autoReconsideration.js', () => ({ upsertReconsiderationFromSignal: vi.fn() }));
vi.mock('../../src/server/services/billing/validateTreatingDentist.js', () => ({ validateTreatingDentistForClaim: vi.fn() }));

import { importPmsClaimsToPrisma } from '../../src/server/pms/prismaClaimImporter.js';
import { parsePayerTypeInput } from '../../src/server/pms/payerTypeInput.js';
import { normalizePmsClaimRow } from '../../src/server/pms/parseExportRows.js';
import { mergeClaimRows } from '../../src/server/pms/claimRowMerge.js';

const row = (overrides: Record<string, unknown> = {}) => ({
  claim_number: 'CLM-1',
  patient_first_name: 'Test',
  patient_last_name: 'Patient',
  carrier_name: 'Sun Life',
  procedure_code: '27211',
  amount_billed: '100.00',
  amount_outstanding: '100.00',
  days_outstanding: '45',
  ...overrides,
});

function prismaWith(existing: Record<string, unknown> | null) {
  return {
    insuranceClaim: {
      findUnique: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({ id: 'claim-1' }),
    },
  };
}

describe('parsePayerTypeInput', () => {
  it.each([
    ['PRIVATE', 'PRIVATE'],
    ['private plan', 'PRIVATE'],
    ['Employer', 'PRIVATE'],
    ['cdcp', 'CDCP'],
    ['Canadian Dental Care Plan', 'CDCP'],
    ['Provincial', 'PROVINCIAL'],
    ['ODSP', 'PROVINCIAL'],
    ['healthy_smiles_ontario', 'PROVINCIAL'],
  ])('maps %s to %s', (input, expected) => {
    expect(parsePayerTypeInput(input)).toEqual({ ok: true, value: expected });
  });
  it('treats empty and absent as not classified', () => {
    expect(parsePayerTypeInput('')).toEqual({ ok: true, value: null });
    expect(parsePayerTypeInput('   ')).toEqual({ ok: true, value: null });
    expect(parsePayerTypeInput(undefined)).toEqual({ ok: true, value: null });
  });
  it('rejects an unrecognized value instead of guessing', () => {
    expect(parsePayerTypeInput('medicare')).toMatchObject({ ok: false });
    expect(parsePayerTypeInput(42)).toMatchObject({ ok: false });
  });
});

describe('row parsing and merging', () => {
  it('reads an optional Payer Type column', () => {
    expect(normalizePmsClaimRow(row({ 'Payer Type': 'CDCP' }), 'generic').payerType).toBe('CDCP');
    expect(normalizePmsClaimRow(row(), 'generic').payerType).toBeNull();
  });
  it('rejects a row with an unrecognized payer type', () => {
    expect(() => normalizePmsClaimRow(row({ payer_type: 'medicare' }), 'generic')).toThrow(/Unrecognized payer type/);
  });
  it('refuses to merge rows of one claim that disagree on payer type', () => {
    const merged = mergeClaimRows([
      normalizePmsClaimRow(row({ payer_type: 'PRIVATE' }), 'generic'),
      normalizePmsClaimRow(row({ payer_type: 'CDCP' }), 'generic'),
    ]);
    expect(merged.rows).toHaveLength(0);
    expect(merged.conflicts[0].error).toMatch(/different payer types/);
  });
});

describe('importPmsClaimsToPrisma payer classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyBatch.mockResolvedValue([]);
  });

  it('rejects a new claim that has no payer type and no file-level declaration', async () => {
    const prisma = prismaWith(null);
    const result = await importPmsClaimsToPrisma(prisma as never, [row()], 'p1', 'generic');
    expect(result.failed).toBe(1);
    expect(result.imported).toBe(0);
    expect(result.errors[0]).toMatchObject({ claimNumber: 'CLM-1' });
    expect(result.errors[0].error).toMatch(/Payer type is required for new claims/);
    expect(prisma.insuranceClaim.upsert).not.toHaveBeenCalled();
  });

  it('uses the file-level declaration for rows with no column', async () => {
    const prisma = prismaWith(null);
    const result = await importPmsClaimsToPrisma(prisma as never, [row()], 'p1', 'generic', {
      defaultPayerType: 'PRIVATE',
    });
    expect(result.imported).toBe(1);
    expect(prisma.insuranceClaim.upsert.mock.calls[0][0].create.payerType).toBe('PRIVATE');
  });

  it("lets a row's own column win over the file-level declaration", async () => {
    const prisma = prismaWith(null);
    await importPmsClaimsToPrisma(prisma as never, [row({ payer_type: 'CDCP' })], 'p1', 'generic', {
      defaultPayerType: 'PRIVATE',
    });
    expect(prisma.insuranceClaim.upsert.mock.calls[0][0].create.payerType).toBe('CDCP');
  });

  it('imports an unclassified existing claim without a declaration and leaves it unclassified', async () => {
    const prisma = prismaWith({ id: 'claim-1', outstandingAmount: 100, recoveryRoute: null, payerType: null });
    const result = await importPmsClaimsToPrisma(prisma as never, [row()], 'p1', 'generic');
    expect(result.imported).toBe(1);
    expect(prisma.insuranceClaim.upsert.mock.calls[0][0].update).not.toHaveProperty('payerType');
  });

  it('classifies an existing unclassified claim when the import declares a type', async () => {
    const prisma = prismaWith({ id: 'claim-1', outstandingAmount: 100, recoveryRoute: null, payerType: null });
    await importPmsClaimsToPrisma(prisma as never, [row()], 'p1', 'generic', { defaultPayerType: 'PRIVATE' });
    expect(prisma.insuranceClaim.upsert.mock.calls[0][0].update.payerType).toBe('PRIVATE');
  });

  it('never reclassifies a claim that already has a payer type', async () => {
    const prisma = prismaWith({ id: 'claim-1', outstandingAmount: 100, recoveryRoute: null, payerType: 'CDCP' });
    await importPmsClaimsToPrisma(prisma as never, [row()], 'p1', 'generic', { defaultPayerType: 'PRIVATE' });
    expect(prisma.insuranceClaim.upsert.mock.calls[0][0].update).not.toHaveProperty('payerType');
  });
});
