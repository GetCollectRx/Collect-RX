// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Deductible Logic
// Handles per-procedure deductible application, preventive waiver,
// individual vs. family deductible tracking.
// ─────────────────────────────────────────────────────────────────────────────

import { CarrierConfig, CoverageTier, EligibilitySnapshot } from '../types';

export interface DeductibleState {
  individualMet: number;
  familyMet: number;
  individualLimit: number;
  familyLimit: number;
  appliesToTiers: CoverageTier[];
}

/**
 * Build deductible state from carrier config + eligibility snapshot.
 */
export function buildDeductibleState(
  config: CarrierConfig,
  snapshot: EligibilitySnapshot | undefined,
): DeductibleState {
  return {
    individualMet: snapshot?.deductibleIndividualMet ?? 0,
    familyMet: snapshot?.deductibleFamilyMet ?? 0,
    individualLimit: config.deductible.individual,
    familyLimit: config.deductible.family,
    appliesToTiers: config.deductible.appliesToTiers as CoverageTier[],
  };
}

/**
 * Determine how much deductible applies to a single procedure charge.
 *
 * Rules:
 *  1. If the tier is NOT in appliesToTiers → deductible is waived ($0).
 *  2. Deductible remaining = max(0, individualLimit - individualMet).
 *  3. Amount applied = min(deductible remaining, procedure charge).
 *  4. The returned value reduces gross insurance payout dollar-for-dollar.
 *
 * NOTE: This function is PURE — it does not mutate state.
 *       Call applyDeductible() to produce updated state.
 */
export function calculateDeductibleForProcedure(
  tier: CoverageTier,
  providerFee: number,
  state: DeductibleState,
): number {
  // Tier exempt from deductible (e.g., preventive for Manulife)
  if (!state.appliesToTiers.includes(tier)) return 0;

  // Individual deductible remaining
  const individualRemaining = Math.max(0, state.individualLimit - state.individualMet);

  // Family deductible: once family deductible is met, no individual applies either
  const familyRemaining = Math.max(0, state.familyLimit - state.familyMet);
  const effectiveRemaining = Math.min(individualRemaining, familyRemaining);

  // Amount applied is the lesser of remaining deductible or procedure fee
  return Math.min(effectiveRemaining, providerFee);
}

/**
 * Apply deductible for one procedure and return updated state.
 * Call sequentially for multi-procedure estimates.
 */
export function applyDeductible(
  tier: CoverageTier,
  providerFee: number,
  state: DeductibleState,
): { applied: number; updatedState: DeductibleState } {
  const applied = calculateDeductibleForProcedure(tier, providerFee, state);

  return {
    applied,
    updatedState: {
      ...state,
      individualMet: state.individualMet + applied,
      familyMet: state.familyMet + applied,
    },
  };
}

/**
 * Returns how much individual deductible remains after all procedures so far.
 */
export function deductibleRemaining(state: DeductibleState): number {
  return Math.max(0, state.individualLimit - state.individualMet);
}

/**
 * Has the individual deductible been fully met?
 */
export function isDeductibleMet(state: DeductibleState): boolean {
  return state.individualMet >= state.individualLimit;
}
