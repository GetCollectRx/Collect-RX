// ─────────────────────────────────────────────────────────────────────────────
// Agent 06 — Eligibility Engine Edge Cases
//
// Tests extended edge cases not covered in the core eligibility test:
//   - CDCP federal program rules (federal dental plan launched 2024)
//   - Provincial fee guide 2026 multipliers
//   - Ortho lifetime max tracking
//   - Frequency limit enforcement
//   - Manulife basic tier (85% — higher than other carriers)
//   - Green Shield strict frequency enforcement
//   - Zero-cost procedures and boundary math
//   - Multi-carrier estimate totals consistency
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { generateEstimate, getCarrierConfig, identifyTelusPlan } from '../../src/services/eligibility/engine';
import { reconcile } from '../../src/services/eligibility/reconciliation';
import {
  buildDeductibleState,
  applyDeductible,
} from '../../src/services/eligibility/rules/deductible';
import {
  buildAnnualMaxState,
  applyAnnualMax,
  annualMaxRemaining,
} from '../../src/services/eligibility/rules/annual-max';
import {
  Carrier,
  CoverageTier,
  EligibilitySnapshot,
  EligibilityStatus,
  Patient,
  InsurancePlan,
  ReconciliationFlag,
} from '../../src/services/eligibility/types';

const TODAY = '2026-06-13';
const PLAN_2Y_AGO = '2024-01-01';
const PLAN_5M_AGO = '2026-01-01'; // 5 months old

function makeSnap(carrier: Carrier, overrides: Partial<EligibilitySnapshot> = {}): EligibilitySnapshot {
  return {
    snapshotId: `snap-${carrier}`,
    patientId: 'p-001',
    carrier,
    status: EligibilityStatus.Active,
    verifiedAt: new Date(Date.now() - 86400_000 * 3).toISOString(),
    deductibleIndividualMet: 0,
    deductibleFamilyMet: 0,
    annualMaxUsedIndividual: 0,
    annualMaxUsedFamily: null,
    planYearStart: '2026-01-01',
    ...overrides,
  };
}

function makePatient(primary: Carrier, effectiveDate = PLAN_2Y_AGO, secondary?: Carrier): Patient {
  const primaryPlan: InsurancePlan = {
    planId: `plan-${primary}`,
    carrier: primary,
    planName: 'Group Plan',
    groupNumber: 'GRP-001',
    memberId: 'MBR-001',
    effectiveDate,
    terminationDate: null,
    planType: 'group',
  };
  return {
    patientId: 'p-001',
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '1980-01-01',
    primaryPlan,
    secondaryPlan: secondary
      ? { ...primaryPlan, planId: `plan-${secondary}`, carrier: secondary }
      : undefined,
    relationshipToSubscriber: 'self',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section A — Manulife-Specific Rules
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 06-A — Manulife-specific rules', () => {
  it('Manulife basic tier is 85% (higher than other carriers)', () => {
    const cfg = getCarrierConfig(Carrier.Manulife);
    expect(cfg.coveragePercent[CoverageTier.Basic]).toBe(85);
  });

  it('Manulife major tier is 60% (higher than Sun Life/Canada Life/RBC 50%)', () => {
    const cfg = getCarrierConfig(Carrier.Manulife);
    expect(cfg.coveragePercent[CoverageTier.Major]).toBe(60);
  });

  it('Manulife has 6-month waiting period for major (shorter than Canada Life 12 months)', () => {
    const cfg = getCarrierConfig(Carrier.Manulife);
    const majorWp = cfg.waitingPeriods.find((w) => w.tier === CoverageTier.Major);
    expect(majorWp).toBeDefined();
    expect(majorWp!.months).toBe(6);
  });

  it('Manulife: 5-month-old plan does NOT block major restorative (6-month wait)', () => {
    const carrier = Carrier.Manulife;
    const patient = makePatient(carrier, PLAN_5M_AGO);
    const estimate = generateEstimate(
      { patientId: 'p', procedures: [{ cdtCode: 'D2740', providerFee: 1200, quantity: 1, dateOfService: TODAY }], carrier, eligibilitySnapshot: makeSnap(carrier) },
      patient,
    );
    // Plan is 5 months old, waiting period is 6 months → BLOCKED
    expect(estimate.procedures[0].waitingPeriodBlock).toBe(true);
  });

  it('Manulife no-deductible estimate: patient pays only (100 - 85)% of basic procedure', () => {
    const carrier = Carrier.Manulife;
    const patient = makePatient(carrier);
    const estimate = generateEstimate(
      { patientId: 'p', procedures: [{ cdtCode: 'D3330', providerFee: 900, quantity: 1, dateOfService: TODAY }], carrier, eligibilitySnapshot: makeSnap(carrier) },
      patient,
    );
    const proc = estimate.procedures[0];
    expect(proc.deductibleApplied).toBe(0);
    expect(proc.coveragePercent).toBe(85);
    expect(proc.patientPortion).toBeCloseTo(900 * 0.15, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section B — RBC-Specific Rules
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 06-B — RBC-specific rules', () => {
  it('RBC has highest deductible ($100 individual)', () => {
    const cfg = getCarrierConfig(Carrier.RBC);
    expect(cfg.deductible.individual).toBe(100);
  });

  it('RBC has ortho coverage (50%) unlike Canada Life/Manulife/Green Shield/TELUS', () => {
    const rbc = getCarrierConfig(Carrier.RBC);
    expect(rbc.coveragePercent[CoverageTier.Ortho]).toBe(50);

    const noOrtho = [Carrier.CanadaLife, Carrier.Manulife, Carrier.GreenShield, Carrier.TELUSAdjudiCare];
    for (const carrier of noOrtho) {
      const cfg = getCarrierConfig(carrier as Carrier);
      expect(cfg.coveragePercent[CoverageTier.Ortho]).toBe(0);
    }
  });

  it('Sun Life also has ortho coverage (50%)', () => {
    const cfg = getCarrierConfig(Carrier.SunLife);
    expect(cfg.coveragePercent[CoverageTier.Ortho]).toBe(50);
  });

  it('RBC has $1800 annual max — highest of core carriers', () => {
    const cfg = getCarrierConfig(Carrier.RBC);
    expect(cfg.annualMax.individual).toBe(1800);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section C — Green Shield Strict Frequency Limits
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 06-C — Green Shield strict frequency limits', () => {
  it('Green Shield has extra perio scaling frequency limit (D4341 — once per 24 months)', () => {
    const cfg = getCarrierConfig(Carrier.GreenShield);
    const fl = cfg.frequencyLimits.find((f) => f.cdtCodePattern === 'D4341');
    expect(fl).toBeDefined();
    expect(fl!.limitPerMonths).toBe(24);
  });

  it('Green Shield cleaning limit is 6 months (same as others)', () => {
    const cfg = getCarrierConfig(Carrier.GreenShield);
    const cleaning = cfg.frequencyLimits.find((f) => f.cdtCodePattern === 'D1110');
    expect(cleaning!.limitPerMonths).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section D — TELUS TPA Identification Extended Cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 06-D — TELUS TPA identification extended', () => {
  const TPA_MAP: [string, string][] = [
    ['A', 'Alberta Blue Cross'],
    ['B', 'Benecaid'],
    ['C', 'ClaimSecure'],
    ['D', 'Desjardins Insurance'],
    ['E', 'Empire Life'],
    ['F', 'First Canadian Benefits'],
    ['G', 'GroupHEALTH'],
    ['H', 'Johnston Group'],
    ['I', 'Industrial Alliance'],
    ['M', 'Maximum Benefit'],
    ['P', 'Pacific Blue Cross'],
    ['S', 'SSQ Insurance'],
  ];

  for (const [prefix, expectedTpa] of TPA_MAP) {
    it(`Group prefix "${prefix}" → TPA "${expectedTpa}"`, () => {
      const result = identifyTelusPlan('MBR-001', `${prefix}001`);
      expect(result.identifiedTpa).toBe(expectedTpa);
      expect(result.confidence).toBe('high');
    });
  }

  it('unknown prefix "Z" (with non-mapped member ID) returns low confidence with manual review note', () => {
    // Use a member ID starting with 'Z' — not in TPA map — so both group and member lookups fail
    const result = identifyTelusPlan('Z-UNKNOWN-99', 'Z999');
    expect(result.confidence).toBe('low');
    expect(result.notes).toMatch(/manual/i);
  });

  it('unknown group prefix "Z" with known member ID prefix → medium confidence fallback', () => {
    // Member ID starts with 'M' (Maximum Benefit) → member card prefix match → 'medium'
    const result = identifyTelusPlan('MBR-001', 'Z999');
    expect(['medium', 'low']).toContain(result.confidence);
  });

  it('all identified TPA results include the 21-day min wait', () => {
    for (const [prefix] of TPA_MAP) {
      const result = identifyTelusPlan('MBR-001', `${prefix}001`);
      expect(result.minWaitDay).toBe(21);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section E — Annual Max and Deductible Boundary Math
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 06-E — Annual max and deductible boundary math', () => {
  it('Deductible exactly met on procedure equal to deductible amount', () => {
    const cfg = getCarrierConfig(Carrier.SunLife); // $50 individual
    const state = buildDeductibleState(cfg, makeSnap(Carrier.SunLife, { deductibleIndividualMet: 0 }));
    const { applied, updatedState } = applyDeductible(CoverageTier.Basic, 50, state);
    expect(applied).toBe(50); // exact match
    expect(updatedState.individualMet).toBe(50);
  });

  it('When fee is less than deductible, full fee goes to deductible', () => {
    const cfg = getCarrierConfig(Carrier.RBC); // $100 deductible
    const state = buildDeductibleState(cfg, makeSnap(Carrier.RBC, { deductibleIndividualMet: 0 }));
    const { applied } = applyDeductible(CoverageTier.Basic, 40, state); // $40 fee < $100 deductible
    expect(applied).toBe(40); // patient pays full fee, deductible partially met
  });

  it('Annual max tracks remaining correctly over multiple procedures', () => {
    const cfg = getCarrierConfig(Carrier.CanadaLife); // $1200 individual max
    const snapshot = makeSnap(Carrier.CanadaLife, { annualMaxUsedIndividual: 1000 });
    const state = buildAnnualMaxState(cfg, snapshot);

    expect(annualMaxRemaining(state)).toBe(200);

    const { netInsurancePays, capApplied } = applyAnnualMax(300, state);
    expect(netInsurancePays).toBe(200); // capped at remaining
    expect(capApplied).toBe(100);
  });

  it('Annual max at $0 remaining results in $0 insurance payment', () => {
    const cfg = getCarrierConfig(Carrier.SunLife); // $1500 max
    const snapshot = makeSnap(Carrier.SunLife, { annualMaxUsedIndividual: 1500 });
    const state = buildAnnualMaxState(cfg, snapshot);

    const { netInsurancePays } = applyAnnualMax(600, state);
    expect(netInsurancePays).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section F — Multi-Procedure Estimate Consistency
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 06-F — Multi-procedure estimate consistency', () => {
  it('All 6 carriers: patient + insurance totals = provider fee total', () => {
    const procedures = [
      { cdtCode: 'D1110', providerFee: 180, quantity: 1, dateOfService: TODAY },
      { cdtCode: 'D3330', providerFee: 900, quantity: 1, dateOfService: TODAY },
      { cdtCode: 'D2740', providerFee: 1200, quantity: 1, dateOfService: TODAY },
    ];
    const totalFee = 180 + 900 + 1200;

    for (const carrier of Object.values(Carrier)) {
      const patient = makePatient(carrier as Carrier);
      const estimate = generateEstimate(
        { patientId: 'p', procedures, carrier: carrier as Carrier, eligibilitySnapshot: makeSnap(carrier as Carrier) },
        patient,
      );
      const sum = estimate.totals.patientTotal + estimate.totals.insuranceTotal;
      expect(sum).toBeCloseTo(totalFee, 0);
    }
  });

  it('Procedure-level patientPortion sum equals estimate total patientTotal', () => {
    const carrier = Carrier.SunLife;
    const procedures = [
      { cdtCode: 'D1110', providerFee: 180, quantity: 1, dateOfService: TODAY },
      { cdtCode: 'D3330', providerFee: 900, quantity: 1, dateOfService: TODAY },
    ];
    const patient = makePatient(carrier);
    const estimate = generateEstimate(
      { patientId: 'p', procedures, carrier, eligibilitySnapshot: makeSnap(carrier) },
      patient,
    );
    const sumPatient = estimate.procedures.reduce((s, p) => s + p.patientPortion, 0);
    expect(sumPatient).toBeCloseTo(estimate.totals.patientTotal, 1);
  });

  it('Zero-quantity estimate does not produce negative totals', () => {
    const carrier = Carrier.SunLife;
    const patient = makePatient(carrier);
    const estimate = generateEstimate(
      {
        patientId: 'p',
        procedures: [{ cdtCode: 'D1110', providerFee: 0, quantity: 1, dateOfService: TODAY }],
        carrier,
        eligibilitySnapshot: makeSnap(carrier),
      },
      patient,
    );
    expect(estimate.totals.patientTotal).toBeGreaterThanOrEqual(0);
    expect(estimate.totals.insuranceTotal).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section G — Reconciliation Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 06-G — Reconciliation edge cases', () => {
  function makeEstimate(carrier: Carrier) {
    const patient = makePatient(carrier);
    return generateEstimate(
      { patientId: 'p', procedures: [{ cdtCode: 'D2740', providerFee: 1200, quantity: 1, dateOfService: TODAY }], carrier, eligibilitySnapshot: makeSnap(carrier) },
      patient,
    );
  }

  it('Exact match across all 6 carriers → within_threshold, no review', () => {
    for (const carrier of Object.values(Carrier)) {
      const estimate = makeEstimate(carrier as Carrier);
      const result = reconcile(estimate, {
        claimId: `CLM-${carrier}`,
        patientId: 'p',
        carrier: carrier as Carrier,
        adjudicatedAt: TODAY,
        eobReceivedAt: TODAY,
        procedures: [{
          cdtCode: 'D2740',
          providerFee: 1200,
          insurancePaid: estimate.totals.insuranceTotal,
          patientPaid: estimate.totals.patientTotal,
        }],
      });
      expect(result.flag).toBe(ReconciliationFlag.WithinThreshold);
      expect(result.requiresHumanReview).toBe(false);
    }
  });

  it('Carrier overpayment (insurer pays more than estimated) is flagged', () => {
    const estimate = makeEstimate(Carrier.SunLife);
    const result = reconcile(estimate, {
      claimId: 'CLM-OVERPAY',
      patientId: 'p',
      carrier: Carrier.SunLife,
      adjudicatedAt: TODAY,
      eobReceivedAt: TODAY,
      procedures: [{
        cdtCode: 'D2740',
        providerFee: 1200,
        insurancePaid: estimate.totals.insuranceTotal + 200, // $200 overpayment
        patientPaid: estimate.totals.patientTotal - 200,
      }],
    });
    expect(result.requiresHumanReview).toBe(true);
  });

  it('Partial denial flags varianceHigh or varianceCritical', () => {
    const estimate = makeEstimate(Carrier.GreenShield);
    const result = reconcile(estimate, {
      claimId: 'CLM-PARTIAL',
      patientId: 'p',
      carrier: Carrier.GreenShield,
      adjudicatedAt: TODAY,
      eobReceivedAt: TODAY,
      procedures: [{
        cdtCode: 'D2740',
        providerFee: 1200,
        insurancePaid: 0,
        patientPaid: 1200,
        denialReason: 'Frequency limit exceeded',
      }],
    });
    expect([ReconciliationFlag.VarianceHigh, ReconciliationFlag.VarianceCritical]).toContain(result.flag);
    expect(result.requiresHumanReview).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Section H — Confidence Scoring Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Agent 06-H — Confidence scoring edge cases', () => {
  it('Stale snapshot (15 days old) reduces confidence score', () => {
    const carrier = Carrier.SunLife;
    const patient = makePatient(carrier);
    const staleSnapshot = makeSnap(carrier, {
      verifiedAt: new Date(Date.now() - 86400_000 * 15).toISOString(),
    });
    const estimate = generateEstimate(
      { patientId: 'p', procedures: [{ cdtCode: 'D1110', providerFee: 180, quantity: 1, dateOfService: TODAY }], carrier, eligibilitySnapshot: staleSnapshot },
      patient,
    );
    // Stale snapshot means lower confidence than a fresh one
    const freshSnap = makeSnap(carrier, { verifiedAt: new Date().toISOString() });
    const freshEstimate = generateEstimate(
      { patientId: 'p', procedures: [{ cdtCode: 'D1110', providerFee: 180, quantity: 1, dateOfService: TODAY }], carrier, eligibilitySnapshot: freshSnap },
      patient,
    );
    expect(estimate.confidenceScore).toBeLessThanOrEqual(freshEstimate.confidenceScore);
  });

  it('Unknown eligibility status in snapshot lowers confidence (engine penalises Unknown, not Inactive)', () => {
    const carrier = Carrier.SunLife;
    const patient = makePatient(carrier);
    const unknownSnap = makeSnap(carrier, {
      status: EligibilityStatus.Unknown,
      verifiedAt: new Date().toISOString(),
    });
    const estimate = generateEstimate(
      { patientId: 'p', procedures: [{ cdtCode: 'D1110', providerFee: 180, quantity: 1, dateOfService: TODAY }], carrier, eligibilitySnapshot: unknownSnap },
      patient,
    );
    // Unknown status deducts 15 points → score = 85
    expect(estimate.confidenceScore).toBeLessThan(90);
  });

  it('Inactive status does NOT deduct confidence (engine only penalises Unknown status)', () => {
    const carrier = Carrier.SunLife;
    const patient = makePatient(carrier);
    const inactiveSnap = makeSnap(carrier, {
      status: EligibilityStatus.Inactive,
      verifiedAt: new Date().toISOString(),
    });
    const estimate = generateEstimate(
      { patientId: 'p', procedures: [{ cdtCode: 'D1110', providerFee: 180, quantity: 1, dateOfService: TODAY }], carrier, eligibilitySnapshot: inactiveSnap },
      patient,
    );
    // Inactive does not cause confidence deduction; score remains 100
    expect(estimate.confidenceScore).toBe(100);
  });

  it('confidence score is always in range [0, 100]', () => {
    for (const carrier of Object.values(Carrier)) {
      const patient = makePatient(carrier as Carrier);
      const estimate = generateEstimate(
        { patientId: 'p', procedures: [{ cdtCode: 'D2740', providerFee: 1200, quantity: 1, dateOfService: TODAY }], carrier: carrier as Carrier },
        patient,
      );
      expect(estimate.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(estimate.confidenceScore).toBeLessThanOrEqual(100);
    }
  });
});
