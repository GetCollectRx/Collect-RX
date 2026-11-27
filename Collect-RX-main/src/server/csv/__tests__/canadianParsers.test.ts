import { describe, expect, it } from 'vitest';
import { CsvStructureError, parseIndustryCsv } from '../csvParser';
import type { IndustryType } from '../../../types/industry-claims';

// Fixtures follow the column layouts documented for each vendor. They are
// synthetic (no real people or policies) and are NOT verified against live exports.
const SYMBILITY = [
  'Symbility Claim ID,Claim #,Policy #,Insurance Carrier,Insured Name,Date of Loss,Estimate Total,Outstanding Balance',
  'SYM-1001,CLM-77001,POL-A1,Intact Insurance,Alex Testperson,03/04/2026,"12,450.00","3,200.50"',
  'SYM-1002,CLM-77002,POL-A2,Aviva Canada,Sam Sampleton,25/04/2026,8000.00,1000.00',
].join('\n');

const JANE = [
  'Patient ID,Invoice #,Policy Number,Insurer,Patient Name,Appointment Date,Invoice Total,Outstanding',
  'P-501,INV-9001,POLJ1,Sun Life,Robin Fixture,05/06/2026,120.00,120.00',
].join('\n');

const MITCHELL = [
  'Claim #,RO #,VIN,Insurance Company,Insured Name,Date of Loss,Total Gross Estimate,Insurance Balance',
  'CL-3001,RO-8801,1HGCM82633A004352,Intact Insurance,Casey Mockwell,2026-03-04,5400.00,2100.00',
].join('\n');

const TRACKER = [
  'Claim #,Chart #,Subscriber ID,Insurance Company,Patient Name,Treatment Date,Ins Portion Owing',
  'T-100,CH-12,SUB-77,Canada Life,Jordan Dummy,07/08/2026,245.00',
].join('\n');

describe('Symbility (property restoration)', () => {
  it('aliases headers and parses DMY strictly', () => {
    const r = parseIndustryCsv(SYMBILITY, { industryType: 'PROPERTY_RESTORATION', dateFormat: 'DMY' });
    expect(r.rejected).toEqual([]);
    expect(r.records.map((x) => x.dateOfService)).toEqual(['2026-04-03', '2026-04-25']);
    expect(r.records[0]?.claimNumber).toBe('CLM-77001');
    expect(r.records[0]?.balanceDue).toBe('3200.50');
    expect(r.mappedHeaders.primaryReferenceId).toBe('Symbility Claim ID');
    expect(r.dateAssumedRowCount).toBe(0);
  });

  it('reads the same ambiguous date as March 4 under MDY', () => {
    const r = parseIndustryCsv(SYMBILITY.split('\n').slice(0, 2).join('\n'), {
      industryType: 'PROPERTY_RESTORATION',
      dateFormat: 'MDY',
    });
    expect(r.records[0]?.dateOfService).toBe('2026-03-04');
  });

  it('rejects the file when a day-first date appears and no dateFormat is given', () => {
    expect(() => parseIndustryCsv(SYMBILITY, { industryType: 'PROPERTY_RESTORATION' })).toThrowError(
      expect.objectContaining({ code: 'DATE_FORMAT_REQUIRED' }),
    );
  });

  it('quarantines the file when a day-first date is read under MDY, instead of swapping day and month', () => {
    expect(() => parseIndustryCsv(SYMBILITY, { industryType: 'PROPERTY_RESTORATION', dateFormat: 'MDY' })).toThrowError(
      expect.objectContaining({ code: 'TOO_MANY_ERRORS' }),
    );
  });
});

describe('Jane App (paramedical / physio)', () => {
  it('aliases headers and parses DMY', () => {
    const r = parseIndustryCsv(JANE, { industryType: 'PARAMEDICAL_PHYSIO', dateFormat: 'DMY' });
    expect(r.rejected).toEqual([]);
    expect(r.records[0]).toMatchObject({
      claimNumber: 'INV-9001',
      payerName: 'Sun Life',
      dateOfService: '2026-06-05',
      balanceDue: '120.00',
    });
  });
});

describe('Mitchell / Audatex (auto collision)', () => {
  it('aliases headers and accepts ISO dates under any dateFormat', () => {
    for (const dateFormat of ['DMY', 'MDY', 'YMD'] as const) {
      const r = parseIndustryCsv(MITCHELL, { industryType: 'AUTO_COLLISION', dateFormat });
      expect(r.rejected).toEqual([]);
      expect(r.records[0]).toMatchObject({ dateOfService: '2026-03-04', claimNumber: 'CL-3001' });
    }
  });
});

describe('Tracker / AbelMed (dental)', () => {
  it('aliases headers and parses DMY', () => {
    const r = parseIndustryCsv(TRACKER, { industryType: 'DENTAL', dateFormat: 'DMY' });
    expect(r.rejected).toEqual([]);
    expect(r.records[0]).toMatchObject({ dateOfService: '2026-08-07', balanceDue: '245.00' });
  });
});

describe('validation errors', () => {
  const cases: Array<[string, IndustryType, string]> = [
    ['Symbility', 'PROPERTY_RESTORATION', SYMBILITY],
    ['Jane App', 'PARAMEDICAL_PHYSIO', JANE],
    ['Mitchell', 'AUTO_COLLISION', MITCHELL],
    ['Tracker', 'DENTAL', TRACKER],
  ];

  it.each(cases)('%s: a missing required column fails the whole file cleanly', (_name, industryType, csv) => {
    const [header = '', ...rows] = csv.split('\n');
    const withoutPayer = [header.split(',').slice(0, -1).join(','), ...rows.map((r) => r.split(',').slice(0, -1).join(','))].join('\n');
    expect(() => parseIndustryCsv(withoutPayer, { industryType, dateFormat: 'DMY' })).toThrowError(CsvStructureError);
  });

  // Files with more than 10% bad rows are quarantined, so row-level cases need enough good rows.
  const goodJaneRows = Array.from(
    { length: 12 },
    (_v, i) => `P-${600 + i},INV-${9100 + i},POLJ${i},Sun Life,Client Number${i},05/06/2026,100.00,100.00`,
  ).join('\n');

  it('rejects a row with an empty required value and keeps the good rows', () => {
    const csv = `${JANE}\n${goodJaneRows}\nP-502,INV-9002,POLJ2,Sun Life,,06/06/2026,90.00,90.00`;
    const r = parseIndustryCsv(csv, { industryType: 'PARAMEDICAL_PHYSIO', dateFormat: 'DMY' });
    expect(r.records).toHaveLength(13);
    expect(r.rejected).toEqual([expect.objectContaining({ field: 'insuredName', code: 'REQUIRED_VALUE_MISSING' })]);
  });

  it('rejects an unreadable date as a row error', () => {
    const csv = `${JANE.replace('05/06/2026', 'June fifth')}\n${goodJaneRows}`;
    const r = parseIndustryCsv(csv, { industryType: 'PARAMEDICAL_PHYSIO', dateFormat: 'DMY' });
    expect(r.records).toHaveLength(12);
    expect(r.rejected[0]?.code).toBe('UNRECOGNISED_DATE');
  });

  it('rejects empty files and unknown industries', () => {
    expect(() => parseIndustryCsv('Claim #\n', { industryType: 'DENTAL', dateFormat: 'DMY' })).toThrowError(CsvStructureError);
    expect(() =>
      parseIndustryCsv(JANE, { industryType: 'BOGUS' as IndustryType, dateFormat: 'DMY' }),
    ).toThrowError(expect.objectContaining({ code: 'BAD_INDUSTRY' }));
  });
});
