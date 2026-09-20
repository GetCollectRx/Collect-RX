import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP,
  mergeMap,
  buildClaimsQuery,
} from '../../desktop/services/abeldentQueryTemplates.cjs';

describe('mergeMap', () => {
  it('returns a deep clone of DEFAULT_MAP when given no overrides', () => {
    const merged = mergeMap(undefined);
    expect(merged).toEqual(DEFAULT_MAP);
    expect(merged).not.toBe(DEFAULT_MAP);
    expect(merged.claims).not.toBe(DEFAULT_MAP.claims);
  });

  it('ignores non-object overrides', () => {
    expect(mergeMap(null)).toEqual(DEFAULT_MAP);
    expect(mergeMap('not-an-object')).toEqual(DEFAULT_MAP);
    expect(mergeMap(42)).toEqual(DEFAULT_MAP);
  });

  it('overrides top-level claims fields (table, alias) while keeping unspecified defaults', () => {
    const merged = mergeMap({ claims: { table: 'InsClaims', alias: 'x' } });
    expect(merged.claims.table).toBe('InsClaims');
    expect(merged.claims.alias).toBe('x');
    expect(merged.claims.patientTable).toBe(DEFAULT_MAP.claims.patientTable);
  });

  it('merges column overrides without dropping unspecified columns', () => {
    const merged = mergeMap({ claims: { columns: { claimId: 'ClaimNumber' } } });
    expect(merged.claims.columns.claimId).toBe('ClaimNumber');
    expect(merged.claims.columns.patientFirstName).toBe(
      DEFAULT_MAP.claims.columns.patientFirstName,
    );
  });

  it('merges joinOn overrides without dropping unspecified keys', () => {
    const merged = mergeMap({ claims: { joinOn: { claims: 'PatID' } } });
    expect(merged.claims.joinOn.claims).toBe('PatID');
    expect(merged.claims.joinOn.patient).toBe(DEFAULT_MAP.claims.joinOn.patient);
  });

  it('does not mutate DEFAULT_MAP when overrides are applied', () => {
    mergeMap({ claims: { table: 'Mutated', columns: { claimId: 'Mutated' } } });
    expect(DEFAULT_MAP.claims.table).toBe('Insurance_Claims');
    expect(DEFAULT_MAP.claims.columns.claimId).toBe('ClaimID');
  });
});

describe('buildClaimsQuery', () => {
  it('builds a query referencing the default table/alias/columns', () => {
    const sql = buildClaimsQuery(DEFAULT_MAP);
    expect(sql).toContain('FROM Insurance_Claims ic');
    expect(sql).toContain('JOIN Patients p ON p.PatientID = ic.PatientID');
    expect(sql).toContain('ic.ClaimID');
    expect(sql).toContain('p.FirstName AS patient_first_name');
    expect(sql).toContain('@minDays');
  });

  it('reflects overridden identifiers from a custom map', () => {
    const merged = mergeMap({
      claims: {
        table: 'InsClaims',
        alias: 'q',
        patientTable: 'Pts',
        patientAlias: 'r',
        joinOn: { claims: 'PatID', patient: 'PatID' },
        columns: { claimId: 'ClaimNumber' },
      },
    });
    const sql = buildClaimsQuery(merged);
    expect(sql).toContain('FROM InsClaims q');
    expect(sql).toContain('JOIN Pts r ON r.PatID = q.PatID');
    expect(sql).toContain('CAST(q.ClaimNumber AS VARCHAR(20)) AS id');
  });

  it('rejects identifiers with SQL-unsafe characters', () => {
    const merged = mergeMap({ claims: { table: 'Insurance_Claims; DROP TABLE x' } });
    expect(() => buildClaimsQuery(merged)).toThrow(/Invalid SQL identifier/);
  });

  it('rejects unsafe column overrides', () => {
    const merged = mergeMap({ claims: { columns: { claimId: "ClaimID' --" } } });
    expect(() => buildClaimsQuery(merged)).toThrow(/Invalid SQL identifier/);
  });
});
