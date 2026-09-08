import type { CdcpCoPayTier } from './ontarioCdcpConfig.js';

/**
 * CDCP vs. ODA split-billing math for Ontario dual-coverage claims.
 *
 * Inputs are dollar amounts (matching FeeGuideEntry.feeCad and
 * InsuranceClaim.billedAmount, both stored as Decimal/Float dollars) — this
 * mirrors the convention in src/server/reconciliation/underpaymentDetector.ts,
 * which also takes dollars in and does its exact math in integer cents
 * internally. Convert Prisma Decimal to number at the call site (Number(x)),
 * and persist results by writing the *Cents fields back as dollars
 * (cents / 100) into Decimal columns — never carry floating-point dollars
 * through the arithmetic itself.
 */
export interface SplitBillingInput {
  /** ODA Suggested Fee Guide rate, in dollars. */
  odaFeeAmount: number;
  /** CDCP Dental Benefit Grid fee, in dollars. */
  cdcpFeeAmount: number;
  /** Income-based CDCP co-pay tier — see resolveCdcpCoPayTier. */
  coPayTier: CdcpCoPayTier;
  /**
   * True when a provincial secondary (Accerta: ODSP / Ontario Works /
   * Healthy Smiles Ontario) is coordinating benefits on this claim.
   */
  isProvincialSecondary: boolean;
}

export interface SplitBillingResult {
  /** Amount CDCP (Sun Life) pays the practice, in cents. */
  cdcpApprovedCoverageCents: number;
  /** Patient's income-based co-pay portion, in cents. */
  patientCoPayCents: number;
  /**
   * ODA-vs-CDCP fee differential. Zero whenever a provincial secondary is
   * coordinating — balance billing is prohibited by law in that case
   * (Canada.ca, "Coordination of benefits between the CDCP and Ontario's
   * provincial dental programs").
   */
  balanceBillingCents: number;
  /** What the patient actually owes at checkout, in cents. */
  totalPatientResponsibilityCents: number;
  /**
   * Amount routed to Accerta as secondary payer. Zero unless
   * isProvincialSecondary is true, in which case it absorbs the patient's
   * full co-pay + balance-billing total (the specified behavior: patient
   * pays $0 when a provincial secondary is coordinating). Whether Accerta
   * reimburses the CDCP co-pay itself, versus only the ODA/CDCP balance-
   * billing gap, was not independently confirmed against a primary source —
   * verify with the practice's billing/compliance contact before relying on
   * this for a real claim.
   */
  secondaryRouteAmountCents: number;
}

function dollarsToCents(amount: number, label: string): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${label} must be a non-negative finite number, got ${amount}`);
  }
  return Math.round(amount * 100);
}

export function calculateOntarioSplitBilling(input: SplitBillingInput): SplitBillingResult {
  const { odaFeeAmount, cdcpFeeAmount, coPayTier, isProvincialSecondary } = input;

  if (coPayTier !== 0 && coPayTier !== 40 && coPayTier !== 60) {
    throw new Error(`Invalid CDCP co-pay tier: ${coPayTier as number}. Must be 0, 40, or 60.`);
  }

  const odaFeeCents = dollarsToCents(odaFeeAmount, 'odaFeeAmount');
  const cdcpFeeCents = dollarsToCents(cdcpFeeAmount, 'cdcpFeeAmount');

  const patientCoPayCents = Math.round(cdcpFeeCents * (coPayTier / 100));
  const cdcpApprovedCoverageCents = cdcpFeeCents - patientCoPayCents;

  // Computed unconditionally: even when a provincial secondary means the
  // patient is never billed this gap, the gap itself still exists and must
  // be routed to Accerta, not discarded. Zeroing this before computing the
  // secondary route (the bug this replaced) silently lost the ODA/CDCP
  // differential whenever isProvincialSecondary was true — Accerta was
  // never billed for it, and the practice ate the loss.
  const grossBalanceBillingCents = Math.max(0, odaFeeCents - cdcpFeeCents);
  const balanceBillingCents = isProvincialSecondary ? 0 : grossBalanceBillingCents;

  let totalPatientResponsibilityCents = patientCoPayCents + balanceBillingCents;
  let secondaryRouteAmountCents = 0;

  if (isProvincialSecondary) {
    secondaryRouteAmountCents = patientCoPayCents + grossBalanceBillingCents;
    totalPatientResponsibilityCents = 0;
  }

  return {
    cdcpApprovedCoverageCents,
    patientCoPayCents,
    balanceBillingCents,
    totalPatientResponsibilityCents,
    secondaryRouteAmountCents,
  };
}
