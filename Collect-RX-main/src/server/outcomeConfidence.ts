// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Anti-hallucination confidence gate for financial outcomes.
//
// This platform acts on people's money and insurance reimbursements. A claim
// status like RESOLVED, DENIED, or APPROVED_PENDING_PAYMENT is a FINANCIAL-TERMINAL
// decision: it stops further follow-up, can trigger EMR/payment events, and changes
// what the practice tells the patient.
//
// Such a status must NEVER be auto-finalized from a keyword/regex guess over a
// (possibly mis-transcribed) phone transcript. Instead the system applies a
// "self-questioning" check: do I actually have corroboration for this financial
// result? If not, it downgrades to ESCALATED and asks a human to verify, rather
// than silently acting on an unconfirmed amount.
//
// Corroboration = either:
//   (a) a validated structured payload from the carrier-call assistant
//       (metadata.collectrx / analysis.collectrx, schemaVersion-checked), or
//   (b) a captured carrier reference / confirmation number for the call.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClaimStatus } from '@prisma/client';

/**
 * Statuses that finalize a claim's financial state. Reaching one of these stops
 * automated follow-up and may emit downstream payment/EMR events, so they must be
 * corroborated before they are trusted.
 */
export const FINANCIAL_TERMINAL_STATUSES: ReadonlySet<ClaimStatus> = new Set<ClaimStatus>([
  'RESOLVED',
  'DENIED',
  'APPROVED_PENDING_PAYMENT',
]);

export interface OutcomeCorroboration {
  /** A schema-validated structured payload was present on the webhook (high trust). */
  hasStructuredPayload: boolean;
  /** Carrier reference / confirmation number captured during the call, if any. */
  referenceNumber?: string | null;
}

export interface GatedOutcome {
  /** The status to persist. Equals `proposed` unless it was held for review. */
  status: ClaimStatus;
  /** True when a financial-terminal status was downgraded to ESCALATED pending a human. */
  requiresHumanVerification: boolean;
  /** Human-readable reason when held; null otherwise. */
  reason: string | null;
}

const MIN_REFERENCE_LENGTH = 4;

/** Is the proposed financial result backed by a trustworthy signal? */
export function hasFinancialCorroboration(c: OutcomeCorroboration): boolean {
  if (c.hasStructuredPayload) return true;
  const ref = (c.referenceNumber ?? '').trim();
  return ref.length >= MIN_REFERENCE_LENGTH;
}

export function isFinancialTerminal(status: ClaimStatus): boolean {
  return FINANCIAL_TERMINAL_STATUSES.has(status);
}

/**
 * Gate a proposed claim status. Non-financial statuses pass through unchanged.
 * Financial-terminal statuses pass through only when corroborated; otherwise they
 * are downgraded to ESCALATED and flagged for human verification.
 */
export function gateFinancialOutcome(
  proposed: ClaimStatus,
  c: OutcomeCorroboration,
): GatedOutcome {
  if (!isFinancialTerminal(proposed)) {
    return { status: proposed, requiresHumanVerification: false, reason: null };
  }
  if (hasFinancialCorroboration(c)) {
    return { status: proposed, requiresHumanVerification: false, reason: null };
  }
  return {
    status: 'ESCALATED',
    requiresHumanVerification: true,
    reason:
      `Outcome "${proposed}" was inferred from the call transcript with no structured carrier ` +
      `confirmation and no reference number. Held for human verification to avoid acting on an ` +
      `unconfirmed financial result.`,
  };
}
