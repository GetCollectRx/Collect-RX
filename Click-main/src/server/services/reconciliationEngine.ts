/**
 * Phase 3: Post-Insurance Reconciliation Engine
 * Compares the estimated insurance payment against the actual EOB (Explanation of Benefits)
 * to catch billing errors, under-payments, and denials.
 *
 * Status outcomes:
 *  matched     — actual within ±$5 or ±2% of estimate
 *  underpaid   — carrier paid less than estimated (needs investigation)
 *  overpaid    — carrier paid more than estimated (flag for audit)
 *  denied      — carrier paid $0 on a covered procedure
 *  pending     — awaiting EOB
 */

export interface ReconciliationInput {
  patientToken: string;
  carrierCode: string;
  cdtCode: string;
  estimatedInsurance: number;  // from EstimateRecord.insurancePays
  actualInsurance: number;     // from EOB / remittance
  denialReason?: string;       // carrier denial code / description
  eobDate?: Date;
  notes?: string;
}

export interface ReconciliationResult {
  patientToken: string;
  carrierCode: string;
  cdtCode: string;
  estimatedInsurance: number;
  actualInsurance: number;
  variance: number;           // actual - estimated (negative = underpaid)
  variancePct: number;        // variance / estimated * 100
  status: 'matched' | 'underpaid' | 'overpaid' | 'denied' | 'pending';
  denialReason?: string;
  notes?: string;
  eobDate?: Date;
  explanation: string;        // human-readable outcome
  actionRequired: boolean;
  suggestedAction?: string;
}

// Tolerance thresholds
const VARIANCE_DOLLAR_THRESHOLD = 5;   // $5 tolerance
const VARIANCE_PCT_THRESHOLD = 2;      // 2% tolerance

export function reconcilePayment(input: ReconciliationInput): ReconciliationResult {
  const variance = input.actualInsurance - input.estimatedInsurance;
  const variancePct = input.estimatedInsurance > 0
    ? (variance / input.estimatedInsurance) * 100
    : 0;

  let status: ReconciliationResult['status'];
  let explanation: string;
  let actionRequired = false;
  let suggestedAction: string | undefined;

  // ── Determine status ───────────────────────────────────────────────────────
  if (input.actualInsurance === 0 && input.estimatedInsurance > 0) {
    // Full denial on a covered procedure
    status = 'denied';
    explanation = `Carrier denied payment. Estimated $${input.estimatedInsurance.toFixed(2)}, received $0.`;
    actionRequired = true;
    suggestedAction = input.denialReason
      ? `Review denial reason: "${input.denialReason}". Consider resubmission or appeal.`
      : 'No denial reason provided. Contact carrier for EOB clarification. Consider appeal.';

  } else if (
    Math.abs(variance) <= VARIANCE_DOLLAR_THRESHOLD ||
    Math.abs(variancePct) <= VARIANCE_PCT_THRESHOLD
  ) {
    // Within tolerance
    status = 'matched';
    explanation = `Payment matched estimate (variance: $${variance.toFixed(2)} / ${variancePct.toFixed(1)}%).`;
    actionRequired = false;

  } else if (variance < 0) {
    // Carrier paid less than estimated
    status = 'underpaid';
    explanation = `Carrier underpaid by $${Math.abs(variance).toFixed(2)} (${Math.abs(variancePct).toFixed(1)}%). Expected $${input.estimatedInsurance.toFixed(2)}, received $${input.actualInsurance.toFixed(2)}.`;
    actionRequired = true;
    suggestedAction = `Verify procedure coding and carrier fee schedule. ${
      Math.abs(variance) > 100
        ? 'Significant variance — recommend resubmission or appeal.'
        : 'Minor variance — verify fee schedule alignment.'
    }`;

  } else {
    // Carrier paid more than estimated
    status = 'overpaid';
    explanation = `Carrier overpaid by $${variance.toFixed(2)} (${variancePct.toFixed(1)}%). Expected $${input.estimatedInsurance.toFixed(2)}, received $${input.actualInsurance.toFixed(2)}.`;
    actionRequired = true;
    suggestedAction = 'Review for billing accuracy. Overpayment may require refund to carrier.';
  }

  return {
    patientToken: input.patientToken,
    carrierCode: input.carrierCode,
    cdtCode: input.cdtCode,
    estimatedInsurance: input.estimatedInsurance,
    actualInsurance: input.actualInsurance,
    variance,
    variancePct,
    status,
    denialReason: input.denialReason,
    notes: input.notes,
    eobDate: input.eobDate,
    explanation,
    actionRequired,
    suggestedAction,
  };
}

// ─── Batch reconciliation ─────────────────────────────────────────────────────

export interface BatchReconciliationResult {
  results: ReconciliationResult[];
  summary: {
    total: number;
    matched: number;
    underpaid: number;
    overpaid: number;
    denied: number;
    pending: number;
    totalVariance: number;
    totalUnderpaidAmount: number;
    totalDeniedAmount: number;
    actionRequiredCount: number;
  };
}

export function reconcileBatch(inputs: ReconciliationInput[]): BatchReconciliationResult {
  const results = inputs.map(reconcilePayment);

  const summary = {
    total: results.length,
    matched: results.filter(r => r.status === 'matched').length,
    underpaid: results.filter(r => r.status === 'underpaid').length,
    overpaid: results.filter(r => r.status === 'overpaid').length,
    denied: results.filter(r => r.status === 'denied').length,
    pending: results.filter(r => r.status === 'pending').length,
    totalVariance: results.reduce((s, r) => s + r.variance, 0),
    totalUnderpaidAmount: results
      .filter(r => r.status === 'underpaid')
      .reduce((s, r) => s + Math.abs(r.variance), 0),
    totalDeniedAmount: results
      .filter(r => r.status === 'denied')
      .reduce((s, r) => s + r.estimatedInsurance, 0),
    actionRequiredCount: results.filter(r => r.actionRequired).length,
  };

  return { results, summary };
}
