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
