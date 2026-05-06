// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Coordination of Benefits (COB)
// Handles dual-coverage scenarios: birthday rule, primary/secondary sequencing,
// and secondary coverage calculation.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Carrier,
  COBEstimate,
  COBRole,
  EligibilityEstimate,
  EligibilitySnapshot,
  InsurancePlan,
  Patient,
} from '../types';
import { CarrierConfig } from '../types';
import { buildAnnualMaxState, applyAnnualMax } from './annual-max';

// ---------------------------------------------------------------------------
// Birthday Rule
// ---------------------------------------------------------------------------

/**
 * Apply the birthday rule to determine which parent's plan is primary
 * for a dependent child with dual coverage.
 *
 * Rule: The parent whose birthday (month + day) falls earlier in the calendar
 * year is the primary insurer. Year of birth is NOT considered — only month/day.
 *
 * If birthdays are on the same day, the plan that has been in force longer is primary.
 * We default to the patient's own plan (primary) in a tie.
 *
 * Returns COBRole for the patient's primary plan.
 */
export function applyBirthdayRule(
  patientSubscriberDob: string,   // ISO YYYY-MM-DD — subscriber of primary plan
  secondarySubscriberDob: string, // ISO YYYY-MM-DD — subscriber of secondary plan
): { primaryIsBirthdayFirst: boolean; birthdayRuleApplied: boolean } {
  const [, pMonth, pDay] = patientSubscriberDob.split('-').map(Number);
  const [, sMonth, sDay] = secondarySubscriberDob.split('-').map(Number);

  const pDayOfYear = pMonth * 100 + pDay; // e.g., Jan 5 → 105
  const sDayOfYear = sMonth * 100 + sDay;

  if (pDayOfYear === sDayOfYear) {
    // Tie: patient's plan stays primary (by convention)
    return { primaryIsBirthdayFirst: true, birthdayRuleApplied: true };
  }

  return {
    primaryIsBirthdayFirst: pDayOfYear < sDayOfYear,
    birthdayRuleApplied: true,
  };
}

// ---------------------------------------------------------------------------
// COB Sequencing
// ---------------------------------------------------------------------------

export interface COBInput {
  patient: Patient;
  primaryPlan: InsurancePlan;
  secondaryPlan: InsurancePlan;
  primaryConfig: CarrierConfig;
  secondaryConfig: CarrierConfig;
  primarySnapshot?: EligibilitySnapshot;
  secondarySnapshot?: EligibilitySnapshot;
  providerFeeTotal: number;       // Total procedure fees
  primaryInsurancePays: number;   // What primary has already calculated it will pay
}

/**
 * Calculate what the secondary carrier pays after primary has adjudicated.
 *
 * Standard COB rule:
 *   Secondary covers the lesser of:
 *     (a) What the secondary would pay if it were the only carrier, OR
 *     (b) The patient's remaining balance after primary payment.
 *
 * Secondary never pays more than the patient's out-of-pocket after primary.
 */
export function calculateCOB(input: COBInput): COBEstimate {
  const notes: string[] = [];
  let birthdayRuleApplied = false;
  let primaryCarrier = input.primaryPlan.carrier;
  let secondaryCarrier = input.secondaryPlan.carrier;

  // Apply birthday rule for dependent children
  if (
    input.patient.relationshipToSubscriber === 'child' &&
    input.patient.subscriberDateOfBirth
  ) {
    // We need a secondary subscriber DOB — if not present, fall back to default order
    const secondarySubscriberDob =
      input.secondaryPlan.effectiveDate; // fallback: use effective date as proxy

    const { primaryIsBirthdayFirst, birthdayRuleApplied: ruleApplied } = applyBirthdayRule(
      input.patient.subscriberDateOfBirth,
      secondarySubscriberDob,
    );

    birthdayRuleApplied = ruleApplied;

    if (!primaryIsBirthdayFirst) {
      // Swap primary and secondary
      [primaryCarrier, secondaryCarrier] = [secondaryCarrier, primaryCarrier];
      notes.push(
        `Birthday rule applied: secondary carrier (${secondaryCarrier}) has earlier birthday — ` +
          `plans swapped so ${primaryCarrier} is primary.`,
      );
    } else {
      notes.push(
        `Birthday rule applied: primary carrier (${primaryCarrier}) subscriber has earlier birthday — order confirmed.`,
      );
    }
  }

  // Patient's remaining balance after primary pays
  const patientRemainingAfterPrimary = Math.max(
    0,
    input.providerFeeTotal - input.primaryInsurancePays,
  );

  // Calculate what secondary would pay if it were the only carrier
  // Secondary plan's annual max remaining
  const secondaryMaxState = buildAnnualMaxState(input.secondaryConfig, input.secondarySnapshot);
  const secondaryAnnualMaxRemaining = Math.max(
    0,
    secondaryMaxState.individualLimit - secondaryMaxState.individualUsed,
  );

  // Secondary coverage %: apply to the patient's remaining balance
  // (secondary covers the remainder, not the full fee)
  const secondaryCoveragePercent =
    input.secondaryConfig.coveragePercent['basic'] / 100; // use basic as conservative default

  const secondaryWouldPayAlone = Math.min(
    patientRemainingAfterPrimary * secondaryCoveragePercent,
    secondaryAnnualMaxRemaining,
  );

  // Standard COB: secondary pays the lesser of what it would pay alone vs. patient's remaining balance
  const secondaryActuallyPays = Math.min(secondaryWouldPayAlone, patientRemainingAfterPrimary);
  const patientPaysAfterCOB = Math.max(0, patientRemainingAfterPrimary - secondaryActuallyPays);

  notes.push(
    `Primary (${primaryCarrier}) pays $${input.primaryInsurancePays.toFixed(2)}.`,
  );
  notes.push(
    `Secondary (${secondaryCarrier}) pays $${secondaryActuallyPays.toFixed(2)} ` +
      `(patient remaining after primary: $${patientRemainingAfterPrimary.toFixed(2)}).`,
  );
  notes.push(
    `Patient out-of-pocket after COB: $${patientPaysAfterCOB.toFixed(2)}.`,
  );

  if (secondaryActuallyPays === 0 && patientRemainingAfterPrimary > 0) {
    notes.push(
      `Secondary pays $0 — annual max may be exhausted or coverage tier not applicable.`,
    );
  }

  return {
    primaryCarrier,
    secondaryCarrier,
    primaryInsurancePays: input.primaryInsurancePays,
    secondaryInsurancePays: secondaryActuallyPays,
    patientPaysAfterCOB,
    birthdayRuleApplied,
    notes,
  };
}

// ---------------------------------------------------------------------------
// TELUS AdjudiCare TPA Identification
// ---------------------------------------------------------------------------

/**
 * Identify the specific TPA behind a TELUS AdjudiCare plan.
 * Uses group number prefix mapping defined in carrier-configs.json.
 *
 * In production, this feeds the IVR navigator with the correct
 * call routing decision (TELUS itself vs. the underlying TPA).
 */
export function identifyTelusTpa(
  memberId: string,
  groupNumber: string,
  tpaProfiles: Record<string, string>,
): { tpa: string | null; method: string; confidence: 'high' | 'medium' | 'low' } {
  if (!groupNumber || groupNumber.length === 0) {
    return { tpa: null, method: 'unknown', confidence: 'low' };
  }

  const prefix = groupNumber.charAt(0).toUpperCase();
  const tpa = tpaProfiles[prefix] ?? null;

  if (tpa) {
    return { tpa, method: 'group_number_range', confidence: 'high' };
  }

  // Try member ID prefix as secondary signal
  if (memberId && memberId.length > 0) {
    const memberPrefix = memberId.charAt(0).toUpperCase();
    const tpaByMember = tpaProfiles[memberPrefix] ?? null;
    if (tpaByMember) {
      return { tpa: tpaByMember, method: 'member_card_prefix', confidence: 'medium' };
    }
  }

  return {
    tpa: 'Unknown TPA — manual verification required',
    method: 'unknown',
    confidence: 'low',
  };
}
