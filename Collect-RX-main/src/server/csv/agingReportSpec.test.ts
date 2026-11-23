import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCsvHeaders, parseSimpleCsv } from './parseSimple';
import { AGING_REPORT_FIELDS, agingReportTemplateHeader, checkAgingReport, describeAgingReportSpec } from './agingReportSpec';
import { normalizePmsClaimRow } from '../pms/parseExportRows';

const GOOD = [
  'claim_number,insurance_carrier,patient_first_name,patient_last_name,patient_dob,subscriber_id,amount_outstanding,days_outstanding',
  'CLM-1,Manulife,Alex,Morgan,1984-03-17,9900002277,742.50,45',
  'CLM-2,Sun Life,Sam,Rivera,1979-11-02,9900003388,310.00,60',
].join('\n');

function check(csv: string) {
  return checkAgingReport(readCsvHeaders(csv), parseSimpleCsv(csv));
}

const codes = (csv: string) => check(csv).problems.map((p) => `${p.code}:${p.field ?? ''}`);

describe('aging report header check', () => {
  it('accepts a sound file and the repository sample', () => {
    expect(check(GOOD).ok).toBe(true);
    const sample = readFileSync(resolve(__dirname, '../../../sample-claims.csv'), 'utf8');
    expect(check(sample)).toMatchObject({ ok: true });
  });

  it('refuses a file with a required column missing, and says which', () => {
    const csv = GOOD.replace('patient_dob,', '').replace(/,1984-03-17/u, '').replace(/,1979-11-02/u, '');
    expect(codes(csv)).toEqual(['MISSING_COLUMN:patient_dob']);
  });

  it('names a misspelled header and tells staff what to rename it to', () => {
    const csv = GOOD.replace('amount_outstanding', 'amount_outstandng');
    const result = check(csv);
    expect(result.ok).toBe(false);
    const problem = result.problems.find((p) => p.field === 'amount_outstanding');
    expect(problem?.code).toBe('MISSING_COLUMN');
    expect(problem?.suggestion).toContain('amount_outstandng');
    expect(problem?.suggestion).toContain('amount_outstanding');
  });

  it('does not let a patient balance column stand in for what the insurer owes', () => {
    const csv = GOOD.replace('amount_outstanding', 'balance');
    const problem = check(csv).problems.find((p) => p.field === 'amount_outstanding');
    expect(problem?.code).toBe('MISSING_COLUMN');
    expect(problem?.suggestion).toMatch(/patient's own balance/u);
  });

  it('refuses a required column that is empty on every row, but not one blank cell', () => {
    const allBlank = GOOD.replace('1984-03-17', '').replace('1979-11-02', '');
    expect(codes(allBlank)).toEqual(['EMPTY_COLUMN:patient_dob']);
    const oneBlank = GOOD.replace('1984-03-17', '');
    expect(check(oneBlank).ok).toBe(true);
  });

  it('refuses two columns that could both be the same field, and a repeated column name', () => {
    const ambiguous = GOOD.replace('days_outstanding', 'days_outstanding,outstanding').replace(/,45$/mu, ',45,1').replace(/,60$/mu, ',60,2');
    expect(codes(ambiguous)).toEqual(['AMBIGUOUS_COLUMN:amount_outstanding']);
    const duplicate = GOOD.replace('patient_dob,', 'patient_dob,patient_dob,').replace('1984-03-17', '1984-03-17,1984-03-17').replace('1979-11-02', '1979-11-02,1979-11-02');
    expect(codes(duplicate)).toContain('DUPLICATE_COLUMN:');
  });

  it('accepts claim age from a date and refuses a file with no age column at all', () => {
    const byDate = GOOD.replace('days_outstanding', 'submission_date').replace(/,45$/mu, ',2026-09-01').replace(/,60$/mu, ',2026-08-20');
    expect(check(byDate).ok).toBe(true);
    const none = GOOD.replace(',days_outstanding', '').replace(/,45$/mu, '').replace(/,60$/mu, '');
    expect(codes(none)).toEqual(['MISSING_COLUMN:claim_age']);
  });

  it('refuses a file with a header and no rows', () => {
    expect(codes('claim_number,insurance_carrier')).toEqual(['NO_DATA_ROWS:']);
  });

  it('reads the member ID from a Policy Number or Member ID column, which the importer used to drop', () => {
    for (const header of ['Policy Number', 'Member ID', 'policy_number', 'Subscriber ID']) {
      const csv = `claim_number,insurance_carrier,patient_first_name,patient_last_name,patient_dob,${header},amount_outstanding,days_outstanding\nCLM-3,Manulife,Alex,Morgan,1984-03-17,9900002277,742.50,45`;
      const [row] = parseSimpleCsv(csv);
      expect(normalizePmsClaimRow(row as Record<string, unknown>, 'generic').subscriberId, header).toBe('9900002277');
      expect(check(csv).ok, header).toBe(true);
    }
  });

  it('gives the template header exactly the required column names', () => {
    const header = agingReportTemplateHeader().split(',');
    for (const field of AGING_REPORT_FIELDS) expect(header).toContain(field.preferred);
    expect(describeAgingReportSpec().map((f) => f.column)).toEqual(AGING_REPORT_FIELDS.map((f) => f.preferred));
  });

  it('stays in step with the importer: every preferred column name the screen shows is read by the importer', () => {
    const csv = `${agingReportTemplateHeader()}\nCLM-9,Manulife,Alex,Morgan,1984-03-17,9900002277,742.50,45,1180.00,2026-09-01,D2750`;
    const [row] = parseSimpleCsv(csv);
    const normalized = normalizePmsClaimRow(row as Record<string, unknown>, 'generic');
    expect(normalized.claimNumber).toBe('CLM-9');
    expect(normalized.carrierName).toBe('Manulife');
    expect(normalized.patientFirstName).toBe('Alex');
    expect(normalized.patientLastName).toBe('Morgan');
    expect(normalized.patientDob).toBe('1984-03-17');
    expect(normalized.subscriberId).toBe('9900002277');
    expect(normalized.outstandingAmount).toBe(742.5);
    expect(normalized.daysOutstanding).toBe(45);
    expect(check(csv).ok).toBe(true);
  });
});
