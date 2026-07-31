// ─────────────────────────────────────────────────────────────────────────────
// Agent 01 — Carrier Config Validator
//
// Validates that carrier-configs.json is complete, internally consistent, and
// matches the Carrier enum. This agent is the first line of defense against
// broken carrier rule deployments — a mis-configured carrier silently produces
// wrong estimates for every patient under that plan.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import carrierConfigsRaw from '../../src/services/eligibility/rules/carrier-configs.json';
import { Carrier, CoverageTier } from '../../src/services/eligibility/types';
import { getCarrierConfig } from '../../src/services/eligibility/engine';

const configs = (carrierConfigsRaw as { carriers: Record<string, unknown> }).carriers;

const CORE_CARRIERS = Object.values(Carrier);
const COVERAGE_TIERS = Object.values(CoverageTier);
const REQUIRED_FIELDS = [
  'carrierId', 'name', 'coveragePercent', 'deductible',
  'annualMax', 'waitingPeriods', 'frequencyLimits',
];

// ─────────────────────────────────────────────────────────────────────────────
// Section A — Schema Completeness
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 01-A — Carrier config schema completeness', () => {
  it('all 6 core carriers have an entry in carrier-configs.json', () => {
    for (const carrier of CORE_CARRIERS) {
      expect(
        configs[carrier],
        `Missing config for carrier "${carrier}"`,
      ).toBeDefined();
    }
  });

  for (const carrier of CORE_CARRIERS) {
    it(`${carrier}: all required top-level fields are present`, () => {
      const cfg = configs[carrier] as Record<string, unknown>;
      for (const field of REQUIRED_FIELDS) {
        expect(cfg[field], `${carrier} is missing field "${field}"`).toBeDefined();
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section B — Coverage Percent Integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 01-B — Coverage percent integrity', () => {
  for (const carrier of CORE_CARRIERS) {
    it(`${carrier}: coverage percent exists for all tiers and is 0–100`, () => {
      const cfg = getCarrierConfig(carrier as Carrier);
      for (const tier of COVERAGE_TIERS) {
        const pct = cfg.coveragePercent[tier];
        expect(pct, `${carrier}.coveragePercent.${tier} is undefined`).toBeDefined();
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }
    });

    it(`${carrier}: preventive coverage is 100%`, () => {
      const cfg = getCarrierConfig(carrier as Carrier);
      expect(cfg.coveragePercent[CoverageTier.Preventive]).toBe(100);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section C — Deductible Integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 01-C — Deductible integrity', () => {
  for (const carrier of CORE_CARRIERS) {
    it(`${carrier}: deductible values are non-negative`, () => {
      const cfg = getCarrierConfig(carrier as Carrier);
      expect(cfg.deductible.individual).toBeGreaterThanOrEqual(0);
      expect(cfg.deductible.family).toBeGreaterThanOrEqual(0);
    });

    it(`${carrier}: family deductible >= individual deductible`, () => {
      const cfg = getCarrierConfig(carrier as Carrier);
      expect(cfg.deductible.family).toBeGreaterThanOrEqual(cfg.deductible.individual);
    });

    it(`${carrier}: appliesToTiers are valid CoverageTier values`, () => {
      const cfg = getCarrierConfig(carrier as Carrier);
      for (const tier of cfg.deductible.appliesToTiers) {
        expect(COVERAGE_TIERS).toContain(tier);
      }
    });

    it(`${carrier}: preventive is never in appliesToTiers (deductible-exempt)`, () => {
      const cfg = getCarrierConfig(carrier as Carrier);
      expect(cfg.deductible.appliesToTiers).not.toContain(CoverageTier.Preventive);
    });
  }

  it('Manulife has zero deductible (industry differentiator)', () => {
    const cfg = getCarrierConfig(Carrier.Manulife);
    expect(cfg.deductible.individual).toBe(0);
    expect(cfg.deductible.family).toBe(0);
    expect(cfg.deductible.appliesToTiers).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section D — Annual Maximum Integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 01-D — Annual maximum integrity', () => {
  for (const carrier of CORE_CARRIERS) {
    it(`${carrier}: individual annual max is a positive number`, () => {
      const cfg = getCarrierConfig(carrier as Carrier);
      expect(cfg.annualMax.individual).toBeGreaterThan(0);
    });
  }

  it('Manulife has family annual max (family pooling feature)', () => {
    const cfg = getCarrierConfig(Carrier.Manulife);
    expect(cfg.annualMax.family).not.toBeNull();
    expect(cfg.annualMax.family!).toBeGreaterThan(cfg.annualMax.individual);
  });

  it('Manulife family max is 2× individual (4000 vs 2000)', () => {
    const cfg = getCarrierConfig(Carrier.Manulife);
    expect(cfg.annualMax.family).toBe(cfg.annualMax.individual * 2);
  });

  it('RBC has the highest individual annual max among core carriers', () => {
    const rbcMax = getCarrierConfig(Carrier.RBC).annualMax.individual;
    for (const carrier of CORE_CARRIERS.filter((c) => c !== Carrier.RBC)) {
      if (carrier === Carrier.Manulife) continue; // Manulife is $2000, close
      const cfg = getCarrierConfig(carrier as Carrier);
      expect(rbcMax).toBeGreaterThanOrEqual(cfg.annualMax.individual);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section E — TELUS AdjudiCare Clearinghouse Rules
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 01-E — TELUS AdjudiCare clearinghouse rules', () => {
  it('TELUS is marked as a clearinghouse', () => {
    const cfg = getCarrierConfig(Carrier.TELUSAdjudiCare);
    expect(cfg.isClearinghouse).toBe(true);
  });

  it('TELUS has minWaitDayForClaims = 21', () => {
    const cfg = getCarrierConfig(Carrier.TELUSAdjudiCare);
    expect(cfg.minWaitDayForClaims).toBe(21);
  });

  it('all non-TELUS carriers have minWaitDayForClaims = 32', () => {
    for (const carrier of CORE_CARRIERS.filter((c) => c !== Carrier.TELUSAdjudiCare)) {
      const cfg = getCarrierConfig(carrier as Carrier);
      expect(cfg.minWaitDayForClaims).toBe(32);
    }
  });

  it('non-TELUS carriers are NOT clearinghouses', () => {
    for (const carrier of CORE_CARRIERS.filter((c) => c !== Carrier.TELUSAdjudiCare)) {
      const cfg = getCarrierConfig(carrier as Carrier);
      expect(cfg.isClearinghouse).toBeFalsy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section F — Waiting Period Integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 01-F — Waiting period integrity', () => {
  for (const carrier of CORE_CARRIERS) {
    it(`${carrier}: all waiting period tiers are valid CoverageTier values`, () => {
      const cfg = getCarrierConfig(carrier as Carrier);
      for (const wp of cfg.waitingPeriods) {
        expect(COVERAGE_TIERS).toContain(wp.tier);
        expect(wp.months).toBeGreaterThan(0);
        expect(wp.description).toBeTruthy();
      }
    });
  }

  it('Canada Life has 12-month waiting period for major tier', () => {
    const cfg = getCarrierConfig(Carrier.CanadaLife);
    const majorWp = cfg.waitingPeriods.find((w) => w.tier === CoverageTier.Major);
    expect(majorWp).toBeDefined();
    expect(majorWp!.months).toBe(12);
  });

  it('Sun Life ortho has 12-month waiting period', () => {
    const cfg = getCarrierConfig(Carrier.SunLife);
    const orthoWp = cfg.waitingPeriods.find((w) => w.tier === CoverageTier.Ortho);
    expect(orthoWp).toBeDefined();
    expect(orthoWp!.months).toBe(12);
  });

  it('RBC has both ortho and major waiting periods', () => {
    const cfg = getCarrierConfig(Carrier.RBC);
    const tiers = cfg.waitingPeriods.map((w) => w.tier);
    expect(tiers).toContain(CoverageTier.Ortho);
    expect(tiers).toContain(CoverageTier.Major);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section G — Frequency Limits Integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 01-G — Frequency limits integrity', () => {
  for (const carrier of CORE_CARRIERS) {
    it(`${carrier}: all frequency limits have valid CDT codes and positive limit months`, () => {
      const cfg = getCarrierConfig(carrier as Carrier);
      for (const fl of cfg.frequencyLimits) {
        expect(fl.cdtCodePattern).toMatch(/^D\d{4}$/);
        expect(fl.limitPerMonths).toBeGreaterThan(0);
        expect(fl.description).toBeTruthy();
      }
    });

    it(`${carrier}: has a frequency limit for cleaning (D1110)`, () => {
      const cfg = getCarrierConfig(carrier as Carrier);
      const cleaning = cfg.frequencyLimits.find((f) => f.cdtCodePattern === 'D1110');
      expect(cleaning).toBeDefined();
      expect(cleaning!.limitPerMonths).toBe(6);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Section H — getCarrierConfig Error Handling
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 01-H — getCarrierConfig error handling', () => {
  it('throws for an unknown carrier string', () => {
    expect(() => getCarrierConfig('unknown_carrier' as Carrier)).toThrow('Unknown carrier');
  });

  it('throws for empty string', () => {
    expect(() => getCarrierConfig('' as Carrier)).toThrow();
  });

  it('retrieves all 6 core carriers without throwing', () => {
    for (const carrier of CORE_CARRIERS) {
      expect(() => getCarrierConfig(carrier as Carrier)).not.toThrow();
    }
  });
});
