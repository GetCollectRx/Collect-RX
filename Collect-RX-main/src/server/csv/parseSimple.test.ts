import { describe, expect, it } from 'vitest';
import { CSV_LIMITS } from './csvValidator';
import { parseSimpleCsv } from './parseSimple';

describe('parseSimpleCsv quoted fields', () => {
  it('keeps a quoted field with an embedded LF newline in one record', () => {
    const rows = parseSimpleCsv('claim_number,notes,patient_owes\nC1,"line one\nline two",10\nC2,plain,20');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.notes).toBe('line one\nline two');
    expect(rows[0]?.patient_owes).toBe('10');
    expect(rows[1]?.claim_number).toBe('C2');
  });

  it('keeps a quoted field with an embedded CRLF newline in one record', () => {
    const rows = parseSimpleCsv('claim_number,notes,patient_owes\r\nC1,"a\r\nb",10\r\nC2,x,20\r\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.notes).toBe('a\r\nb');
    expect(rows[1]?.patient_owes).toBe('20');
  });

  it('reads commas and doubled quotes inside quotes', () => {
    const rows = parseSimpleCsv('claim_number,notes\nC1,"Smith, ""Bob"" Jr"');
    expect(rows[0]?.notes).toBe('Smith, "Bob" Jr');
  });

  it('still applies formula-injection prefixing to a value that starts with a quote-wrapped formula', () => {
    const rows = parseSimpleCsv('claim_number,notes\nC1,"=1+1"');
    expect(rows[0]?.notes).toBe("'=1+1");
  });

  it('skips blank and whitespace-only lines but keeps an all-empty quoted record', () => {
    const rows = parseSimpleCsv('claim_number,notes\n\nC1,a\n   \nC2,b\n');
    expect(rows.map((r) => r.claim_number)).toEqual(['C1', 'C2']);
  });

  it('returns no rows for a header-only file', () => {
    expect(parseSimpleCsv('claim_number,notes\n')).toEqual([]);
  });

  it('fills missing trailing cells with empty strings', () => {
    const rows = parseSimpleCsv('claim_number,notes,patient_owes\nC1,a');
    expect(rows[0]?.patient_owes).toBe('');
  });

  it('throws on an unterminated quote without echoing cell content', () => {
    let message = '';
    try {
      parseSimpleCsv('claim_number,notes\nC1,"secret-looking value\nC2,b');
    } catch (err: unknown) {
      message = err instanceof Error ? err.message : '';
    }
    expect(message).toBe('CSV has an unterminated quoted field');
  });

  it('counts a record with an embedded newline as one row toward the row limit', () => {
    const body = Array.from({ length: CSV_LIMITS.MAX_ROWS }, () => 'C,"a\nb"').join('\n');
    expect(() => parseSimpleCsv(`claim_number,notes\n${body}`)).not.toThrow();
    expect(() => parseSimpleCsv(`claim_number,notes\n${body}\nC,x`)).toThrow(/rows limit/);
  });
});
