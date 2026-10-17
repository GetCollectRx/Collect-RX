import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  parseIndustryCsv,
  parseMoneyToCents,
  parseNanpPhone,
  parseDate,
  toClaimPersistFields,
  CsvStructureError,
} from './csvParser';
import { INDUSTRY_TYPES, REFERENCE_KINDS } from '../../types/industry-claims';
import { normalizeHeader } from '../../config/csv-aliases';

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962';

describe('schema parity', () => {
  const schema = readFileSync(resolve(__dirname, '../../../prisma/schema.prisma'), 'utf8');
  const enumValues = (name: string) => {
    const m = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema)!;
    return m[1]!
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('@@'));
  };
  it('IndustryType literals match prisma enum', () => {
    expect([...INDUSTRY_TYPES]).toEqual(enumValues('IndustryType'));
  });
  it('ReferenceKind literals match prisma enum', () => {
    expect([...REFERENCE_KINDS]).toEqual(enumValues('ReferenceKind'));
  });
});

describe('field parsers', () => {
  it('normalizes headers across case, punctuation and accents', () => {
    expect(normalizeHeader('Claim #')).toBe('claim');
    expect(normalizeHeader('Numéro de réclamation')).toBe('numerodereclamation');
  });
  it('parses NANP phones and rejects invalid ones', () => {
    expect(parseNanpPhone('(613) 555-0123')).toBe('+16135550123');
    expect(parseNanpPhone('+1 613 555 0123')).toBe('+16135550123');
    expect(parseNanpPhone('055-555-0123')).toBeNull();
    expect(parseNanpPhone('123')).toBeNull();
  });
  it('parses money as integer cents', () => {
    expect(parseMoneyToCents('$18,500.00 CAD')).toBe(1850000);
    expect(parseMoneyToCents('1 234,50 $')).toBe(123450);
    expect(parseMoneyToCents('(50.25)')).toBe(-5025);
    expect(parseMoneyToCents('abc')).toBeNull();
  });
  it('defaults slashed dates to month-first and flags the assumption', () => {
    expect(parseDate('03/04/2026')).toEqual({ ok: true, value: '2026-03-04', assumed: true });
    expect(parseDate('03/03/2026')).toEqual({ ok: true, value: '2026-03-03', assumed: false });
    expect(parseDate('04/25/2026')).toEqual({ ok: true, value: '2026-04-25', assumed: false });
  });
  it('treats a day-first-only date as evidence that needs an explicit format', () => {
    expect(parseDate('25/04/2026')).toEqual({ ok: false, code: 'DMY_EVIDENCE_NO_FORMAT' });
  });
  it('is strict when dateFormat is explicit', () => {
    expect(parseDate('03/04/2026', 'DMY')).toEqual({ ok: true, value: '2026-04-03', assumed: false });
    expect(parseDate('03/04/2026', 'MDY')).toEqual({ ok: true, value: '2026-03-04', assumed: false });
    expect(parseDate('25/04/2026', 'MDY')).toEqual({ ok: false, code: 'INVALID_DATE' });
    expect(parseDate('2026-02-30')).toEqual({ ok: false, code: 'INVALID_DATE' });
  });
});

describe('parseIndustryCsv', () => {
  const autoCsv = [
    'RO #,VIN,Insurance Company,Claim #,Customer Name,Date of Loss,Total Gross Estimate,Insurance Balance,Adjuster Phone',
    'RO-1001,1HGCM82633A004352,Intact,CL-77,Jane Doe,2026-09-01,"$4,200.00","$1,200.50",(416) 555-0199',
    'RO-1002,2T1BR32E04C123456,Aviva,CL-78,John Roe,2026-09-02,$900.00,$900.00,',
  ].join('\n');

  it('maps Canadian auto collision headers to canonical records', () => {
    const res = parseIndustryCsv(autoCsv, { industryType: 'AUTO_COLLISION' });
    expect(res.records).toHaveLength(2);
    const r = res.records[0]!;
    expect(r.primaryReferenceKind).toBe('REPAIR_ORDER');
    expect(r.secondaryReferenceKind).toBe('VIN');
    expect(r.billedAmount).toBe('4200.00');
    expect(r.balanceDue).toBe('1200.50');
    expect(r.payerPhone).toBe('+14165550199');
    expect(r.rowHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects the file when a required column is missing', () => {
    const csv = 'RO #,VIN,Claim #\nRO-1,1HG,CL-1';
    expect(() => parseIndustryCsv(csv, { industryType: 'AUTO_COLLISION' })).toThrow(CsvStructureError);
  });

  it('flags duplicate rows within a file and keeps the first', () => {
    const csv = autoCsv + '\nRO-1001,1HGCM82633A004352,Intact,CL-77,Jane Doe,2026-09-01,"$4,200.00","$1,200.50",';
    const res = parseIndustryCsv(csv, { industryType: 'AUTO_COLLISION' });
    expect(res.records).toHaveLength(2);
    expect(res.duplicateRows).toEqual([4]);
  });

  it('neutralises formula injection in text fields', () => {
    const csv = autoCsv.replace('Jane Doe', '=HYPERLINK("http://x")');
    const res = parseIndustryCsv(csv, { industryType: 'AUTO_COLLISION' });
    expect(res.records[0]!.insuredName.startsWith("'")).toBe(true);
  });

  it('handles quoted commas, escaped quotes, BOM and CRLF', () => {
    const csv = '﻿Job #,Policy #,Insurer,Claim #,Policyholder,Date of Loss,Estimate Total,Outstanding Balance\r\nJ-1,POL-9,"Co-operators, The",C-1,"Smith ""Sam"" A",2026-08-15,$100.00,$100.00\r\n';
    const res = parseIndustryCsv(csv, { industryType: 'PROPERTY_RESTORATION' });
    expect(res.records[0]!.payerName).toBe('Co-operators, The');
    expect(res.records[0]!.insuredName).toBe('Smith "Sam" A');
  });

  it('quarantines the file when the error rate is above the threshold', () => {
    const rows = ['RO #,Insurance Company,Claim #,Customer Name,Date of Loss,Insurance Balance'];
    for (let i = 0; i < 10; i++) rows.push(`RO-${i},Intact,C-${i},Name,not-a-date,$1.00`);
    expect(() => parseIndustryCsv(rows.join('\n'), { industryType: 'AUTO_COLLISION' })).toThrow(/quarantined/);
  });

  it('rejects a file mixing a day-first date with no dateFormat, accepts it with DMY', () => {
    const csv = autoCsv.replace('2026-09-01', '25/09/2026');
    expect(() => parseIndustryCsv(csv, { industryType: 'AUTO_COLLISION' })).toThrow(/dateFormat/);
    const ok = parseIndustryCsv(csv, { industryType: 'AUTO_COLLISION', dateFormat: 'DMY' });
    expect(ok.records[0]!.dateOfService).toBe('2026-09-25');
  });

  it('counts ambiguous dates read under the default', () => {
    const csv = autoCsv.replace('2026-09-01', '03/04/2026');
    const res = parseIndustryCsv(csv, { industryType: 'AUTO_COLLISION' });
    expect(res.dateAssumedRowCount).toBe(1);
    expect(res.records[0]!.dateOfService).toBe('2026-03-04');
  });

  it('maps French dental headers', () => {
    const csv = 'No de dossier,Assureur,No de réclamation,Nom du patient,Date de service,Solde\nD-1,Sun Life,C-1,Marie Tremblay,2026-07-01,"1 234,50 $"';
    const res = parseIndustryCsv(csv, { industryType: 'DENTAL' });
    expect(res.records[0]!.balanceDue).toBe('1234.50');
  });
});

describe('toClaimPersistFields PHI guard', () => {
  const res = parseIndustryCsv(
    'RO #,VIN,Insurance Company,Claim #,Customer Name,Date of Loss,Insurance Balance\nRO-1,1HGCM82633A004352,Intact,CL-1,Jane,2026-09-01,$10.00',
    { industryType: 'AUTO_COLLISION' },
  );
  it('tokenizes VIN and stores RO number as exported', () => {
    const f = toClaimPersistFields(res.records[0]!, () => UUID);
    expect(f.primaryReferenceId).toBe('RO-1');
    expect(f.secondaryReferenceId).toBe(UUID);
  });
  it('refuses a tokenizer that returns the raw value', () => {
    expect(() => toClaimPersistFields(res.records[0]!, (_k, raw) => raw)).toThrow(/vault token/);
  });
});
