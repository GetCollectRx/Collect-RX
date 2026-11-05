import { describe, expect, it } from 'vitest';
import {
  buildClaimResultsCsv,
  CLAIM_RESULTS_CSV_HEADER,
  csvCell,
  type ClaimResultRow,
} from '../../src/server/export/claimResultsCsv.js';

const row: ClaimResultRow = {
  claimNumber: 'CLM-1',
  carrierId: 'sunlife',
  claimStatus: 'RESOLVED',
  callCompletedAt: new Date('2026-11-02T15:00:00.000Z'),
  callOutcome: 'RESOLVED',
  resultSource: 'HUMAN_LOG',
  resultConfidence: 'HIGH',
  referenceNumber: 'REF-9',
  repName: 'Sam',
  durationSeconds: 120,
};

describe('csvCell', () => {
  it('neutralises spreadsheet formula prefixes', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });

  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
  });

  it('renders null as empty and numbers as plain text', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(-5)).toBe('-5');
  });
});

describe('buildClaimResultsCsv', () => {
  it('emits the header and one row per claim', () => {
    const lines = buildClaimResultsCsv([row]).split('\n');
    expect(lines[0]).toBe(CLAIM_RESULTS_CSV_HEADER.join(','));
    expect(lines[1]).toBe('CLM-1,sunlife,RESOLVED,2026-11-02T15:00:00.000Z,RESOLVED,HUMAN_LOG,HIGH,REF-9,Sam,120');
  });

  it('keeps empty cells for claims with no completed call fields', () => {
    const csv = buildClaimResultsCsv([
      { ...row, callCompletedAt: null, callOutcome: null, resultSource: null, resultConfidence: null, referenceNumber: null, repName: null, durationSeconds: null },
    ]);
    expect(csv.split('\n')[1]).toBe('CLM-1,sunlife,RESOLVED,,,,,,,');
  });

  it('protects a hostile rep name', () => {
    const csv = buildClaimResultsCsv([{ ...row, repName: '=HYPERLINK("http://x")' }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});
