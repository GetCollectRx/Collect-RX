// ─────────────────────────────────────────────────────────────────────────────
// Map Vapi call outcome → persisted InsuranceClaim.status (Prisma enum).
// Approved-but-unpaid uses first-class APPROVED_PENDING_PAYMENT when detectable.
//
// When `structuredClaimStatus` is set (from `metadata.collectrx` / `analysis.collectrx`),
// it wins — no text parsing. Otherwise `isApprovedPendingPaymentFromCallDetail` (regex) applies.
// ─────────────────────────────────────────────────────────────────────────────

import type { CallOutcome, ClaimStatus } from '@prisma/client';
import { isApprovedPendingPaymentFromCallDetail } from './services/priorityEngine.js';

export function claimStatusFromCallOutcome(
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
