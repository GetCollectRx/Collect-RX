import { describe, expect, it } from 'vitest';
import {
  getPmsImportFamily,
  listPmsVendorCatalog,
  normalizePmsVendorId,
  PHONE_DECISION_PROFILE,
} from '../src/server/pms/pmsRegistry.js';
import { normalizePmsClaimRow } from '../src/server/pms/parseExportRows.js';

describe('pmsRegistry', () => {
  it('normalizes vendor aliases', () => {
    expect(normalizePmsVendorId('AbelDent')).toBe('abeldent');
    expect(normalizePmsVendorId('open dental')).toBe('open_dental');
    expect(normalizePmsVendorId('csv')).toBe('other');
    expect(normalizePmsVendorId('unknown_pms')).toBeNull();
  });

  it('maps vendors to import families', () => {
    expect(getPmsImportFamily('abeldent')).toBe('abeldent');
    expect(getPmsImportFamily('dentrix')).toBe('dentrix');
    expect(getPmsImportFamily('open_dental')).toBe('generic');
    expect(getPmsImportFamily('curve')).toBe('generic');
  });

  it('exposes a single phone decision profile for all vendors', () => {
    const catalog = listPmsVendorCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(5);
    expect(PHONE_DECISION_PROFILE).toBe('carrier_recovery_v1');
  });
});

describe('normalizePmsClaimRow', () => {
  it('parses generic export column names', () => {
    const row = normalizePmsClaimRow(
      {
        'Claim #': 'C-100',
        'Patient First Name': 'Jane',
        'Patient Last Name': 'Doe',
        'Primary Insurance': 'Sun Life',
        'Ins Balance': '$120.00',
        DOS: '2025-01-15',
      },
      'generic',
    );
    expect(row.claimNumber).toBe('C-100');
    expect(row.outstandingAmount).toBe(120);
    expect(row.carrierName).toBe('Sun Life');
  });
});
