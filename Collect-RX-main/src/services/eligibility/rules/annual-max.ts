// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Annual Maximum Tracking
// Handles individual and family annual maximum caps per plan year.
// ─────────────────────────────────────────────────────────────────────────────

import { CarrierConfig, EligibilitySnapshot } from '../types';

export interface AnnualMaxState {
  individualUsed: number;
  familyUsed: number | null;
  individualLimit: number;
  familyLimit: number | null; // null = no family cap
}

/**
 * Build annual max state from carrier config + eligibility snapshot.
 */
export function buildAnnualMaxState(
  config: CarrierConfig,
  snapshot: EligibilitySnapshot | undefined,
): AnnualMaxState {
  return {
    individualUsed: snapshot?.annualMaxUsedIndividual ?? 0,
    familyUsed: snapshot?.annualMaxUsedFamily ?? null,
    individualLimit: config.annualMax.individual,
    familyLimit: config.annualMax.family,
  };
}

/**
 * Given a gross insurance payout for one procedure, calculate how much is
 * actually payable after applying individual and family annual max caps.
 *
 * Returns the amount capped (trimmed) due to the annual max — i.e. the
 * portion the patient must absorb because the plan is exhausted.
 *
 * NOTE: Pure function — does not mutate state.
 */
export function calculateAnnualMaxCap(
  grossInsurancePortion: number,
  state: AnnualMaxState,
): number {
  // Individual remaining
  const individualRemaining = Math.max(0, state.individualLimit - state.individualUsed);

  // Family remaining (if plan has a family cap)
  const familyRemaining =
    state.familyLimit !== null && state.familyUsed !== null
      ? Math.max(0, state.familyLimit - state.familyUsed)
      : Infinity;

  const effectiveRemaining = Math.min(individualRemaining, familyRemaining);

  // Amount payable by insurer after cap
  const payable = Math.min(grossInsurancePortion, effectiveRemaining);

  // Amount trimmed = what the patient absorbs due to exhausted max
  return Math.max(0, grossInsurancePortion - payable);
}

/**
 * Apply annual max for one procedure and return updated state.
 * grossInsurancePortion is BEFORE the cap is applied.
 * Returns how much the insurer actually pays and the updated state.
 */
export function applyAnnualMax(
  grossInsurancePortion: number,
  state: AnnualMaxState,
): { capApplied: number; netInsurancePays: number; updatedState: AnnualMaxState } {
  const capApplied = calculateAnnualMaxCap(grossInsurancePortion, state);
  const netInsurancePays = grossInsurancePortion - capApplied;

  return {
    capApplied,
    netInsurancePays,
    updatedState: {
      ...state,
      individualUsed: state.individualUsed + netInsurancePays,
      familyUsed:
        state.familyUsed !== null ? state.familyUsed + netInsurancePays : null,
    },
  };
}

/**
 * How much individual annual max remains?
 */
export function annualMaxRemaining(state: AnnualMaxState): number {
  return Math.max(0, state.individualLimit - state.individualUsed);
}

/**
 * Is the individual annual maximum fully exhausted?
 */
export function isAnnualMaxExhausted(state: AnnualMaxState): boolean {
  return state.individualUsed >= state.individualLimit;
}
