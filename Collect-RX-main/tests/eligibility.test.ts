// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Eligibility Engine Test Suite
// 35 test cases covering all 6 PRD acceptance criteria:
//   ✓ All 6 carriers return an estimate
//   ✓ COB calculation for dual-coverage
//   ✓ Deductible and annual max tracked across multiple claims
//   ✓ TELUS AdjudiCare TPA identification
//   ✓ Post-reconciliation variance flagging
//   ✓ 30+ test cases passing
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { generateEstimate, getCarrierConfig, identifyTelusPlan } from '../src/services/eligibility/engine';
import { reconcile } from '../src/services/eligibility/reconciliation';
import { getCoverageTier } from '../src/services/eligibility/rules/cdt-codes';
import {
  buildDeductibleState,
  applyDeductible,
  deductibleRemaining,
  isDeductibleMet,
} from '../src/services/eligibility/rules/deductible';
import {
  buildAnnualMaxState,
  applyAnnualMax,
  annualMaxRemaining,
  isAnnualMaxExhausted,
} from '../src/services/eligibility/rules/annual-max';
import { applyBirthdayRule, calculateCOB, type COBInput } from '../src/services/eligibility/rules/cob';
import {
  Carrier,
  CoverageTier,
  EligibilitySnapshot,
  EligibilityStatus,
  Patient,
  InsurancePlan,
  ReconciliationFlag,
} from '../src/services/eligibility/types';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const TODAY = '2026-04-20';
const PLAN_START_2Y_AGO = '2024-01-01';  // no waiting period issues
const PLAN_START_2W_AGO = '2026-04-06'; // triggers waiting period for major

function makeSnapshot(
  carrier: Carrier,
  overrides: Partial<EligibilitySnapshot> = {},
): EligibilitySnapshot {
  return {
    snapshotId: 'snap-001',
    patientId: 'patient-001',
    carrier,
    status: EligibilityStatus.Active,
    verifiedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(), // 5 days ago
    deductibleIndividualMet: 0,
    deductibleFamilyMet: 0,
    annualMaxUsedIndividual: 0,
    annualMaxUsedFamily: null,
    planYearStart: '2026-01-01',
    ...overrides,
  };
}

function makePlan(carrier: Carrier, effectiveDate: string = PLAN_START_2Y_AGO): InsurancePlan {
  return {
    planId: `plan-${carrier}`,
    carrier,
    planName: 'Standard Group Plan',
    groupNumber: 'GRP-001',
    memberId: 'MBR-001',
    effectiveDate,
    terminationDate: null,
    planType: 'group',
  };
}

function makePatient(
  carrier: Carrier,
  effectiveDate: string = PLAN_START_2Y_AGO,
  secondaryCarrier?: Carrier,
): Patient {
  return {
    patientId: 'patient-001',
    firstName: 'Jane',
    lastName: 'Smith',
    dateOfBirth: '1985-03-15',
    primaryPlan: makePlan(carrier, effectiveDate),
    secondaryPlan: secondaryCarrier ? makePlan(secondaryCarrier) : undefined,
    relationshipToSubscriber: 'self',
  };
}

const CROWN_PROCEDURE = {
  cdtCode: 'D2740',
  providerFee: 1200,
  quantity: 1,
  dateOfService: TODAY,
};

const CLEANING_PROCEDURE = {
  cdtCode: 'D1110',
  providerFee: 180,
  quantity: 1,
  dateOfService: TODAY,
};

const RCT_PROCEDURE = {
  cdtCode: 'D3330',
  providerFee: 900,
  quantity: 1,
  dateOfService: TODAY,
};

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: CDT Code Tier Mapping
// ─────────────────────────────────────────────────────────────────────────────

describe('CDT Code Tier Mapping', () => {
  it('TC-01: D1110 (cleaning) maps to preventive', () => {
    expect(getCoverageTier('D1110')).toBe(CoverageTier.Preventive);
  });

  it('TC-02: D2740 (crown) maps to major', () => {
    expect(getCoverageTier('D2740')).toBe(CoverageTier.Major);
  });

  it('TC-03: D3330 (molar RCT) maps to basic', () => {
    expect(getCoverageTier('D3330')).toBe(CoverageTier.Basic);
  });

  it('TC-04: D8080 (comprehensive ortho) maps to ortho', () => {
    expect(getCoverageTier('D8080')).toBe(CoverageTier.Ortho);
  });

  it('TC-05: Unknown code falls back via range (D9995 → basic)', () => {
    expect(getCoverageTier('D9995')).toBe(CoverageTier.Basic);
  });

  it('TC-06: D4341 (perio scaling) maps to basic', () => {
    expect(getCoverageTier('D4341')).toBe(CoverageTier.Basic);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: All 6 Carriers Return an Estimate (AC #1)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#1 — All 6 carriers return an estimate', () => {
  const carriers = [
    Carrier.SunLife,
    Carrier.CanadaLife,
    Carrier.Manulife,
    Carrier.GreenShield,
    Carrier.RBC,
    Carrier.TELUSAdjudiCare,
  ];

  for (const carrier of carriers) {
    it(`TC-07-${carrier}: ${carrier} returns a valid estimate for a crown (D2740)`, () => {
      const patient = makePatient(carrier);
      const snapshot = makeSnapshot(carrier);
      const estimate = generateEstimate(
        { patientId: 'patient-001', procedures: [CROWN_PROCEDURE], carrier, eligibilitySnapshot: snapshot },
        patient,
      );

      expect(estimate.estimateId).toBeTruthy();
      expect(estimate.carrier).toBe(carrier);
      expect(estimate.procedures).toHaveLength(1);
      expect(estimate.procedures[0].cdtCode).toBe('D2740');
      expect(estimate.procedures[0].tier).toBe(CoverageTier.Major);
      expect(estimate.totals.providerFeeTotal).toBe(1200);
      expect(estimate.totals.patientTotal + estimate.totals.insuranceTotal).toBeCloseTo(1200, 1);
      expect(estimate.confidenceScore).toBeGreaterThan(0);
      expect(estimate.confidenceScore).toBeLessThanOrEqual(100);
    });
  }

  it('TC-08: Manulife has 0 deductible — full fee goes through coverage %', () => {
    const carrier = Carrier.Manulife;
    const patient = makePatient(carrier);
    const snapshot = makeSnapshot(carrier);
    const estimate = generateEstimate(
      { patientId: 'patient-001', procedures: [CROWN_PROCEDURE], carrier, eligibilitySnapshot: snapshot },
      patient,
    );
    // Manulife: major = 60%, deductible = $0
    const proc = estimate.procedures[0];
    expect(proc.deductibleApplied).toBe(0);
    expect(proc.coveragePercent).toBe(60);
    expect(proc.netInsurancePortion).toBeCloseTo(720, 1);  // 60% of $1200
    expect(proc.patientPortion).toBeCloseTo(480, 1);       // 40% of $1200
  });

  it('TC-09: Preventive (D1110) is 100% covered by all carriers', () => {
    for (const carrier of carriers) {
      const patient = makePatient(carrier);
      const snapshot = makeSnapshot(carrier);
      const estimate = generateEstimate(
        { patientId: 'p', procedures: [CLEANING_PROCEDURE], carrier, eligibilitySnapshot: snapshot },
        patient,
      );
      const proc = estimate.procedures[0];
      expect(proc.coveragePercent).toBe(100);
      // Patient portion = $0 (preventive is exempt from deductible at all carriers)
      expect(proc.patientPortion).toBeCloseTo(0, 1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: Deductible Tracking (AC #4)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#4 — Deductible tracking across multiple claims', () => {
  it('TC-13: Deductible applied to first claim, reduced for second claim in same plan year', () => {
    const config = getCarrierConfig(Carrier.SunLife); // $50 individual deductible
    const snapshot = makeSnapshot(Carrier.SunLife, { deductibleIndividualMet: 0 });
    let state = buildDeductibleState(config, snapshot);

    // First procedure — $900 RCT (basic, deductible applies)
    const { applied: applied1, updatedState: state2 } = applyDeductible(CoverageTier.Basic, 900, state);
    expect(applied1).toBe(50); // full $50 deductible charged on first basic claim
    expect(state2.individualMet).toBe(50);

    // Second procedure — $1200 crown (major, deductible applies)
    const { applied: applied2, updatedState: state3 } = applyDeductible(CoverageTier.Major, 1200, state2);
    expect(applied2).toBe(0); // deductible already met
    expect(state3.individualMet).toBe(50);
    expect(isDeductibleMet(state3)).toBe(true);
    expect(deductibleRemaining(state3)).toBe(0);
  });

  it('TC-14: Preventive procedures are exempt from deductible (Sun Life)', () => {
    const config = getCarrierConfig(Carrier.SunLife);
    const state = buildDeductibleState(config, undefined);
    const { applied } = applyDeductible(CoverageTier.Preventive, 180, state);
    expect(applied).toBe(0);
  });

  it('TC-15: Manulife has zero deductible — applied is always $0', () => {
    const config = getCarrierConfig(Carrier.Manulife);
    const state = buildDeductibleState(config, undefined);
    const { applied: a1 } = applyDeductible(CoverageTier.Basic, 500, state);
    const { applied: a2 } = applyDeductible(CoverageTier.Major, 1200, state);
    expect(a1).toBe(0);
    expect(a2).toBe(0);
  });

  it('TC-16: Partially-met deductible reduces correctly on second claim', () => {
    const config = getCarrierConfig(Carrier.CanadaLife); // $75 individual
    const snapshot = makeSnapshot(Carrier.CanadaLife, { deductibleIndividualMet: 40 });
    const state = buildDeductibleState(config, snapshot);

    // Only $35 of deductible remains
    const { applied } = applyDeductible(CoverageTier.Basic, 500, state);
    expect(applied).toBe(35);
  });

  it('P3-41: Family deductible pool is the binding cap when below individual remaining', () => {
    const config = getCarrierConfig(Carrier.SunLife); // $50 indiv, $150 family
    const state = buildDeductibleState(
      config,
      makeSnapshot(Carrier.SunLife, { deductibleIndividualMet: 0, deductibleFamilyMet: 140 }),
    );
    // $50 individual left, $10 family left → only $10 can apply
    const { applied } = applyDeductible(CoverageTier.Basic, 500, state);
    expect(applied).toBe(10);
  });

  it('TC-17: Engine tracks deductible correctly across a multi-procedure estimate', () => {
    const carrier = Carrier.RBC; // $100 deductible
    const patient = makePatient(carrier);
    const snapshot = makeSnapshot(carrier, { deductibleIndividualMet: 0 });
    const estimate = generateEstimate(
      {
        patientId: 'p',
        procedures: [RCT_PROCEDURE, CROWN_PROCEDURE], // basic + major
        carrier,
        eligibilitySnapshot: snapshot,
      },
      patient,
    );
    const totalDeductibleApplied = estimate.totals.deductibleAppliedTotal;
    expect(totalDeductibleApplied).toBe(100); // exactly $100 deductible, applied once
    expect(estimate.estimatedDeductibleRemaining).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: Annual Maximum Tracking (AC #4 cont.)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#4 — Annual maximum tracking', () => {
  it('TC-18: Annual max cap kicks in when remaining is less than insurance payout', () => {
    const config = getCarrierConfig(Carrier.SunLife); // $1500 individual max
    const snapshot = makeSnapshot(Carrier.SunLife, { annualMaxUsedIndividual: 1400 }); // $100 left
    const state = buildAnnualMaxState(config, snapshot);

    // Crown: insurer would pay 50% of $1200 = $600, but only $100 left
    const { capApplied, netInsurancePays } = applyAnnualMax(600, state);
    expect(netInsurancePays).toBeCloseTo(100, 1);
    expect(capApplied).toBeCloseTo(500, 1);
  });

  it('TC-19: Annual max fully exhausted — insurer pays $0', () => {
    const config = getCarrierConfig(Carrier.CanadaLife); // $1200 individual max
    const snapshot = makeSnapshot(Carrier.CanadaLife, { annualMaxUsedIndividual: 1200 });
    const state = buildAnnualMaxState(config, snapshot);

    expect(isAnnualMaxExhausted(state)).toBe(true);
    const { netInsurancePays, capApplied } = applyAnnualMax(500, state);
    expect(netInsurancePays).toBe(0);
    expect(capApplied).toBe(500);
  });

  it('TC-20: Manulife family max tracked independently from individual', () => {
    const config = getCarrierConfig(Carrier.Manulife); // $2000 individual, $4000 family
    const state = buildAnnualMaxState(config, makeSnapshot(Carrier.Manulife, {
      annualMaxUsedIndividual: 0,
      annualMaxUsedFamily: 3800, // family nearly exhausted
    }));

    // Individual has $2000 remaining, but family only has $200 remaining
    const { netInsurancePays, capApplied } = applyAnnualMax(1000, state);
    expect(netInsurancePays).toBeCloseTo(200, 1);   // capped by family
    expect(capApplied).toBeCloseTo(800, 1);
  });

  it('TC-21: Annual max remaining reported correctly in estimate', () => {
    const carrier = Carrier.SunLife;
    const patient = makePatient(carrier);
    const snapshot = makeSnapshot(carrier, { annualMaxUsedIndividual: 900 }); // $600 left of $1500
    const estimate = generateEstimate(
      { patientId: 'p', procedures: [CROWN_PROCEDURE], carrier, eligibilitySnapshot: snapshot },
      patient,
    );
    // Crown (Sun Life): deductible = $50, so insured base = $1150.
    // Insurer pays 50% × $1150 = $575. Annual max starts at $600.
    // After estimate: used = 900 + 575 = 1475, remaining = 1500 - 1475 = $25.
    expect(estimate.estimatedAnnualMaxRemaining).toBeCloseTo(25, 0);
  });

  it('TC-22: Multiple procedures in one estimate consume annual max sequentially', () => {
    const carrier = Carrier.GreenShield; // $1500 max
    const patient = makePatient(carrier);
    const snapshot = makeSnapshot(carrier, { annualMaxUsedIndividual: 1300 }); // $200 left
    const estimate = generateEstimate(
      {
        patientId: 'p',
        procedures: [CLEANING_PROCEDURE, CROWN_PROCEDURE], // preventive + major
        carrier,
        eligibilitySnapshot: snapshot,
      },
      patient,
    );
    // Cleaning: 100% × $180 = $180 insurance — fits in $200 remaining
    // Crown: 50% × $1200 = $600 insurance — but only $20 remains after cleaning
    const cleaningEst = estimate.procedures.find(p => p.cdtCode === 'D1110')!;
    const crownEst    = estimate.procedures.find(p => p.cdtCode === 'D2740')!;
    expect(cleaningEst.annualMaxCapApplied).toBe(0);      // cleaning fits
    expect(crownEst.annualMaxCapApplied).toBeGreaterThan(0); // crown gets capped
    expect(estimate.estimatedAnnualMaxRemaining).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 5: Coordination of Benefits (AC #2)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#2 — COB calculation for dual-coverage', () => {
  it('TC-23: COB — secondary covers remaining patient balance after primary', () => {
    const primaryCarrier  = Carrier.SunLife;
    const secondaryCarrier = Carrier.CanadaLife;
    const patient = makePatient(primaryCarrier, PLAN_START_2Y_AGO, secondaryCarrier);
    const primarySnapshot   = makeSnapshot(primaryCarrier);
    const secondarySnapshot = makeSnapshot(secondaryCarrier);

    const estimate = generateEstimate(
      {
        patientId: 'p',
        procedures: [CROWN_PROCEDURE], // $1200 crown
        carrier: primaryCarrier,
        eligibilitySnapshot: primarySnapshot,
        secondaryCarrier,
        secondaryEligibilitySnapshot: secondarySnapshot,
      },
      patient,
    );

    expect(estimate.cobEstimate).toBeDefined();
    expect(estimate.cobEstimate!.primaryCarrier).toBe(primaryCarrier);
    expect(estimate.cobEstimate!.secondaryCarrier).toBe(secondaryCarrier);
    // Secondary should pay something
    expect(estimate.cobEstimate!.secondaryInsurancePays).toBeGreaterThan(0);
    // Total insurance + patient = provider fee
    const totalPaid =
      estimate.cobEstimate!.primaryInsurancePays +
      estimate.cobEstimate!.secondaryInsurancePays +
      estimate.cobEstimate!.patientPaysAfterCOB;
    expect(totalPaid).toBeCloseTo(estimate.totals.providerFeeTotal, 1);
  });

  it('TC-24: Birthday rule — earlier birthday is primary', () => {
    // Subscriber A: born Feb 10 → day 210
    // Subscriber B: born Aug 5  → day 805
    const { primaryIsBirthdayFirst } = applyBirthdayRule('1980-02-10', '1979-08-05');
    expect(primaryIsBirthdayFirst).toBe(true); // Feb < Aug → A is primary
  });

  it('TC-25: Birthday rule — later birthday means secondary becomes primary', () => {
    const { primaryIsBirthdayFirst } = applyBirthdayRule('1980-11-20', '1979-03-01');
    expect(primaryIsBirthdayFirst).toBe(false); // Nov > Mar → primary should swap
  });

  it('TC-26: Birthday rule tie — default to primary staying primary', () => {
    const { primaryIsBirthdayFirst, birthdayRuleApplied } = applyBirthdayRule('1980-06-15', '1978-06-15');
    expect(primaryIsBirthdayFirst).toBe(true);
    expect(birthdayRuleApplied).toBe(true);
  });

  it('TC-27: COB — secondary pays $0 when annual max is exhausted', () => {
    const primaryCarrier   = Carrier.SunLife;
    const secondaryCarrier = Carrier.CanadaLife;
    const patient = makePatient(primaryCarrier, PLAN_START_2Y_AGO, secondaryCarrier);
    const secondarySnapshot = makeSnapshot(secondaryCarrier, { annualMaxUsedIndividual: 1200 }); // exhausted
    const estimate = generateEstimate(
      {
        patientId: 'p',
        procedures: [CROWN_PROCEDURE],
        carrier: primaryCarrier,
        eligibilitySnapshot: makeSnapshot(primaryCarrier),
        secondaryCarrier,
        secondaryEligibilitySnapshot: secondarySnapshot,
      },
      patient,
    );
    expect(estimate.cobEstimate!.secondaryInsurancePays).toBe(0);
  });

  it('P3-41: calculateCOB — secondary is capped by patient remainder; totals equal fee', () => {
    const primaryCarrier = Carrier.SunLife;
    const secondaryCarrier = Carrier.CanadaLife;
    const patient = makePatient(primaryCarrier, PLAN_START_2Y_AGO, secondaryCarrier);
    const input: COBInput = {
      patient,
      primaryPlan: patient.primaryPlan,
      secondaryPlan: patient.secondaryPlan!,
      primaryConfig: getCarrierConfig(primaryCarrier),
      secondaryConfig: getCarrierConfig(secondaryCarrier),
      primarySnapshot: makeSnapshot(primaryCarrier),
      secondarySnapshot: makeSnapshot(secondaryCarrier),
      providerFeeTotal: 1000,
      primaryInsurancePays: 350,
    };
    const r = calculateCOB(input);
    const patientAfterPrimary = 650;
    expect(r.secondaryInsurancePays).toBeLessThanOrEqual(patientAfterPrimary);
    expect(r.patientPaysAfterCOB + r.primaryInsurancePays + r.secondaryInsurancePays).toBeCloseTo(1000, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 6: TELUS AdjudiCare TPA Identification (AC #5)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#5 — TELUS AdjudiCare TPA identification', () => {
  it('TC-28: Group prefix "C" identifies ClaimSecure as TPA', () => {
    const result = identifyTelusPlan('MBR-12345', 'C001-GROUP');
    expect(result.identifiedTpa).toBe('ClaimSecure');
    expect(result.confidence).toBe('high');
    expect(result.identificationMethod).toBe('group_number_range');
  });

  it('TC-29: Group prefix "B" identifies Benecaid as TPA', () => {
    const result = identifyTelusPlan('MBR-99', 'B500');
    expect(result.identifiedTpa).toBe('Benecaid');
    expect(result.confidence).toBe('high');
  });

  it('TC-30: Unknown prefix returns low confidence and manual review note', () => {
    // Member ID starts with 'Z', group number starts with 'Z' — neither maps to a known TPA
    const result = identifyTelusPlan('Z-UNKNOWN-99', 'Z999');
    expect(result.confidence).toBe('low');
    expect(result.notes).toContain('Manual verification required');
  });

  it('TC-31: TELUS min wait day is 21 (not 32 like other carriers)', () => {
    const result = identifyTelusPlan('MBR-A100', 'A200');
    expect(result.minWaitDay).toBe(21);
  });

  it('TC-32: TELUS carrier config is marked as clearinghouse', () => {
    const config = getCarrierConfig(Carrier.TELUSAdjudiCare);
    expect(config.isClearinghouse).toBe(true);
    expect(config.minWaitDayForClaims).toBe(21);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 7: Waiting Periods
// ─────────────────────────────────────────────────────────────────────────────

describe('Waiting period enforcement', () => {
  it('TC-33: Major restorative blocked if plan < 12 months old (Canada Life)', () => {
    const carrier = Carrier.CanadaLife;
    const patient = makePatient(carrier, PLAN_START_2W_AGO); // plan only 2 weeks old
    const estimate = generateEstimate(
      { patientId: 'p', procedures: [CROWN_PROCEDURE], carrier, eligibilitySnapshot: makeSnapshot(carrier) },
      patient,
    );
    const proc = estimate.procedures[0];
    expect(proc.waitingPeriodBlock).toBe(true);
    expect(proc.netInsurancePortion).toBe(0);
    expect(proc.patientPortion).toBe(1200); // patient pays full
  });

  it('TC-34: Waiting period does NOT block after sufficient time', () => {
    const carrier = Carrier.CanadaLife;
    const patient = makePatient(carrier, PLAN_START_2Y_AGO); // 2+ years old
    const estimate = generateEstimate(
      { patientId: 'p', procedures: [CROWN_PROCEDURE], carrier, eligibilitySnapshot: makeSnapshot(carrier) },
      patient,
    );
    expect(estimate.procedures[0].waitingPeriodBlock).toBe(false);
    expect(estimate.procedures[0].netInsurancePortion).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 8: Post-Reconciliation Variance Flagging (AC #6)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC#6 — Post-reconciliation variance flagging', () => {
  function buildEstimateForReconciliation(carrier: Carrier) {
    const patient = makePatient(carrier);
    const snapshot = makeSnapshot(carrier);
    return generateEstimate(
      { patientId: 'patient-001', procedures: [CROWN_PROCEDURE], carrier, eligibilitySnapshot: snapshot },
      patient,
    );
  }

  it('TC-35: Variance within $50 → flag: within_threshold, no human review', () => {
    const estimate = buildEstimateForReconciliation(Carrier.SunLife);
    const actualPatient = estimate.totals.patientTotal + 20; // $20 over estimate

    const result = reconcile(estimate, {
      claimId: 'CLM-001',
      patientId: 'patient-001',
      carrier: Carrier.SunLife,
      adjudicatedAt: TODAY,
      eobReceivedAt: TODAY,
      procedures: [{
        cdtCode: 'D2740',
        providerFee: 1200,
        insurancePaid: 1200 - actualPatient,
        patientPaid: actualPatient,
      }],
    });

    expect(result.flag).toBe(ReconciliationFlag.WithinThreshold);
    expect(result.requiresHumanReview).toBe(false);
    expect(Math.abs(result.variance)).toBeLessThanOrEqual(50);
  });

  it('TC-36: Variance >$50 and ≤$150 → flag: variance_high, requires review', () => {
    const estimate = buildEstimateForReconciliation(Carrier.SunLife);
    const actualPatient = estimate.totals.patientTotal + 80; // $80 over

    const result = reconcile(estimate, {
      claimId: 'CLM-002',
      patientId: 'patient-001',
      carrier: Carrier.SunLife,
      adjudicatedAt: TODAY,
      eobReceivedAt: TODAY,
      procedures: [{
        cdtCode: 'D2740',
        providerFee: 1200,
        insurancePaid: 1200 - actualPatient,
        patientPaid: actualPatient,
      }],
    });

    expect(result.flag).toBe(ReconciliationFlag.VarianceHigh);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.variance).toBeGreaterThan(50);
    expect(result.variance).toBeLessThanOrEqual(150);
  });

  it('TC-37: Variance >$150 → flag: variance_critical, requires review', () => {
    const estimate = buildEstimateForReconciliation(Carrier.SunLife);
    const actualPatient = estimate.totals.patientTotal + 200; // $200 over

    const result = reconcile(estimate, {
      claimId: 'CLM-003',
      patientId: 'patient-001',
      carrier: Carrier.SunLife,
      adjudicatedAt: TODAY,
      eobReceivedAt: TODAY,
      procedures: [{
        cdtCode: 'D2740',
        providerFee: 1200,
        insurancePaid: 1200 - actualPatient,
        patientPaid: actualPatient,
      }],
    });

    expect(result.flag).toBe(ReconciliationFlag.VarianceCritical);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.variance).toBeGreaterThan(150);
  });

  it('TC-38: Denied procedure → detected in variance reasons', () => {
    const estimate = buildEstimateForReconciliation(Carrier.GreenShield);

    const result = reconcile(estimate, {
      claimId: 'CLM-004',
      patientId: 'patient-001',
      carrier: Carrier.GreenShield,
      adjudicatedAt: TODAY,
      eobReceivedAt: TODAY,
      procedures: [{
        cdtCode: 'D2740',
        providerFee: 1200,
        insurancePaid: 0,
        patientPaid: 1200,
        denialReason: 'Annual maximum exhausted',
      }],
    });

    expect(result.requiresHumanReview).toBe(true);
    const hasDenialNote = result.varianceReasons.some(r => r.includes('denied'));
    expect(hasDenialNote).toBe(true);
    expect(result.patientBalanceAdjustment).toBeGreaterThan(0);
  });

  it('TC-39: Exact match estimate → variance $0, within threshold', () => {
    const carrier = Carrier.Manulife;
    const patient = makePatient(carrier);
    const snapshot = makeSnapshot(carrier);
    const estimate = generateEstimate(
      { patientId: 'p', procedures: [CLEANING_PROCEDURE], carrier, eligibilitySnapshot: snapshot },
      patient,
    );

    const result = reconcile(estimate, {
      claimId: 'CLM-005',
      patientId: 'p',
      carrier,
      adjudicatedAt: TODAY,
      eobReceivedAt: TODAY,
      procedures: [{
        cdtCode: 'D1110',
        providerFee: 180,
        insurancePaid: estimate.totals.insuranceTotal,
        patientPaid: estimate.totals.patientTotal,
      }],
    });

    expect(result.flag).toBe(ReconciliationFlag.WithinThreshold);
    expect(result.variance).toBeCloseTo(0, 1);
    expect(result.requiresHumanReview).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 9: Confidence Scoring
// ─────────────────────────────────────────────────────────────────────────────

describe('Confidence scoring', () => {
  it('TC-40: No snapshot → confidence reduced (< 70)', () => {
    const carrier = Carrier.RBC;
    const patient = makePatient(carrier);
    const estimate = generateEstimate(
      { patientId: 'p', procedures: [CROWN_PROCEDURE], carrier },
      patient,
    );
    expect(estimate.confidenceScore).toBeLessThan(70);
    expect(estimate.confidenceNotes.some(n => n.includes('snapshot'))).toBe(true);
  });

  it('TC-41: Fresh snapshot with active status → confidence >= 90', () => {
    const carrier = Carrier.SunLife;
    const patient = makePatient(carrier);
    const snapshot = makeSnapshot(carrier, {
      verifiedAt: new Date().toISOString(),
      status: EligibilityStatus.Active,
    });
    const estimate = generateEstimate(
      { patientId: 'p', procedures: [CLEANING_PROCEDURE], carrier, eligibilitySnapshot: snapshot },
      patient,
    );
    expect(estimate.confidenceScore).toBeGreaterThanOrEqual(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 10: Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('TC-42: Multi-procedure estimate — totals sum correctly', () => {
    const carrier = Carrier.SunLife;
    const patient = makePatient(carrier);
    const snapshot = makeSnapshot(carrier);
    const estimate = generateEstimate(
      {
        patientId: 'p',
        procedures: [CLEANING_PROCEDURE, RCT_PROCEDURE, CROWN_PROCEDURE],
        carrier,
        eligibilitySnapshot: snapshot,
      },
      patient,
    );
    const sumPatient   = estimate.procedures.reduce((s, p) => s + p.patientPortion, 0);
    const sumInsurance = estimate.procedures.reduce((s, p) => s + p.netInsurancePortion, 0);
    expect(sumPatient).toBeCloseTo(estimate.totals.patientTotal, 1);
    expect(sumInsurance).toBeCloseTo(estimate.totals.insuranceTotal, 1);
  });

  it('TC-43: Estimate generated at <10s (performance check)', () => {
    const carrier = Carrier.SunLife;
    const patient = makePatient(carrier);
    const snapshot = makeSnapshot(carrier);
    const procedures = Array.from({ length: 10 }, (_, i) => ({
      cdtCode: 'D2740',
      providerFee: 1200,
      quantity: 1,
      dateOfService: TODAY,
    }));
    const start = Date.now();
    generateEstimate({ patientId: 'p', procedures, carrier, eligibilitySnapshot: snapshot }, patient);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10_000); // PRD: < 10 seconds
  });
});
