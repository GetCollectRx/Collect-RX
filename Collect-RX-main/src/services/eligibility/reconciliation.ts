// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Post-Insurance Reconciliation Engine
// Compares estimated vs. actual adjudication, flags variances,
// and produces patient balance adjustments.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import {
  ActualAdjudication,
  EligibilityEstimate,
  ReconciliationFlag,
  ReconciliationResult,
} from './types';

// Thresholds (PRD: flag variances for human review)
const VARIANCE_HIGH_THRESHOLD = 50;      // >$50 → high flag
const VARIANCE_CRITICAL_THRESHOLD = 150; // >$150 → critical, escalate

/**
 * Reconcile an estimate against actual insurance adjudication (EOB).
 *
 * Produces:
 *  - Variance amount and percent
 *  - Flag level (within threshold / high / critical)
 *  - Patient balance adjustment (positive = patient owes more, negative = credit)
 *  - List of variance reasons
 *  - requiresHumanReview flag
 */
export function reconcile(
  estimate: EligibilityEstimate,
  adjudication: ActualAdjudication,
): ReconciliationResult {
  const varianceReasons: string[] = [];

  // Actual totals from EOB
  const actualInsuranceTotal = adjudication.procedures.reduce(
    (sum, p) => sum + p.insurancePaid,
    0,
  );
  const actualPatientTotal = adjudication.procedures.reduce(
    (sum, p) => sum + p.patientPaid,
    0,
  );

  // Estimated patient total (from pre-treatment estimate)
  const estimatedPatientTotal = estimate.totals.patientTotal;

  // Variance: positive = patient owes more than estimated
  const variance = actualPatientTotal - estimatedPatientTotal;
  const varianceAbs = Math.abs(variance);

  const providerFeeTotal =
    adjudication.procedures.reduce((sum, p) => sum + p.providerFee, 0) || 1;
  const variancePercent = (varianceAbs / providerFeeTotal) * 100;

  // --- Variance reason analysis ---

  // Check for denied procedures
  const deniedProcedures = adjudication.procedures.filter(
    (p) => p.denialReason && p.insurancePaid === 0,
  );
  if (deniedProcedures.length > 0) {
    for (const dp of deniedProcedures) {
      varianceReasons.push(
        `Procedure ${dp.cdtCode} denied by carrier — reason: "${dp.denialReason}". ` +
          `Estimated insurer payment of $${(dp.providerFee * (estimate.procedures.find(ep => ep.cdtCode === dp.cdtCode)?.coveragePercent ?? 0) / 100).toFixed(2)} not received.`,
      );
    }
  }

  // Check for partial payments vs. estimates per procedure
  for (const actualProc of adjudication.procedures) {
    const estimatedProc = estimate.procedures.find(
      (ep) => ep.cdtCode === actualProc.cdtCode,
    );
    if (!estimatedProc) {
      varianceReasons.push(
        `Procedure ${actualProc.cdtCode} was adjudicated but not in the original estimate.`,
      );
      continue;
    }

    const procVariance = actualProc.patientPaid - estimatedProc.patientPortion;
    if (Math.abs(procVariance) > 5) {
      // >$5 per procedure is worth noting
      varianceReasons.push(
        `${actualProc.cdtCode}: estimated patient portion $${estimatedProc.patientPortion.toFixed(2)}, ` +
          `actual $${actualProc.patientPaid.toFixed(2)} (variance: $${procVariance.toFixed(2)}).`,
      );
    }
  }

  // Check if annual max was hit (insurer paid less than expected)
  if (actualInsuranceTotal < estimate.totals.insuranceTotal - 5) {
    const diff = estimate.totals.insuranceTotal - actualInsuranceTotal;
    varianceReasons.push(
      `Insurer paid $${diff.toFixed(2)} less than estimated — possible annual maximum exhaustion or coverage tier mismatch.`,
    );
  }

  // Check deductible discrepancy
  if (variance > 0 && estimate.totals.deductibleAppliedTotal === 0) {
    varianceReasons.push(
      `Estimate assumed deductible already met — carrier may have applied deductible ($${variance.toFixed(2)} difference).`,
    );
  }

  // Determine flag level
  let flag: ReconciliationFlag;
  if (varianceAbs <= VARIANCE_HIGH_THRESHOLD) {
    flag = ReconciliationFlag.WithinThreshold;
  } else if (varianceAbs <= VARIANCE_CRITICAL_THRESHOLD) {
    flag = ReconciliationFlag.VarianceHigh;
  } else {
    flag = ReconciliationFlag.VarianceCritical;
  }

  const requiresHumanReview =
    flag === ReconciliationFlag.VarianceCritical ||
    flag === ReconciliationFlag.VarianceHigh ||
    deniedProcedures.length > 0;

  if (requiresHumanReview && varianceReasons.length === 0) {
    varianceReasons.push(
      `Variance of $${varianceAbs.toFixed(2)} (${variancePercent.toFixed(1)}%) exceeds threshold — manual review required.`,
    );
  }

  if (varianceReasons.length === 0) {
    varianceReasons.push(
      `Estimate accurate — variance within $${VARIANCE_HIGH_THRESHOLD} threshold.`,
    );
  }

  return {
    reconciliationId: uuidv4(),
    claimId: adjudication.claimId,
    patientId: adjudication.patientId,
    estimateId: estimate.estimateId,
    reconciledAt: new Date().toISOString(),
    estimatedPatientTotal,
    actualPatientTotal,
    variance,
    variancePercent,
    flag,
    patientBalanceAdjustment: variance, // positive = patient owes more, negative = credit
    varianceReasons,
    requiresHumanReview,
  };
}

/**
 * Summarise reconciliation results for a batch of claims.
 * Used for nightly reconciliation run on the Balances tab.
 */
export function batchReconcile(
  pairs: Array<{ estimate: EligibilityEstimate; adjudication: ActualAdjudication }>,
): {
  results: ReconciliationResult[];
  requiresReviewCount: number;
  totalVariance: number;
  averageVariance: number;
} {
  const results = pairs.map(({ estimate, adjudication }) =>
    reconcile(estimate, adjudication),
  );

  const requiresReviewCount = results.filter((r) => r.requiresHumanReview).length;
  const totalVariance = results.reduce((sum, r) => sum + r.variance, 0);
  const averageVariance = results.length > 0 ? totalVariance / results.length : 0;

  return { results, requiresReviewCount, totalVariance, averageVariance };
}
