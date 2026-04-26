// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Core Eligibility Engine
// Orchestrates carrier config + CDT mapping + deductible + annual max + COB
// into a complete pre-treatment estimate with confidence scoring.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import carrierConfigsRaw from './rules/carrier-configs.json';
import { getCoverageTier } from './rules/cdt-codes';
import { buildDeductibleState, applyDeductible, deductibleRemaining } from './rules/deductible';
import { buildAnnualMaxState, applyAnnualMax, annualMaxRemaining } from './rules/annual-max';
import { calculateCOB, identifyTelusTpa } from './rules/cob';
import {
  Carrier,
  CarrierConfig,
  CoverageTier,
  EligibilityEstimate,
  EligibilitySnapshot,
  EligibilityStatus,
  EstimateRequest,
  Patient,
  ProcedureEstimate,
  TELUSTPAIdentification,
} from './types';

// ---------------------------------------------------------------------------
// Load carrier configs
// ---------------------------------------------------------------------------

const CARRIER_CONFIGS: Record<string, CarrierConfig> =
  (carrierConfigsRaw as { carriers: Record<string, CarrierConfig> }).carriers;

export function getCarrierConfig(carrier: Carrier): CarrierConfig {
  const config = CARRIER_CONFIGS[carrier];
  if (!config) throw new Error(`Unknown carrier: ${carrier}`);
  return config;
}

// ---------------------------------------------------------------------------
// Waiting Period Check
// ---------------------------------------------------------------------------

function isBlockedByWaitingPeriod(
  tier: CoverageTier,
  planEffectiveDate: string,
  dateOfService: string,
  config: CarrierConfig,
): { blocked: boolean; reason: string } {
  const wp = config.waitingPeriods.find((w) => w.tier === tier);
  if (!wp) return { blocked: false, reason: '' };

  const effectiveMs = new Date(planEffectiveDate).getTime();
  const serviceMs = new Date(dateOfService).getTime();
  const monthsElapsed = (serviceMs - effectiveMs) / (1000 * 60 * 60 * 24 * 30.44);

  if (monthsElapsed < wp.months) {
    return {
      blocked: true,
      reason: `Waiting period: ${wp.description} (${wp.months} months required, ${monthsElapsed.toFixed(1)} elapsed)`,
    };
  }
  return { blocked: false, reason: '' };
}

// ---------------------------------------------------------------------------
// Frequency Limit Check
// ---------------------------------------------------------------------------

function isBlockedByFrequencyLimit(
  cdtCode: string,
  dateOfService: string,
  config: CarrierConfig,
  priorServiceDates: Map<string, string[]>, // cdtCode → [ISO date strings of prior services]
): { blocked: boolean; reason: string } {
  const limit = config.frequencyLimits.find((f) => f.cdtCodePattern === cdtCode);
  if (!limit) return { blocked: false, reason: '' };

  const priorDates = priorServiceDates.get(cdtCode) ?? [];
  const serviceMs = new Date(dateOfService).getTime();

  for (const prior of priorDates) {
    const priorMs = new Date(prior).getTime();
    const monthsAgo = (serviceMs - priorMs) / (1000 * 60 * 60 * 24 * 30.44);
    if (monthsAgo < limit.limitPerMonths) {
      return {
        blocked: true,
        reason: `Frequency limit: ${limit.description} (last performed ${monthsAgo.toFixed(1)} months ago, limit is every ${limit.limitPerMonths} months)`,
      };
    }
  }
  return { blocked: false, reason: '' };
}

// ---------------------------------------------------------------------------
// Confidence Scoring
// ---------------------------------------------------------------------------

function computeConfidenceScore(
  snapshot: EligibilitySnapshot | undefined,
  blockedCount: number,
  _procedureCount: number,
  _notes: string[],
): { score: number; confidenceNotes: string[] } {
  const confidenceNotes: string[] = [];
  let score = 100;

  if (!snapshot) {
    score -= 35;
    confidenceNotes.push('No eligibility snapshot — using plan defaults. Deductible and annual max amounts are estimates only.');
  } else {
    const snapshotAgeMs = Date.now() - new Date(snapshot.verifiedAt).getTime();
    const snapshotAgeDays = snapshotAgeMs / (1000 * 60 * 60 * 24);
    if (snapshotAgeDays > 90) {
      score -= 20;
      confidenceNotes.push(`Eligibility snapshot is ${snapshotAgeDays.toFixed(0)} days old — deductible/max figures may be stale.`);
    } else if (snapshotAgeDays > 30) {
      score -= 10;
      confidenceNotes.push(`Eligibility snapshot is ${snapshotAgeDays.toFixed(0)} days old — verify current deductible before treatment.`);
    }

    if (snapshot.status === EligibilityStatus.Unknown) {
      score -= 15;
      confidenceNotes.push('Eligibility status unknown — coverage may be inactive.');
    }
  }

  if (blockedCount > 0) {
    score -= blockedCount * 10;
    confidenceNotes.push(`${blockedCount} procedure(s) blocked by waiting period or frequency limits — patient responsibility higher than shown.`);
  }

  score = Math.max(0, Math.min(100, score));
  return { score, confidenceNotes };
}

// ---------------------------------------------------------------------------
// Main Estimate Function
// ---------------------------------------------------------------------------

/**
 * Generate a complete pre-treatment eligibility estimate.
 *
 * Steps:
 *  1. Load carrier config (from JSON)
 *  2. For each procedure: map CDT → tier, check waiting period + frequency limits
 *  3. Calculate gross insurance portion (fee × coverage%)
 *  4. Apply deductible (sequential, tracks state across procedures)
 *  5. Apply annual max cap (sequential, tracks state across procedures)
 *  6. Sum totals, compute confidence score
 *  7. If secondary plan present, run COB calculation
 */
export function generateEstimate(
  request: EstimateRequest,
  patient: Patient,
  priorServiceDates: Map<string, string[]> = new Map(),
): EligibilityEstimate {
  const config = getCarrierConfig(request.carrier);
  const snapshot = request.eligibilitySnapshot;

  // Eligibility status guard
  const eligibilityStatus = snapshot?.status ?? EligibilityStatus.Unknown;

  // Initialise deductible and annual max state from snapshot (or plan defaults)
  let deductibleState = buildDeductibleState(config, snapshot);
  let annualMaxState = buildAnnualMaxState(config, snapshot);

  const procedureEstimates: ProcedureEstimate[] = [];
  let blockedCount = 0;

  for (const proc of request.procedures) {
    const procedureNotes: string[] = [];
    const tier = getCoverageTier(proc.cdtCode);
    const coveragePercent = config.coveragePercent[tier];

    // Waiting period check
    const { blocked: wpBlocked, reason: wpReason } = isBlockedByWaitingPeriod(
      tier,
      patient.primaryPlan.effectiveDate,
      proc.dateOfService,
      config,
    );

    // Frequency limit check
    const { blocked: freqBlocked, reason: freqReason } = isBlockedByFrequencyLimit(
      proc.cdtCode,
      proc.dateOfService,
      config,
      priorServiceDates,
    );

    if (wpBlocked) {
      procedureNotes.push(wpReason);
      blockedCount++;
    }
    if (freqBlocked) {
      procedureNotes.push(freqReason);
      blockedCount++;
    }

    const isBlocked = wpBlocked || freqBlocked;

    if (isBlocked) {
      // Blocked: patient pays full fee
      procedureEstimates.push({
        cdtCode: proc.cdtCode,
        tier,
        providerFee: proc.providerFee * proc.quantity,
        coveragePercent: 0,
        grossInsurancePortion: 0,
        deductibleApplied: 0,
        annualMaxCapApplied: 0,
        netInsurancePortion: 0,
        patientPortion: proc.providerFee * proc.quantity,
        waitingPeriodBlock: wpBlocked,
        frequencyLimitBlock: freqBlocked,
        notes: procedureNotes,
      });
      continue;
    }

    const totalFee = proc.providerFee * proc.quantity;

    // Gross insurance portion BEFORE deductible and annual max
    const grossInsurancePortion = (coveragePercent / 100) * totalFee;

    // Step 1: Apply deductible to patient's gross portion
    //         Deductible is paid by patient first; reduces insurance payout
    //         (insurer pays its % of the fee AFTER deductible is satisfied)
    //
    //         Correct model:
    //           patient pays deductible first, then insurance pays coverage% of remainder.
    //           But the simplest carrier model (used here) is:
    //           deductible comes off the top of the fee before coverage % applies.
    //
    //         We use: insurerPays = coverage% × (fee - deductibleApplied)
    //
    const { applied: deductibleApplied, updatedState: newDeductibleState } =
      applyDeductible(tier, totalFee, deductibleState);

    deductibleState = newDeductibleState;

    const feeAfterDeductible = totalFee - deductibleApplied;
    const grossInsuranceAfterDeductible = (coveragePercent / 100) * feeAfterDeductible;

    // Step 2: Apply annual max cap
    const { capApplied, netInsurancePays, updatedState: newAnnualMaxState } =
      applyAnnualMax(grossInsuranceAfterDeductible, annualMaxState);

    annualMaxState = newAnnualMaxState;

    // Patient pays: everything the insurer does NOT pay.
    // deductibleApplied is already embedded in netInsurancePays (insurer pays
    // coverage% of the fee AFTER deductible, so deductible is implicitly the
    // patient's burden — do NOT subtract it again here).
    const patientPortion = totalFee - netInsurancePays;

    if (capApplied > 0) {
      procedureNotes.push(
        `Annual maximum cap applied — insurer contribution reduced by $${capApplied.toFixed(2)}.`,
      );
    }

    if (deductibleApplied > 0) {
      procedureNotes.push(
        `Deductible applied: $${deductibleApplied.toFixed(2)} charged to patient first.`,
      );
    }

    procedureEstimates.push({
      cdtCode: proc.cdtCode,
      tier,
      providerFee: totalFee,
      coveragePercent,
      grossInsurancePortion,
      deductibleApplied,
      annualMaxCapApplied: capApplied,
      netInsurancePortion: netInsurancePays,
      patientPortion: Math.max(0, patientPortion),
      waitingPeriodBlock: false,
      frequencyLimitBlock: false,
      notes: procedureNotes,
    });
  }

  // Totals
  const totals = procedureEstimates.reduce(
    (acc, p) => ({
      providerFeeTotal: acc.providerFeeTotal + p.providerFee,
      insuranceTotal: acc.insuranceTotal + p.netInsurancePortion,
      patientTotal: acc.patientTotal + p.patientPortion,
      deductibleAppliedTotal: acc.deductibleAppliedTotal + p.deductibleApplied,
    }),
    { providerFeeTotal: 0, insuranceTotal: 0, patientTotal: 0, deductibleAppliedTotal: 0 },
  );

  // Confidence score
  const { score: confidenceScore, confidenceNotes } = computeConfidenceScore(
    snapshot,
    blockedCount,
    request.procedures.length,
    [],
  );

  // COB calculation (if secondary plan present)
  let cobEstimate;
  if (request.secondaryCarrier && patient.secondaryPlan) {
    try {
      const secondaryConfig = getCarrierConfig(request.secondaryCarrier);
      cobEstimate = calculateCOB({
        patient,
        primaryPlan: patient.primaryPlan,
        secondaryPlan: patient.secondaryPlan,
        primaryConfig: config,
        secondaryConfig,
        primarySnapshot: snapshot,
        secondarySnapshot: request.secondaryEligibilitySnapshot,
        providerFeeTotal: totals.providerFeeTotal,
        primaryInsurancePays: totals.insuranceTotal,
      });
    } catch (e) {
      confidenceNotes.push(`COB calculation failed: ${(e as Error).message}`);
    }
  }

  return {
    estimateId: uuidv4(),
    patientId: request.patientId,
    carrier: request.carrier,
    generatedAt: new Date().toISOString(),
    procedures: procedureEstimates,
    totals,
    cobEstimate,
    confidenceScore,
    confidenceNotes,
    eligibilityStatus,
    estimatedDeductibleRemaining: deductibleRemaining(deductibleState),
    estimatedAnnualMaxRemaining: annualMaxRemaining(annualMaxState),
  };
}

// ---------------------------------------------------------------------------
// TELUS AdjudiCare TPA Identification (exposed for routes + Vapi agent)
// ---------------------------------------------------------------------------

export function identifyTelusPlan(
  memberId: string,
  groupNumber: string,
): TELUSTPAIdentification {
  const config = getCarrierConfig(Carrier.TELUSAdjudiCare);
  const tpaProfiles: Record<string, string> =
    (config as unknown as { telusTpaProfiles: { group_prefix_ranges: Record<string, string> } })
      .telusTpaProfiles?.group_prefix_ranges ?? {};

  const { tpa, method, confidence } = identifyTelusTpa(memberId, groupNumber, tpaProfiles);

  return {
    memberId,
    groupNumber,
    identifiedTpa: tpa,
    identificationMethod: method as TELUSTPAIdentification['identificationMethod'],
    confidence,
    minWaitDay: config.minWaitDayForClaims ?? 21,
    notes:
      confidence === 'low'
        ? 'Manual verification required — call TELUS AdjudiCare member line to identify underlying TPA before routing IVR call.'
        : `TPA identified as "${tpa}" via ${method}. Minimum claim wait: day ${config.minWaitDayForClaims ?? 21}.`,
  };
}
