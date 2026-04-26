/**
 * Phase 3: Estimate Calculator Service
 * Calculates patient out-of-pocket cost for a dental procedure given
 * their carrier, plan benefits, and current annual max usage.
 *
 * Algorithm:
 *  1. Resolve CDT category → coverage %
 *  2. Check waiting period (active = 0% coverage)
 *  3. Check frequency limits (exceeded = not covered this period)
 *  4. Apply deductible (only to basic/major)
 *  5. Apply coverage %
 *  6. Cap at remaining annual maximum
 *  7. Return full breakdown
 */

import { getCarrierRule, getCdtCoverageCategory, type CarrierRuleConfig } from './carrierRules.js';

// ─── Input / Output Types ────────────────────────────────────────────────────

export interface EstimateInput {
  cdtCode: string;           // e.g. "D1110"
  cdtDescription: string;    // e.g. "Adult Prophylaxis"
  procedureFee: number;      // fee in dollars
  carrierCode: string;       // e.g. "sun_life"

  // Patient benefit state (from PatientBenefits table or eligibility call)
  deductiblePaid: number;    // how much deductible patient has already met this year
  annualMaxUsed: number;     // how much of annual max has been consumed

  // Optional — for frequency/waiting checks
  patientDob?: Date;                  // needed for age-limited benefits (sealants, ortho)
  lastCleaningDate?: Date;
  lastExamDate?: Date;
  lastBitewingDate?: Date;
  lastFullSeriesDate?: Date;
  lastCrownDate?: Date;
  planStartDate?: Date;               // for waiting period calculation
  treatmentDate?: Date;               // defaults to today
}

export interface EstimateResult {
  cdtCode: string;
  cdtDescription: string;
  cdtCategory: string;
  carrierCode: string;
  carrierName: string;
  procedureFee: number;
  coverageCategory: string;
  coveragePct: number;           // final % applied
  deductibleApplied: number;     // amount taken from deductible
  deductibleRemaining: number;   // deductible left after this procedure
  grossInsurancePays: number;    // before annual max cap
  annualMaxCap: number;          // reduction due to annual max
  insurancePays: number;         // final insurance amount
  patientPays: number;           // final patient responsibility
  annualMaxRemaining: number;    // remaining annual max after this procedure
  frequencyLimited: boolean;
  frequencyNote?: string;
  waitingPeriodActive: boolean;
  waitingPeriodNote?: string;
  notCovered: boolean;
  notCoveredReason?: string;
  breakdown: string[];           // human-readable step-by-step
}

// ─── Main Calculator ─────────────────────────────────────────────────────────

export function calculateEstimate(input: EstimateInput): EstimateResult {
  const rule = getCarrierRule(input.carrierCode);
  if (!rule) {
    throw new Error(`Unknown carrier code: ${input.carrierCode}`);
  }

  const treatmentDate = input.treatmentDate ?? new Date();
  const coverageCategory = getCdtCoverageCategory(input.cdtCode);
  const breakdown: string[] = [];
  const result: EstimateResult = {
    cdtCode: input.cdtCode,
    cdtDescription: input.cdtDescription,
    cdtCategory: coverageCategory,
    carrierCode: input.carrierCode,
    carrierName: rule.carrierName,
    procedureFee: input.procedureFee,
    coverageCategory,
    coveragePct: 0,
    deductibleApplied: 0,
    deductibleRemaining: rule.deductible.single - input.deductiblePaid,
    grossInsurancePays: 0,
    annualMaxCap: 0,
    insurancePays: 0,
    patientPays: input.procedureFee,
    annualMaxRemaining: rule.annualMax.single - input.annualMaxUsed,
    frequencyLimited: false,
    waitingPeriodActive: false,
    notCovered: false,
    breakdown,
  };

  breakdown.push(`Procedure: ${input.cdtCode} — ${input.cdtDescription}`);
  breakdown.push(`Fee: $${input.procedureFee.toFixed(2)}`);
  breakdown.push(`Carrier: ${rule.carrierName} (${input.carrierCode})`);
  breakdown.push(`Category: ${coverageCategory}`);

  // ── Step 1: Not covered at all ────────────────────────────────────────────
  if (coverageCategory === 'not_covered') {
    result.notCovered = true;
    result.notCoveredReason = `CDT code ${input.cdtCode} is not covered under this plan.`;
    result.patientPays = input.procedureFee;
    breakdown.push(`❌ Not covered — patient pays full fee: $${input.procedureFee.toFixed(2)}`);
    result.breakdown = breakdown;
    return result;
  }

  // ── Step 2: Waiting period check ─────────────────────────────────────────
  const waitingMonths = rule.waitingPeriods[coverageCategory as keyof typeof rule.waitingPeriods] ?? 0;
  if (waitingMonths > 0 && input.planStartDate) {
    const waitUntil = new Date(input.planStartDate);
    waitUntil.setMonth(waitUntil.getMonth() + waitingMonths);
    if (treatmentDate < waitUntil) {
      result.waitingPeriodActive = true;
      result.waitingPeriodNote = `${waitingMonths}-month waiting period. Eligible after ${waitUntil.toISOString().split('T')[0]}.`;
      result.notCovered = true;
      result.notCoveredReason = result.waitingPeriodNote;
      result.patientPays = input.procedureFee;
      breakdown.push(`⏳ Waiting period active — ${result.waitingPeriodNote}`);
      result.breakdown = breakdown;
      return result;
    }
  }

  // ── Step 3: Frequency limit checks ───────────────────────────────────────
  const freqCheck = checkFrequencyLimits(input, rule, treatmentDate);
  if (freqCheck.limited) {
    result.frequencyLimited = true;
    result.frequencyNote = freqCheck.note;
    result.notCovered = true;
    result.notCoveredReason = freqCheck.note;
    result.patientPays = input.procedureFee;
    breakdown.push(`🔁 Frequency limit — ${freqCheck.note}`);
    result.breakdown = breakdown;
    return result;
  }

  // ── Step 4: Resolve coverage % ───────────────────────────────────────────
  let coveragePct = rule.coverage[coverageCategory as keyof typeof rule.coverage] ?? 0;
  breakdown.push(`Coverage: ${coveragePct}% for ${coverageCategory}`);

  // ── Step 5: Apply deductible (basic and major only) ───────────────────────
  let deductibleApplied = 0;
  const deductibleRemaining = Math.max(0, rule.deductible.single - input.deductiblePaid);

  if (coverageCategory === 'basic' || coverageCategory === 'major') {
    deductibleApplied = Math.min(deductibleRemaining, input.procedureFee);
    breakdown.push(`Deductible remaining: $${deductibleRemaining.toFixed(2)} → applied $${deductibleApplied.toFixed(2)}`);
  } else {
    breakdown.push(`Deductible: $0 (preventive/ortho exempt)`);
  }

  const feeAfterDeductible = Math.max(0, input.procedureFee - deductibleApplied);

  // ── Step 6: Calculate gross insurance pays ───────────────────────────────
  const grossInsurancePays = feeAfterDeductible * (coveragePct / 100);
  breakdown.push(`Gross insurance pays: $${feeAfterDeductible.toFixed(2)} × ${coveragePct}% = $${grossInsurancePays.toFixed(2)}`);

  // ── Step 7: Annual maximum cap ────────────────────────────────────────────
  const annualMaxRemaining = Math.max(0, rule.annualMax.single - input.annualMaxUsed);
  const annualMaxCap = Math.max(0, grossInsurancePays - annualMaxRemaining);
  const insurancePays = Math.max(0, grossInsurancePays - annualMaxCap);

  if (annualMaxCap > 0) {
    breakdown.push(`Annual max remaining: $${annualMaxRemaining.toFixed(2)} — capped by $${annualMaxCap.toFixed(2)}`);
  } else {
    breakdown.push(`Annual max remaining: $${annualMaxRemaining.toFixed(2)} — no cap applied`);
  }

  // ── Step 8: Patient responsibility ───────────────────────────────────────
  const patientPays = input.procedureFee - insurancePays;
  breakdown.push(`Insurance pays: $${insurancePays.toFixed(2)}`);
  breakdown.push(`Patient pays: $${patientPays.toFixed(2)}`);

  result.coveragePct = coveragePct;
  result.deductibleApplied = deductibleApplied;
  result.deductibleRemaining = Math.max(0, deductibleRemaining - deductibleApplied);
  result.grossInsurancePays = grossInsurancePays;
  result.annualMaxCap = annualMaxCap;
  result.insurancePays = insurancePays;
  result.patientPays = patientPays;
  result.annualMaxRemaining = Math.max(0, annualMaxRemaining - insurancePays);
  result.breakdown = breakdown;

  return result;
}

// ─── Frequency Limit Helper ──────────────────────────────────────────────────

function checkFrequencyLimits(
  input: EstimateInput,
  rule: CarrierRuleConfig,
  treatmentDate: Date
): { limited: boolean; note: string } {
  const codeNum = parseInt(input.cdtCode.replace('D', ''), 10);

  // D1110 / D1120 — cleaning
  if ((codeNum === 1110 || codeNum === 1120) && input.lastCleaningDate) {
    const nextEligible = new Date(input.lastCleaningDate);
    nextEligible.setMonth(nextEligible.getMonth() + rule.frequency.cleaningMonths);
    if (treatmentDate < nextEligible) {
      return { limited: true, note: `Cleaning covered every ${rule.frequency.cleaningMonths} months. Next eligible: ${nextEligible.toISOString().split('T')[0]}` };
    }
  }

  // D0120 / D0150 — exam
  if ((codeNum === 120 || codeNum === 150) && input.lastExamDate) {
    const nextEligible = new Date(input.lastExamDate);
    nextEligible.setMonth(nextEligible.getMonth() + rule.frequency.examMonths);
    if (treatmentDate < nextEligible) {
      return { limited: true, note: `Exam covered every ${rule.frequency.examMonths} months. Next eligible: ${nextEligible.toISOString().split('T')[0]}` };
    }
  }

  // D0272 / D0274 / D0277 — bitewing x-rays
  if ((codeNum >= 272 && codeNum <= 277) && input.lastBitewingDate) {
    const nextEligible = new Date(input.lastBitewingDate);
    nextEligible.setMonth(nextEligible.getMonth() + rule.frequency.xrayBitewingMonths);
    if (treatmentDate < nextEligible) {
      return { limited: true, note: `Bitewing x-rays covered every ${rule.frequency.xrayBitewingMonths} months. Next eligible: ${nextEligible.toISOString().split('T')[0]}` };
    }
  }

  // D0210 — full series x-ray
  if (codeNum === 210 && input.lastFullSeriesDate) {
    const nextEligible = new Date(input.lastFullSeriesDate);
    nextEligible.setMonth(nextEligible.getMonth() + rule.frequency.xrayFullSeriesMonths);
    if (treatmentDate < nextEligible) {
      return { limited: true, note: `Full series x-ray covered every ${rule.frequency.xrayFullSeriesMonths} months. Next eligible: ${nextEligible.toISOString().split('T')[0]}` };
    }
  }

  // D2740 / D2750 / D2780 — crowns
  if ((codeNum >= 2710 && codeNum <= 2799) && input.lastCrownDate) {
    const nextEligible = new Date(input.lastCrownDate);
    nextEligible.setMonth(nextEligible.getMonth() + rule.frequency.crownMonths);
    if (treatmentDate < nextEligible) {
      return { limited: true, note: `Crown covered every ${rule.frequency.crownMonths} months on same tooth. Next eligible: ${nextEligible.toISOString().split('T')[0]}` };
    }
  }

  // D1351 — sealants (age limit)
  if (codeNum === 1351 && rule.frequency.sealantAgeLimit && input.patientDob) {
    const ageAtTreatment = calculateAge(input.patientDob, treatmentDate);
    if (ageAtTreatment > rule.frequency.sealantAgeLimit) {
      return { limited: true, note: `Sealants covered up to age ${rule.frequency.sealantAgeLimit}. Patient age: ${ageAtTreatment}` };
    }
  }

  return { limited: false, note: '' };
}

function calculateAge(dob: Date, referenceDate: Date): number {
  let age = referenceDate.getFullYear() - dob.getFullYear();
  const m = referenceDate.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && referenceDate.getDate() < dob.getDate())) age--;
  return age;
}

// ─── Multi-procedure estimate ─────────────────────────────────────────────────

export interface MultiEstimateInput {
  procedures: Array<{
    cdtCode: string;
    cdtDescription: string;
    procedureFee: number;
  }>;
  carrierCode: string;
  deductiblePaid: number;
  annualMaxUsed: number;
  patientDob?: Date;
  lastCleaningDate?: Date;
  lastExamDate?: Date;
  lastBitewingDate?: Date;
  lastFullSeriesDate?: Date;
  lastCrownDate?: Date;
  planStartDate?: Date;
  treatmentDate?: Date;
}

export interface MultiEstimateResult {
  procedures: EstimateResult[];
  totalFee: number;
  totalInsurancePays: number;
  totalPatientPays: number;
  finalAnnualMaxRemaining: number;
  finalDeductibleRemaining: number;
}

export function calculateMultiEstimate(input: MultiEstimateInput): MultiEstimateResult {
  const rule = getCarrierRule(input.carrierCode);
  if (!rule) throw new Error(`Unknown carrier code: ${input.carrierCode}`);

  let runningDeductiblePaid = input.deductiblePaid;
  let runningAnnualMaxUsed = input.annualMaxUsed;

  const results: EstimateResult[] = [];

  for (const proc of input.procedures) {
    const est = calculateEstimate({
      ...proc,
      carrierCode: input.carrierCode,
      deductiblePaid: runningDeductiblePaid,
      annualMaxUsed: runningAnnualMaxUsed,
      patientDob: input.patientDob,
      lastCleaningDate: input.lastCleaningDate,
      lastExamDate: input.lastExamDate,
      lastBitewingDate: input.lastBitewingDate,
      lastFullSeriesDate: input.lastFullSeriesDate,
      lastCrownDate: input.lastCrownDate,
      planStartDate: input.planStartDate,
      treatmentDate: input.treatmentDate,
    });

    // Carry forward running totals so subsequent procedures reflect used deductible/max
    runningDeductiblePaid += est.deductibleApplied;
    runningAnnualMaxUsed += est.insurancePays;
    results.push(est);
  }

  const totalFee = results.reduce((s, r) => s + r.procedureFee, 0);
  const totalInsurancePays = results.reduce((s, r) => s + r.insurancePays, 0);
  const totalPatientPays = results.reduce((s, r) => s + r.patientPays, 0);

  return {
    procedures: results,
    totalFee,
    totalInsurancePays,
    totalPatientPays,
    finalAnnualMaxRemaining: Math.max(0, rule.annualMax.single - runningAnnualMaxUsed),
    finalDeductibleRemaining: Math.max(0, rule.deductible.single - runningDeductiblePaid),
  };
}
