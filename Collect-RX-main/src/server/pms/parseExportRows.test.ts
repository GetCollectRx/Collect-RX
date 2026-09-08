import { describe, expect, it } from 'vitest';
import { normalizePmsClaimRow } from './parseExportRows';

describe('normalizePmsClaimRow — denialReasonCode column mapping', () => {
  it('reads the "denial_reason" column used by the app\'s own shipped public/sample-claims.csv template', () => {
    // Regression: public/sample-claims.csv (the file the CSV import wizard offers
    // via "Download sample template") uses the header `denial_reason`, but the
    // getCell alias list here only recognized 'Denial Reason' (with a space) and
    // 'denial_reason_code' (with a _code suffix) — neither matches the literal
    // key 'denial_reason' that a parsed CSV row actually has. Denial data
    // imported through the app's own documented example silently never reached
    // denialReasonCode, so the importer's isT11 check never fired and the row
    // never created a DENIAL_REVIEW recovery action or evidence checklist items
    // — the claim just never appeared in the Denials & docs tab.
    const row = normalizePmsClaimRow(
      {
        id: 'CLM-003',
        denial_reason: 'Frequency limitation - 1 surface paid only',
      },
      'generic',
    );
    expect(row.denialReasonCode).toBe('Frequency limitation - 1 surface paid only');
  });

  it('still reads the other historically-supported denial column names', () => {
    expect(
      normalizePmsClaimRow({ id: 'A', 'Denial Code': 'FREQ01' }, 'generic').denialReasonCode,
    ).toBe('FREQ01');
    expect(
      normalizePmsClaimRow({ id: 'B', 'Denial Reason': 'COB dispute' }, 'generic').denialReasonCode,
    ).toBe('COB dispute');
    expect(
      normalizePmsClaimRow({ id: 'C', denial_reason_code: 'DOC12' }, 'generic').denialReasonCode,
    ).toBe('DOC12');
  });
});

describe('normalizePmsClaimRow — treatingDentistProviderNumber column mapping', () => {
  it('reads the provider number when the export includes one', () => {
    expect(
      normalizePmsClaimRow(
        { id: 'CLM-010', 'CDA Provider Number': '123456789' },
        'generic',
      ).treatingDentistProviderNumber,
    ).toBe('123456789');
  });

  it('is null when the export has no dentist column — most practices predate this field', () => {
    expect(normalizePmsClaimRow({ id: 'CLM-011' }, 'generic').treatingDentistProviderNumber).toBeNull();
  });
});

describe('normalizePmsClaimRow — non-numeric amount cells', () => {
  it('throws (does not silently become a $0 balance) when amount_billed/amount_outstanding are garbage text', () => {
    // Regression: parseMoney's NaN-fallback-to-0 meant a row with a corrupted
    // or shifted export column (e.g. amount_outstanding="xyz") normalized to
    // outstandingAmount: 0 with no error at all, and the importer's
    // upsertInsuranceClaim treats outstandingAmount <= 0 as "already paid
    // off" and silently skips it — the row vanished into the "skipped" count
    // indistinguishable from a real zero-balance claim, with no signal to
    // the importing practice that their data was malformed. Reproduced live
    // via the /import wizard with a CSV row carrying amount_billed="abc",
    // amount_outstanding="xyz".
    expect(() =>
      normalizePmsClaimRow(
        { id: 'EDGE-005', carrier_name: 'Sun Life Financial', amount_billed: 'abc', amount_outstanding: 'xyz' },
        'generic',
      ),
    ).toThrow('Amount Outstanding "xyz" is not a valid number');
  });

  it('still defaults to 0 when the amount cell is simply absent (not present-but-invalid)', () => {
    const row = normalizePmsClaimRow(
      { id: 'CLM-100', carrier_name: 'Sun Life Financial' },
      'generic',
    );
    expect(row.outstandingAmount).toBe(0);
    expect(row.billedAmount).toBe(0);
  });

  it('still parses valid formatted money (with $ and commas)', () => {
    const row = normalizePmsClaimRow(
      {
        id: 'CLM-101',
        carrier_name: 'Sun Life Financial',
        amount_billed: '$1,250.50',
        amount_outstanding: '$900.00',
      },
      'generic',
    );
    expect(row.billedAmount).toBe(1250.5);
    expect(row.outstandingAmount).toBe(900);
  });
});
