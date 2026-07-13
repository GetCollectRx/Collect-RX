import { describe, expect, it } from 'vitest';
import { evidenceRequirementsForDenial } from '../src/server/recovery/denialEvidenceRules.js';
import { detectUnderpayment } from '../src/server/reconciliation/underpaymentDetector.js';
import { normalizeEobRow } from '../src/server/reconciliation/eobImport.js';

describe('denialEvidenceRules', () => {
  it('adds COB evidence for COB-prefixed denial codes', () => {
    const items = evidenceRequirementsForDenial({ denialReasonCode: 'COB-12', carrierId: 'canada_life' });
    expect(items.some((i) => i.evidenceType === 'primary_eob')).toBe(true);
  });

  it('adds carrier-specific documentation hints', () => {
    const items = evidenceRequirementsForDenial({ denialReasonCode: 'DOC', carrierId: 'telus_adjudicare' });
    expect(items.some((i) => i.evidenceType === 'telus_paper_eob')).toBe(true);
  });
});

describe('underpaymentDetector', () => {
  it('flags variance above $5 threshold', () => {
    const result = detectUnderpayment({ expectedAmount: 200, paidAmount: 150 });
    expect(result?.varianceCents).toBe(5000);
  });

  it('ignores when paid meets expected', () => {
    expect(detectUnderpayment({ expectedAmount: 200, paidAmount: 200 })).toBeNull();
  });
});

describe('eobImport normalizeEobRow', () => {
  it('parses remittance columns', () => {
    const row = normalizeEobRow({
      'Claim Number': 'CLM-100',
      Carrier: 'Sun Life',
      'Paid Amount': '$120.00',
      'Expected Amount': '$200.00',
      'Reason Code': 'FREQ',
    });
    expect(row?.claimNumber).toBe('CLM-100');
    expect(row?.paidAmount).toBe(120);
    expect(row?.expectedAmount).toBe(200);
  });
});

describe('recoveryMode labels', () => {
  it('uses CSV confirmation copy in CSV_FIRST mode', async () => {
    const { paymentConfirmationLabel } = await import('../src/server/recovery/recoveryMode.js');
    expect(paymentConfirmationLabel('CSV_FIRST')).toContain('CSV');
  });
});
