import { describe, expect, it } from 'vitest';
import { mergeClaimRows } from '../src/server/pms/claimRowMerge.js';
import type { NormalizedPmsClaimRow } from '../src/server/pms/parseExportRows.js';

function row(overrides: Partial<NormalizedPmsClaimRow>): NormalizedPmsClaimRow {
  return {
    claimNumber: 'CLM-1',
    patientFirstName: 'Test',
    patientLastName: 'Patient',
    carrierName: 'Sun Life',
    procedureCode: '',
    servicedAt: null,
    submittedAt: null,
    treatmentCodes: null,
    billedAmount: 0,
    outstandingAmount: 0,
    expectedAmount: null,
    insurancePaidAmount: null,
    daysOutstanding: 0,
    patientDob: null,
    subscriberId: null,
    groupPolicyNumber: null,
    subscriberName: null,
    subscriberDateOfBirth: null,
    relationship: null,
    transactionType: null,
    denialReasonCode: null,
    treatingDentistProviderNumber: null,
    ...overrides,
  };
}

describe('mergeClaimRows', () => {
  it('passes single-row claims through unchanged', () => {
    const input = row({ claimNumber: 'A', outstandingAmount: 125, billedAmount: 125, procedureCode: '01202' });
    const { rows, conflicts } = mergeClaimRows([input]);
    expect(conflicts).toEqual([]);
    expect(rows).toEqual([input]);
  });

  it('sums line-level rows into one claim instead of letting the last line win', () => {
    const { rows, conflicts } = mergeClaimRows([
      row({ outstandingAmount: 400, billedAmount: 400, procedureCode: '27211', daysOutstanding: 40 }),
      row({ outstandingAmount: 150, billedAmount: 160, procedureCode: '02391', daysOutstanding: 55 }),
      row({ outstandingAmount: 50, billedAmount: 50, procedureCode: '01202', daysOutstanding: 40 }),
    ]);
    expect(conflicts).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].outstandingAmount).toBe(600);
    expect(rows[0].billedAmount).toBe(610);
    expect(rows[0].daysOutstanding).toBe(55);
    expect(rows[0].treatmentCodes).toBe('27211,02391,01202');
  });

  it('keeps the earliest service date and sums optional amounts only when present', () => {
    const { rows } = mergeClaimRows([
      row({ servicedAt: new Date('2026-06-10'), expectedAmount: 100, insurancePaidAmount: null }),
      row({ servicedAt: new Date('2026-06-02'), expectedAmount: null, insurancePaidAmount: 30 }),
    ]);
    expect(rows[0].servicedAt?.toISOString().slice(0, 10)).toBe('2026-06-02');
    expect(rows[0].expectedAmount).toBe(100);
    expect(rows[0].insurancePaidAmount).toBe(30);
  });

  it('marks the merged claim as a denial when any line carries T11', () => {
    const { rows } = mergeClaimRows([
      row({ transactionType: null }),
      row({ transactionType: 't11', denialReasonCode: 'D04' }),
    ]);
    expect(rows[0].transactionType).toBe('T11');
    expect(rows[0].denialReasonCode).toBe('D04');
  });

  it('refuses to merge rows that name different carriers', () => {
    const { rows, conflicts } = mergeClaimRows([
      row({ carrierName: 'Sun Life', outstandingAmount: 100 }),
      row({ carrierName: 'Manulife', outstandingAmount: 50 }),
    ]);
    expect(rows).toEqual([]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ claimNumber: 'CLM-1', rowCount: 2 });
  });

  it('treats carrier names case-insensitively', () => {
    const { rows, conflicts } = mergeClaimRows([
      row({ carrierName: 'Sun Life ', outstandingAmount: 100 }),
      row({ carrierName: 'sun life', outstandingAmount: 50 }),
    ]);
    expect(conflicts).toEqual([]);
    expect(rows[0].outstandingAmount).toBe(150);
  });

  it('refuses to merge rows that name different treating dentists', () => {
    const { conflicts } = mergeClaimRows([
      row({ treatingDentistProviderNumber: '111' }),
      row({ treatingDentistProviderNumber: '222' }),
    ]);
    expect(conflicts).toHaveLength(1);
  });

  it('keeps separate claims separate', () => {
    const { rows } = mergeClaimRows([
      row({ claimNumber: 'A', outstandingAmount: 10 }),
      row({ claimNumber: 'B', outstandingAmount: 20 }),
      row({ claimNumber: 'A', outstandingAmount: 5 }),
    ]);
    expect(rows.map((r) => [r.claimNumber, r.outstandingAmount])).toEqual([
      ['A', 15],
      ['B', 20],
    ]);
  });
});
