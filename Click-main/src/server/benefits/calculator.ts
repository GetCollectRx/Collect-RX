/**
 * CollectRx — Pre-Treatment Estimate Calculator
 *
 * Takes patient token + planned procedures → returns line-by-line estimate.
 *
 * Logic per procedure:
 *   1. Map CDT code → category
 *   2. Check waiting period: if not met, coverage = 0%
 *   3. Check frequency limit: if too recent, coverage = 0%
 *   4. Calculate insurance portion = fee × coverage%
 *   5. Apply deductible: subtract from first procedure(s) until met
 *   6. Apply annual max remaining: cap insurance portion
 *   7. Patient owes = fee - insurance portion
 */

import {
  cdtToCategory,
  getCurrentBenefits,
  getCoverageForCategory,
  getPlanYear,
  getPendingClaimsTotal,
} from './schema';

interface Procedure {
  cdtCode: string;
  fee: number;
  description?: string;
}

interface EstimateLine {
  cdtCode: string;
  description: string;
  category: string;
  fee: string;
  coveragePct: string;
  insuranceCovers: string;
  patientOwes: string;
  deductibleApplied: string;
  maxCapApplied: string | null;
  adjustmentReason: string | null;
}

interface EstimateResult {
  lines: EstimateLine[];
  totals: {
    totalFee: string;
    totalInsurance: string;
    totalPatient: string;
    annualMaxUsed: string;
    annualMax: string;
    annualMaxRemaining: string;
    deductible: string;
    deductibleMet: string;
  };
  warnings: string[];
}

export async function calculateEstimate(
  patientToken: string,
  carrierCode: string,
  procedures: Procedure[]
): Promise<EstimateResult> {
  const warnings: string[] = [];
  const lines: EstimateLine[] = [];

  // Load plan year
  const planYear = await getPlanYear(patientToken, carrierCode);
  if (!planYear) {
    return {
      lines: [],
      totals: { totalFee: '0', totalInsurance: '0', totalPatient: '0', annualMaxUsed: '0', annualMax: 'Unknown', annualMaxRemaining: '0', deductible: '0.00', deductibleMet: '0.00' },
      warnings: ['No plan year found for this patient/carrier. Benefits data may need to be verified.'],
    };
  }

  // Load benefits summary
  const benefits = await getCurrentBenefits(patientToken, carrierCode);
  if (!benefits) {
    return {
      lines: [],
      totals: { totalFee: '0', totalInsurance: '0', totalPatient: '0', annualMaxUsed: '0', annualMax: 'Unknown', annualMaxRemaining: '0', deductible: '0.00', deductibleMet: '0.00' },
      warnings: ['No benefits data found. Run an eligibility verification first.'],
    };
  }

  if (benefits.staleFlag) {
    warnings.push('Benefits data is marked as stale. Consider re-verifying before treatment.');
  }

  // Get pending + paid for accurate annual max calculation
  const { paid, pending } = await getPendingClaimsTotal(
    patientToken, carrierCode, planYear.planYearStart, planYear.planYearEnd
  );
  const totalUsed = Number(benefits.annualMaxUsed) + paid + pending;

  // State for calculation
  let annualMaxRemaining = benefits.annualMax ? Number(benefits.annualMax) - totalUsed : Infinity;
  let deductibleRemaining = Math.max(0, Number(benefits.deductible) - Number(benefits.deductibleMet));

  const today = new Date();

  for (const proc of procedures) {
    const fee = Number(proc.fee) || 0;
    const category = cdtToCategory(proc.cdtCode);
    const coverage = await getCoverageForCategory(patientToken, carrierCode, category);

    let coveragePct = coverage?.coveragePct ? Number(coverage.coveragePct) / 100 : 0;
    let adjustmentReason: string | null = null;

    // Check waiting period
    if (coverage?.waitingPeriodMonths && coverage?.waitingPeriodStart) {
      const waitEnd = new Date(coverage.waitingPeriodStart);
      waitEnd.setMonth(waitEnd.getMonth() + coverage.waitingPeriodMonths);
      if (today < waitEnd) {
        coveragePct = 0;
        adjustmentReason = `Waiting period (${coverage.waitingPeriodMonths} mo) not met until ${waitEnd.toISOString().split('T')[0]}`;
      }
    }

    // Check frequency limit
    if (coverage?.frequencyLimitMonths && coverage?.lastServiceDate) {
      const nextEligible = new Date(coverage.lastServiceDate);
      nextEligible.setMonth(nextEligible.getMonth() + coverage.frequencyLimitMonths);
      if (today < nextEligible) {
        coveragePct = 0;
        adjustmentReason = `Frequency limit: next eligible ${nextEligible.toISOString().split('T')[0]}`;
      }
    }

    // Calculate insurance portion before deductible
    let grossInsurance = fee * coveragePct;

    // Apply deductible (only to first procedures until met)
    let deductibleApplied = 0;
    if (deductibleRemaining > 0 && grossInsurance > 0) {
      deductibleApplied = Math.min(deductibleRemaining, grossInsurance);
      grossInsurance -= deductibleApplied;
      deductibleRemaining -= deductibleApplied;
    }

    // Apply annual max cap
    let maxCapApplied = 0;
    if (annualMaxRemaining < grossInsurance && benefits.annualMax) {
      maxCapApplied = grossInsurance - Math.max(0, annualMaxRemaining);
      grossInsurance = Math.max(0, annualMaxRemaining);
    }
    if (grossInsurance > 0) {
      annualMaxRemaining -= grossInsurance;
    }

    const insurancePortion = Math.max(0, grossInsurance);
    const patientOwes = fee - insurancePortion;

    lines.push({
      cdtCode:           proc.cdtCode,
      description:       proc.description || '',
      category,
      fee:               fee.toFixed(2),
      coveragePct:       (coveragePct * 100).toFixed(0),
      insuranceCovers:   insurancePortion.toFixed(2),
      patientOwes:       patientOwes.toFixed(2),
      deductibleApplied: deductibleApplied.toFixed(2),
      maxCapApplied:     maxCapApplied > 0 ? maxCapApplied.toFixed(2) : null,
      adjustmentReason,
    });
  }

  const totals = {
    totalFee:       lines.reduce((s, l) => s + parseFloat(l.fee), 0).toFixed(2),
    totalInsurance: lines.reduce((s, l) => s + parseFloat(l.insuranceCovers), 0).toFixed(2),
    totalPatient:   lines.reduce((s, l) => s + parseFloat(l.patientOwes), 0).toFixed(2),
    annualMaxUsed:  totalUsed.toFixed(2),
    annualMax:      benefits.annualMax?.toFixed(2) || 'Unlimited',
    annualMaxRemaining: Math.max(0, annualMaxRemaining).toFixed(2),
    deductible:     benefits.deductible?.toFixed(2) || '0.00',
    deductibleMet:  benefits.deductibleMet?.toFixed(2) || '0.00',
  };

  return { lines, totals, warnings };
}
