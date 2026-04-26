/**
 * Phase 3 Test Suite — Estimate Calculator
 * 30+ test cases covering:
 *  - Basic estimates (all carriers)
 *  - Deductible logic
 *  - Annual maximum cap
 *  - Frequency limits
 *  - Waiting periods
 *  - Not covered / age limits
 *  - Multi-procedure estimates
 *  - Reconciliation engine
 */

import { describe, it, expect } from 'vitest';
import { calculateEstimate, calculateMultiEstimate } from '../../src/server/services/estimateCalculator.js';
import { reconcilePayment, reconcileBatch } from '../../src/server/services/reconciliationEngine.js';
import { getCdtCoverageCategory, getCarrierRule, VALID_CARRIER_CODES } from '../../src/server/services/carrierRules.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const baseInput = {
  cdtCode: 'D1110',
  cdtDescription: 'Adult Prophylaxis',
  procedureFee: 110,
  carrierCode: 'sun_life',
  deductiblePaid: 0,
  annualMaxUsed: 0,
};

// ── Section 1: CDT Category Mapping ───────────────────────────────────────────

describe('CDT Category Mapping', () => {
  it('maps D1110 (cleaning) to preventive', () => {
    expect(getCdtCoverageCategory('D1110')).toBe('preventive');
  });
  it('maps D0120 (exam) to preventive', () => {
    expect(getCdtCoverageCategory('D0120')).toBe('preventive');
  });
  it('maps D2391 (composite) to basic', () => {
    expect(getCdtCoverageCategory('D2391')).toBe('basic');
  });
  it('maps D3330 (RCT molar) to basic', () => {
    expect(getCdtCoverageCategory('D3330')).toBe('basic');
  });
  it('maps D4341 (SRP) to basic', () => {
    expect(getCdtCoverageCategory('D4341')).toBe('basic');
  });
  it('maps D2740 (crown) to basic (restorative)', () => {
    expect(getCdtCoverageCategory('D2740')).toBe('basic');
  });
  it('maps D5110 (full denture) to major', () => {
    expect(getCdtCoverageCategory('D5110')).toBe('major');
  });
  it('maps D6010 (implant) to major', () => {
    expect(getCdtCoverageCategory('D6010')).toBe('major');
  });
  it('maps D8080 (ortho) to orthodontic', () => {
    expect(getCdtCoverageCategory('D8080')).toBe('orthodontic');
  });
});

// ── Section 2: Basic Single-Procedure Estimates ───────────────────────────────

describe('Basic Estimates — Sun Life', () => {
  it('calculates preventive cleaning with no deductible (100% coverage)', () => {
    const result = calculateEstimate({ ...baseInput });
    expect(result.coveragePct).toBe(100);
    expect(result.deductibleApplied).toBe(0);
    expect(result.insurancePays).toBe(110);
    expect(result.patientPays).toBe(0);
    expect(result.notCovered).toBe(false);
  });

  it('calculates basic filling — deductible applied', () => {
    const result = calculateEstimate({
      cdtCode: 'D2391',
      cdtDescription: 'Composite Posterior 1 Surface',
      procedureFee: 175,
      carrierCode: 'sun_life',
      deductiblePaid: 0,
      annualMaxUsed: 0,
    });
    // Sun Life: $50 deductible, 80% basic
    // fee after deductible = 175 - 50 = 125
    // insurance pays = 125 * 0.80 = 100
    // patient pays = 175 - 100 = 75
    expect(result.deductibleApplied).toBe(50);
    expect(result.coveragePct).toBe(80);
    expect(result.insurancePays).toBeCloseTo(100, 1);
    expect(result.patientPays).toBeCloseTo(75, 1);
  });

  it('calculates major denture — deductible + 50% coverage', () => {
    const result = calculateEstimate({
      cdtCode: 'D5110',
      cdtDescription: 'Complete Denture Upper',
      procedureFee: 1500,
      carrierCode: 'sun_life',
      deductiblePaid: 0,
      annualMaxUsed: 0,
    });
    // Sun Life: $50 deductible, 50% major
    // fee after deductible = 1450
    // insurance = 1450 * 0.50 = 725
    // patient = 1500 - 725 = 775
    expect(result.deductibleApplied).toBe(50);
    expect(result.coveragePct).toBe(50);
    expect(result.insurancePays).toBeCloseTo(725, 1);
    expect(result.patientPays).toBeCloseTo(775, 1);
  });

  it('deductible already met — no further deductible applied', () => {
    const result = calculateEstimate({
      cdtCode: 'D2391',
      cdtDescription: 'Composite',
      procedureFee: 175,
      carrierCode: 'sun_life',
      deductiblePaid: 50,  // already fully met
      annualMaxUsed: 0,
    });
    expect(result.deductibleApplied).toBe(0);
    expect(result.insurancePays).toBeCloseTo(140, 1); // 175 * 0.80
    expect(result.patientPays).toBeCloseTo(35, 1);
  });

  it('deductible partially met — only remaining applied', () => {
    const result = calculateEstimate({
      cdtCode: 'D2391',
      cdtDescription: 'Composite',
      procedureFee: 175,
      carrierCode: 'sun_life',
      deductiblePaid: 30,  // $20 remaining
      annualMaxUsed: 0,
    });
    expect(result.deductibleApplied).toBe(20);
    expect(result.insurancePays).toBeCloseTo(124, 1); // (175-20) * 0.80 = 124
  });
});

// ── Section 3: Annual Maximum Cap ─────────────────────────────────────────────

describe('Annual Maximum Cap', () => {
  it('caps insurance payment at remaining annual max', () => {
    const result = calculateEstimate({
      cdtCode: 'D5110',
      cdtDescription: 'Complete Denture',
      procedureFee: 1500,
      carrierCode: 'sun_life',
      deductiblePaid: 50,     // met
      annualMaxUsed: 1100,    // only $100 remaining in annual max
    });
    // Gross insurance = 1500 * 0.50 = 750, but capped at $100 remaining
    expect(result.insurancePays).toBeCloseTo(100, 1);
    expect(result.patientPays).toBeCloseTo(1400, 1);
    expect(result.annualMaxRemaining).toBe(0);
  });

  it('annual max fully used — insurance pays nothing', () => {
    const result = calculateEstimate({
      cdtCode: 'D2391',
      cdtDescription: 'Composite',
      procedureFee: 175,
      carrierCode: 'sun_life',
      deductiblePaid: 50,
      annualMaxUsed: 1200,  // fully exhausted
    });
    expect(result.insurancePays).toBe(0);
    expect(result.patientPays).toBe(175);
  });
});

// ── Section 4: Carrier-Specific Tests ─────────────────────────────────────────

describe('Carrier-Specific Rules — All 6 Carriers', () => {
  const cleaningBase = {
    cdtCode: 'D1110',
    cdtDescription: 'Adult Cleaning',
    procedureFee: 110,
    deductiblePaid: 0,
    annualMaxUsed: 0,
  };

  it('Sun Life — preventive fully covered, no deductible', () => {
    const r = calculateEstimate({ ...cleaningBase, carrierCode: 'sun_life' });
    expect(r.insurancePays).toBe(110);
    expect(r.patientPays).toBe(0);
  });

  it('Manulife — preventive fully covered, higher annual max', () => {
    const r = calculateEstimate({ ...cleaningBase, carrierCode: 'manulife' });
    expect(r.insurancePays).toBe(110);
    expect(r.annualMaxRemaining).toBe(1500 - 110);
  });

  it('Canada Life — basic only 70%', () => {
    const r = calculateEstimate({
      cdtCode: 'D2391',
      cdtDescription: 'Composite',
      procedureFee: 175,
      carrierCode: 'canada_life',
      deductiblePaid: 25,  // Canada Life deductible met
      annualMaxUsed: 0,
    });
    expect(r.coveragePct).toBe(70);
    expect(r.deductibleApplied).toBe(0); // already met
  });

  it('Green Shield — no deductible on basic', () => {
    const r = calculateEstimate({
      cdtCode: 'D2391',
      cdtDescription: 'Composite',
      procedureFee: 175,
      carrierCode: 'green_shield',
      deductiblePaid: 0,
      annualMaxUsed: 0,
    });
    expect(r.deductibleApplied).toBe(0); // Green Shield has $0 deductible
    expect(r.coveragePct).toBe(80);
    expect(r.insurancePays).toBeCloseTo(140, 1);
  });

  it('RBC Insurance — mirrors Sun Life structure', () => {
    const r = calculateEstimate({ ...cleaningBase, carrierCode: 'rbc_insurance' });
    expect(r.insurancePays).toBe(110);
    expect(r.deductibleApplied).toBe(0);
  });

  it('TELUS Adjudicare — best coverage, 90% basic, no deductible', () => {
    const r = calculateEstimate({
      cdtCode: 'D2391',
      cdtDescription: 'Composite',
      procedureFee: 175,
      carrierCode: 'telus_adjudicare',
      deductiblePaid: 0,
      annualMaxUsed: 0,
    });
    expect(r.deductibleApplied).toBe(0);     // no deductible
    expect(r.coveragePct).toBe(90);
    expect(r.insurancePays).toBeCloseTo(157.5, 1);
  });
});

// ── Section 5: Frequency Limits ────────────────────────────────────────────────

describe('Frequency Limits', () => {
  const now = new Date();
  const twoMonthsAgo = new Date(now);
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

  it('blocks cleaning within 6-month frequency window', () => {
    const r = calculateEstimate({
      ...baseInput,
      cdtCode: 'D1110',
      lastCleaningDate: twoMonthsAgo, // only 2 months since last — limit is 6
    });
    expect(r.frequencyLimited).toBe(true);
    expect(r.notCovered).toBe(true);
    expect(r.patientPays).toBe(110);
  });

  it('allows cleaning after frequency window has passed', () => {
    const sevenMonthsAgo = new Date(now);
    sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 7);
    const r = calculateEstimate({
      ...baseInput,
      cdtCode: 'D1110',
      lastCleaningDate: sevenMonthsAgo,
    });
    expect(r.frequencyLimited).toBe(false);
    expect(r.insurancePays).toBe(110);
  });

  it('blocks crown within 60-month frequency window', () => {
    const twoYearsAgo = new Date(now);
    twoYearsAgo.setMonth(twoYearsAgo.getMonth() - 24);
    const r = calculateEstimate({
      cdtCode: 'D2750',
      cdtDescription: 'Crown PFM',
      procedureFee: 1150,
      carrierCode: 'sun_life',
      deductiblePaid: 0,
      annualMaxUsed: 0,
      lastCrownDate: twoYearsAgo, // 24 months — limit is 60
    });
    expect(r.frequencyLimited).toBe(true);
    expect(r.notCovered).toBe(true);
  });

  it('blocks sealant if patient over age limit', () => {
    const adultDob = new Date();
    adultDob.setFullYear(adultDob.getFullYear() - 25); // 25 years old — limit is 17
    const r = calculateEstimate({
      cdtCode: 'D1351',
      cdtDescription: 'Sealant',
      procedureFee: 55,
      carrierCode: 'sun_life',
      deductiblePaid: 0,
      annualMaxUsed: 0,
      patientDob: adultDob,
    });
    expect(r.frequencyLimited).toBe(true);
    expect(r.notCovered).toBe(true);
    expect(r.frequencyNote).toContain('age');
  });
});

// ── Section 6: Waiting Periods ────────────────────────────────────────────────

describe('Waiting Periods', () => {
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  it('blocks basic procedure during waiting period', () => {
    const r = calculateEstimate({
      cdtCode: 'D2391',
      cdtDescription: 'Composite',
      procedureFee: 175,
      carrierCode: 'sun_life',  // 3-month waiting on basic
      deductiblePaid: 0,
      annualMaxUsed: 0,
      planStartDate: oneMonthAgo, // only 1 month in — 3 month wait
    });
    expect(r.waitingPeriodActive).toBe(true);
    expect(r.notCovered).toBe(true);
    expect(r.patientPays).toBe(175);
  });

  it('preventive not blocked by waiting period', () => {
    const r = calculateEstimate({
      cdtCode: 'D1110',
      cdtDescription: 'Cleaning',
      procedureFee: 110,
      carrierCode: 'sun_life',
      deductiblePaid: 0,
      annualMaxUsed: 0,
      planStartDate: oneMonthAgo, // doesn't matter — preventive has 0 waiting
    });
    expect(r.waitingPeriodActive).toBe(false);
    expect(r.insurancePays).toBe(110);
  });

  it('Green Shield basic has no waiting period', () => {
    const r = calculateEstimate({
      cdtCode: 'D2391',
      cdtDescription: 'Composite',
      procedureFee: 175,
      carrierCode: 'green_shield',
      deductiblePaid: 0,
      annualMaxUsed: 0,
      planStartDate: oneMonthAgo,
    });
    expect(r.waitingPeriodActive).toBe(false);
    expect(r.notCovered).toBe(false);
  });
});

// ── Section 7: Multi-Procedure Estimates ──────────────────────────────────────

describe('Multi-Procedure Estimates', () => {
  it('chains deductible correctly across multiple procedures', () => {
    const result = calculateMultiEstimate({
      procedures: [
        { cdtCode: 'D2391', cdtDescription: 'Composite 1', procedureFee: 175 },
        { cdtCode: 'D2392', cdtDescription: 'Composite 2', procedureFee: 220 },
      ],
      carrierCode: 'sun_life',
      deductiblePaid: 0,
      annualMaxUsed: 0,
    });
    // First procedure: $50 deductible applied → (175-50)*0.80 = 100 insurance
    // Second procedure: deductible already met → 220*0.80 = 176 insurance
    expect(result.procedures[0].deductibleApplied).toBe(50);
    expect(result.procedures[1].deductibleApplied).toBe(0);
    expect(result.totalInsurancePays).toBeCloseTo(100 + 176, 0);
    expect(result.totalPatientPays).toBeCloseTo(175 + 220 - (100 + 176), 0);
  });

  it('caps annual max across appointment', () => {
    const result = calculateMultiEstimate({
      procedures: [
        { cdtCode: 'D5110', cdtDescription: 'Denture Upper', procedureFee: 1500 },
        { cdtCode: 'D5120', cdtDescription: 'Denture Lower', procedureFee: 1500 },
      ],
      carrierCode: 'sun_life',
      deductiblePaid: 50,
      annualMaxUsed: 900,  // only $300 left in annual max
    });
    expect(result.finalAnnualMaxRemaining).toBe(0);
    expect(result.totalInsurancePays).toBeCloseTo(300, 0);
  });

  it('returns correct totals for mixed categories', () => {
    const result = calculateMultiEstimate({
      procedures: [
        { cdtCode: 'D1110', cdtDescription: 'Cleaning', procedureFee: 110 },
        { cdtCode: 'D0272', cdtDescription: 'Bitewings', procedureFee: 55 },
        { cdtCode: 'D2391', cdtDescription: 'Composite', procedureFee: 175 },
      ],
      carrierCode: 'green_shield',  // no deductible
      deductiblePaid: 0,
      annualMaxUsed: 0,
    });
    // Green Shield: preventive 100%, basic 80%, no deductible
    // 110 + 55 + 175*0.80 = 165 + 140 = 305
    expect(result.totalInsurancePays).toBeCloseTo(110 + 55 + 140, 0);
    expect(result.totalFee).toBe(340);
  });
});

// ── Section 8: Reconciliation Engine ─────────────────────────────────────────

describe('Reconciliation Engine', () => {
  const base = {
    patientToken: 'patient-abc-123',
    carrierCode: 'sun_life',
    cdtCode: 'D1110',
  };

  it('marks payment as matched within dollar threshold', () => {
    const r = reconcilePayment({ ...base, estimatedInsurance: 100, actualInsurance: 103 });
    expect(r.status).toBe('matched');
    expect(r.actionRequired).toBe(false);
  });

  it('marks payment as matched within percentage threshold', () => {
    const r = reconcilePayment({ ...base, estimatedInsurance: 500, actualInsurance: 508 }); // 1.6%
    expect(r.status).toBe('matched');
  });

  it('detects underpayment outside threshold', () => {
    const r = reconcilePayment({ ...base, estimatedInsurance: 200, actualInsurance: 150 });
    expect(r.status).toBe('underpaid');
    expect(r.variance).toBe(-50);
    expect(r.actionRequired).toBe(true);
    expect(r.suggestedAction).toBeDefined();
  });

  it('detects significant underpayment and recommends appeal', () => {
    const r = reconcilePayment({ ...base, estimatedInsurance: 500, actualInsurance: 300 });
    expect(r.status).toBe('underpaid');
    expect(r.suggestedAction).toContain('appeal');
  });

  it('detects overpayment', () => {
    const r = reconcilePayment({ ...base, estimatedInsurance: 100, actualInsurance: 150 });
    expect(r.status).toBe('overpaid');
    expect(r.variance).toBe(50);
    expect(r.actionRequired).toBe(true);
    expect(r.suggestedAction).toContain('refund');
  });

  it('detects denial (actual $0 on covered procedure)', () => {
    const r = reconcilePayment({
      ...base,
      estimatedInsurance: 110,
      actualInsurance: 0,
      denialReason: 'Frequency limitation',
    });
    expect(r.status).toBe('denied');
    expect(r.actionRequired).toBe(true);
    expect(r.explanation).toContain('denied');
    expect(r.suggestedAction).toContain('Frequency limitation');
  });

  it('batch reconciliation returns correct summary', () => {
    const { summary } = reconcileBatch([
      { ...base, estimatedInsurance: 100, actualInsurance: 102 },     // matched
      { ...base, estimatedInsurance: 200, actualInsurance: 150 },     // underpaid
      { ...base, estimatedInsurance: 300, actualInsurance: 0 },       // denied
      { ...base, estimatedInsurance: 50, actualInsurance: 70 },       // overpaid
    ]);
    expect(summary.total).toBe(4);
    expect(summary.matched).toBe(1);
    expect(summary.underpaid).toBe(1);
    expect(summary.denied).toBe(1);
    expect(summary.overpaid).toBe(1);
    expect(summary.actionRequiredCount).toBe(3);
    expect(summary.totalDeniedAmount).toBe(300);
  });
});

// ── Section 9: Carrier Rule Lookups ───────────────────────────────────────────

describe('Carrier Rule Lookups', () => {
  it('returns rule for all 6 valid carriers', () => {
    for (const code of VALID_CARRIER_CODES) {
      const rule = getCarrierRule(code);
      expect(rule).not.toBeNull();
      expect(rule?.carrierCode).toBe(code);
    }
  });

  it('returns null for unknown carrier', () => {
    expect(getCarrierRule('unknown_carrier')).toBeNull();
  });

  it('TELUS has highest basic coverage at 90%', () => {
    const r = getCarrierRule('telus_adjudicare');
    expect(r?.coverage.basic).toBe(90);
  });

  it('Green Shield has zero deductible', () => {
    const r = getCarrierRule('green_shield');
    expect(r?.deductible.single).toBe(0);
  });

  it('throws on calculateEstimate with unknown carrier', () => {
    expect(() => calculateEstimate({ ...baseInput, carrierCode: 'bad_carrier' })).toThrow();
  });
});
