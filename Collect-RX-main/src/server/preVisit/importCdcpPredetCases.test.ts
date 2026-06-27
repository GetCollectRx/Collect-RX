import { describe, expect, it } from 'vitest';
import { parseCdcpPredetCsvRows } from './importCdcpPredetCases.js';

describe('parseCdcpPredetCsvRows', () => {
  it('maps common CSV headers to import rows', () => {
    const { rows, errors } = parseCdcpPredetCsvRows([
      {
        claim_ref: 'PD-001',
        patient_token: '00000000-0000-4000-8000-000000000099',
        procedure_code: '2750',
        denial_date: '2026-05-01',
        clinical_evidence_summary: 'Missing x-ray',
      },
    ]);

    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].claimRef).toBe('PD-001');
    expect(rows[0].procedureCode).toBe('D2750');
    expect(rows[0].denialDate.toISOString().slice(0, 10)).toBe('2026-05-01');
  });

  it('reports missing required fields', () => {
    const { rows, errors } = parseCdcpPredetCsvRows([
      { claim_ref: 'PD-002', procedure_code: 'D2740' },
    ]);

    expect(rows).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toMatch(/patient_token/);
  });
});
