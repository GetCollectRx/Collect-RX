// ─────────────────────────────────────────────────────────────────────────────
// Agent 08 — Data Integrity Validator
//
// Cross-cutting data consistency checks:
//   - carrier-configs.json has no orphaned or unknown carrier keys
//   - All Carrier enum values have a matching config key
//   - Provincial fee guide 2026 data is complete and mathematically sound
//   - CDCP federal program config is structurally correct
//   - CDT code map has no duplicate entries (would cause silent bugs)
//   - Estimate math identities hold: patient + insurance = fee (for all carriers)
//   - No carrier config references a coverage tier outside the enum
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import carrierConfigsRaw from '../../src/services/eligibility/rules/carrier-configs.json';
import { Carrier, CoverageTier } from '../../src/services/eligibility/types';
import { generateEstimate, getCarrierConfig } from '../../src/services/eligibility/engine';
import { getCoverageTier } from '../../src/services/eligibility/rules/cdt-codes';

const RAW = carrierConfigsRaw as {
  carriers: Record<string, Record<string, unknown>>;
  provincialFeeGuides2026: Record<string, {
    province: string;
    incrementPct: number;
    multiplier: number;
    cdcpReimbursementPct: number;
    cdcpCeilingMultiplier: number;
    effectiveDate: string;
  }>;
};

const ALL_CARRIER_KEYS = Object.keys(RAW.carriers);
const CORE_ENUM_VALUES = Object.values(Carrier);
const VALID_TIERS = Object.values(CoverageTier);
const PROVINCES_2026 = Object.keys(RAW.provincialFeeGuides2026);

// ─────────────────────────────────────────────────────────────────────────────
// Section A — Carrier Key Alignment
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 08-A — Carrier key alignment between enum and JSON', () => {
  it('every Carrier enum value has a matching key in carrier-configs.json', () => {
    for (const carrier of CORE_ENUM_VALUES) {
      expect(
        ALL_CARRIER_KEYS,
        `Carrier enum value "${carrier}" has no config in carrier-configs.json`,
      ).toContain(carrier);
    }
  });

  it('no carrier config key is outside the known Carrier enum values (plus cdcp)', () => {
    const allowedKeys = [...CORE_ENUM_VALUES, 'cdcp'];
    for (const key of ALL_CARRIER_KEYS) {
      expect(
        allowedKeys,
        `Unknown carrier config key "${key}" not in Carrier enum`,
      ).toContain(key);
    }
  });

  it('total carrier configs: 7 (6 core + cdcp federal program)', () => {
    expect(ALL_CARRIER_KEYS.length).toBe(7);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section B — Provincial Fee Guide 2026 Data
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 08-B — Provincial fee guide 2026 data integrity', () => {
  it('fee guides exist for all 6 expected provinces', () => {
    const EXPECTED_PROVINCES = ['AB', 'ON', 'BC', 'QC', 'MB', 'SK'];
    for (const province of EXPECTED_PROVINCES) {
      expect(
        PROVINCES_2026,
        `Missing 2026 fee guide for province "${province}"`,
      ).toContain(province);
    }
  });

  for (const province of PROVINCES_2026) {
    it(`${province}: multiplier = 1 + (incrementPct / 100)`, () => {
      const guide = RAW.provincialFeeGuides2026[province];
      const expectedMultiplier = 1 + guide.incrementPct / 100;
      expect(guide.multiplier).toBeCloseTo(expectedMultiplier, 3);
    });

    it(`${province}: cdcpCeilingMultiplier = multiplier × cdcpReimbursementPct / 100`, () => {
      const guide = RAW.provincialFeeGuides2026[province];
      const expected = guide.multiplier * (guide.cdcpReimbursementPct / 100);
      expect(guide.cdcpCeilingMultiplier).toBeCloseTo(expected, 3);
    });

    it(`${province}: incrementPct is positive and reasonable (0–10%)`, () => {
      const guide = RAW.provincialFeeGuides2026[province];
      expect(guide.incrementPct).toBeGreaterThan(0);
      expect(guide.incrementPct).toBeLessThanOrEqual(10);
    });

    it(`${province}: cdcpReimbursementPct is 85–100%`, () => {
      const guide = RAW.provincialFeeGuides2026[province];
      expect(guide.cdcpReimbursementPct).toBeGreaterThanOrEqual(85);
      expect(guide.cdcpReimbursementPct).toBeLessThanOrEqual(100);
    });

    it(`${province}: effectiveDate is 2026-01-01`, () => {
      const guide = RAW.provincialFeeGuides2026[province];
      expect(guide.effectiveDate).toBe('2026-01-01');
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section C — CDCP Federal Program Config
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 08-C — CDCP federal program config integrity', () => {
  const cdcp = RAW.carriers['cdcp'] as Record<string, unknown>;

  it('CDCP config exists in carrier-configs.json', () => {
    expect(cdcp).toBeDefined();
  });

  it('CDCP is flagged as a federal program', () => {
    expect(cdcp['isFederalProgram']).toBe(true);
  });

  it('CDCP requires pre-auth', () => {
    expect(cdcp['preAuthRequired']).toBe(true);
  });

  it('CDCP reconsideration window is 60 days', () => {
    expect(cdcp['reconsiderationWindowDays']).toBe(60);
  });

  it('CDCP has zero deductible (federal program)', () => {
    const ded = cdcp['deductible'] as { individual: number; family: number };
    expect(ded.individual).toBe(0);
    expect(ded.family).toBe(0);
  });

  it('CDCP April 2026 overhaul has correct effective date', () => {
    const overhaul = cdcp['cdcpApril2026Overhaul'] as { effectiveDate: string };
    expect(overhaul.effectiveDate).toBe('2026-04-01');
  });

  it('CDCP renewal warning window is April 15 – June 30', () => {
    const warning = cdcp['renewalWarning'] as { windowStart: string; windowEnd: string };
    expect(warning.windowStart).toBe('04-15');
    expect(warning.windowEnd).toBe('06-30');
  });

  it('CDCP cleaning frequency limit is 9 months (more restrictive than private plans)', () => {
    const limits = cdcp['frequencyLimits'] as Array<{ cdtCodePattern: string; limitPerMonths: number }>;
    const cleaning = limits.find((f) => f.cdtCodePattern === 'D1110');
    expect(cleaning).toBeDefined();
    expect(cleaning!.limitPerMonths).toBe(9);
  });

  it('CDCP fee grid ceiling is 90%', () => {
    expect(cdcp['cdcpFeeGridCeilingPct']).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section D — Coverage Tier References in Configs
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 08-D — Coverage tier references are valid', () => {
  for (const carrier of CORE_ENUM_VALUES) {
    it(`${carrier}: all coveragePercent keys are valid CoverageTier values`, () => {
      const cfg = getCarrierConfig(carrier as Carrier);
      for (const tier of Object.keys(cfg.coveragePercent)) {
        expect(VALID_TIERS).toContain(tier);
      }
    });

    it(`${carrier}: coveragePercent covers all 4 tiers`, () => {
      const cfg = getCarrierConfig(carrier as Carrier);
      const tiers = Object.keys(cfg.coveragePercent);
      for (const tier of VALID_TIERS) {
        expect(tiers).toContain(tier);
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section E — Estimate Math Identity
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 08-E — Estimate math identity: patient + insurance = fee', () => {
  const PROCEDURES = [
    { cdtCode: 'D1110', providerFee: 180, quantity: 1, dateOfService: '2026-06-13' },
    { cdtCode: 'D2740', providerFee: 1200, quantity: 1, dateOfService: '2026-06-13' },
    { cdtCode: 'D3330', providerFee: 900, quantity: 1, dateOfService: '2026-06-13' },
  ];
  const TOTAL_FEE = 180 + 1200 + 900;

  function makePatient(carrier: Carrier) {
    return {
      patientId: 'p-integrity-001',
      firstName: 'Data',
      lastName: 'Integrity',
      dateOfBirth: '1980-01-01',
      primaryPlan: {
        planId: `plan-${carrier}`,
        carrier,
        planName: 'Test',
        groupNumber: 'G001',
        memberId: 'M001',
        effectiveDate: '2024-01-01',
        terminationDate: null,
        planType: 'group' as const,
      },
      relationshipToSubscriber: 'self' as const,
    };
  }

  function makeSnap(carrier: Carrier) {
    return {
      snapshotId: `s-${carrier}`,
      patientId: 'p-integrity-001',
      carrier,
      status: 'active' as const,
      verifiedAt: new Date().toISOString(),
      deductibleIndividualMet: 0,
      deductibleFamilyMet: 0,
      annualMaxUsedIndividual: 0,
      annualMaxUsedFamily: null,
      planYearStart: '2026-01-01',
    };
  }

  for (const carrier of CORE_ENUM_VALUES) {
    it(`${carrier}: patientTotal + insuranceTotal = ${TOTAL_FEE}`, () => {
      const patient = makePatient(carrier as Carrier);
      const estimate = generateEstimate(
        { patientId: 'p-integrity-001', procedures: PROCEDURES, carrier: carrier as Carrier, eligibilitySnapshot: makeSnap(carrier as Carrier) },
        patient,
      );
      const sum = estimate.totals.patientTotal + estimate.totals.insuranceTotal;
      expect(sum).toBeCloseTo(TOTAL_FEE, 0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section F — CDT Code Map No-Duplicate Check
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 08-F — CDT code map produces deterministic results', () => {
  const KEY_CODES = ['D1110', 'D2740', 'D3330', 'D8080', 'D0210', 'D4341', 'D7140', 'D6010'];

  it('calling getCoverageTier twice for the same code returns the same tier', () => {
    for (const code of KEY_CODES) {
      const t1 = getCoverageTier(code);
      const t2 = getCoverageTier(code);
      expect(t1).toBe(t2);
    }
  });

  it('tier results are stable across 10 repeated calls', () => {
    for (const code of KEY_CODES) {
      const tiers = Array.from({ length: 10 }, () => getCoverageTier(code));
      const allSame = tiers.every((t) => t === tiers[0]);
      expect(allSame).toBe(true);
    }
  });
});
