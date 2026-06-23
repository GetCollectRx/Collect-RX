// ─────────────────────────────────────────────────────────────────────────────
// Map Vapi call outcome → persisted InsuranceClaim.status (Prisma enum).
// Approved-but-unpaid uses first-class APPROVED_PENDING_PAYMENT when detectable.
//
// When `structuredClaimStatus` is set (from `metadata.collectrx` / `analysis.collectrx`),
// it wins — no text parsing. Otherwise `isApprovedPendingPaymentFromCallDetail` (regex) applies.
// ─────────────────────────────────────────────────────────────────────────────

import type { CallOutcome, ClaimStatus } from '@prisma/client';
import { isApprovedPendingPaymentFromCallDetail } from './services/priorityEngine.js';
import { gateFinancialOutcome, type OutcomeCorroboration } from './outcomeConfidence.js';

/**
 * Map a call outcome to a persisted claim status.
 *
 * When `corroboration` is supplied, financial-terminal statuses (RESOLVED / DENIED /
 * APPROVED_PENDING_PAYMENT) that were merely inferred from the transcript — without a
 * structured carrier payload or reference number — are downgraded to ESCALATED so a
 * human verifies them before the platform acts on the money. Omitting `corroboration`
 * preserves the previous (ungated) behaviour for backward compatibility.
 */
export function claimStatusFromCallOutcome(
  outcome: CallOutcome,
  outcomeDetail: string,
  outstandingCents: number,
  structuredClaimStatus?: ClaimStatus | null,
  corroboration?: OutcomeCorroboration,
): ClaimStatus {
  const resolved = resolveRawStatus(outcome, outcomeDetail, outstandingCents, structuredClaimStatus);
  if (!corroboration) return resolved;
  // A schema-validated structured status is itself corroboration.
  const c: OutcomeCorroboration = structuredClaimStatus
    ? { ...corroboration, hasStructuredPayload: true }
    : corroboration;
  return gateFinancialOutcome(resolved, c).status;
}

function resolveRawStatus(
  outcome: CallOutcome,
  outcomeDetail: string,
  outstandingCents: number,
  structuredClaimStatus?: ClaimStatus | null,
): ClaimStatus {
  if (structuredClaimStatus) {
    return structuredClaimStatus;
  }
  switch (outcome) {
    case 'RESOLVED':
      if (isApprovedPendingPaymentFromCallDetail(outcomeDetail, outstandingCents)) {
        return 'APPROVED_PENDING_PAYMENT';
      }
      return 'RESOLVED';
    case 'DENIED':
      return 'DENIED';
    case 'ESCALATED':
      return 'ESCALATED';
    case 'BLOCK_DETECTED':
      return 'BLOCKED';
    case 'PENDING':
      return 'IN_QUEUE';
    case 'FAILED':
    case 'NO_ANSWER':
    case 'HUNG_UP':
      return 'IN_QUEUE';
    default:
      return 'IN_QUEUE';
  }
}
