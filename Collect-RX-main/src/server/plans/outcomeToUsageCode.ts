/**
 * Map modern CallOutcome + persisted ClaimStatus → legacy usage outcome codes
 * consumed by usageService.classifyForUsage().
 *
 * AR billing counts only claims CollectRx closes — not in-flight "processing" checks.
 */
import type { CallOutcome, ClaimStatus } from '@prisma/client';

export function callOutcomeToUsageCode(
  callOutcome: CallOutcome,
  claimStatus: ClaimStatus,
  outcomeDetail: string,
): string | null {
  if (
    callOutcome === 'NO_ANSWER' ||
    callOutcome === 'FAILED' ||
    callOutcome === 'HUNG_UP' ||
    callOutcome === 'BLOCK_DETECTED'
  ) {
    return null;
  }

  // Still open at carrier — does not count toward AR resolution limit.
  if (claimStatus === 'IN_QUEUE' || claimStatus === 'CALLING' || claimStatus === 'ON_HOLD') {
    if (callOutcome === 'PENDING') return null;
  }
  if (claimStatus === 'APPROVED_PENDING_PAYMENT') return null;

  if (claimStatus === 'RESOLVED') return 'paid';
  if (claimStatus === 'DENIED') return 'not_covered';

  const detail = outcomeDetail.toLowerCase();

  if (callOutcome === 'DENIED') return 'not_covered';

  if (callOutcome === 'RESOLVED') {
    if (/paid|payment|issued|adjudicated|approved/.test(detail)) return 'paid';
    if (/not covered|non-?covered|excluded|denied/.test(detail)) return 'not_covered';
    if (/maximum|maxed|annual max|benefit limit/.test(detail)) return 'coverage_maxed';
    if (/resubmit|not on file|not received|re-?submit/.test(detail)) return 'resubmit_required';
    if (/processing|pending|in process/.test(detail)) return null;
    return 'paid';
  }

  if (callOutcome === 'PENDING') return null;

  if (callOutcome === 'ESCALATED') {
    if (/resubmit|not on file|not received|re-?submit/.test(detail)) return 'resubmit_required';
    if (/maximum|maxed|annual max|benefit limit/.test(detail)) return 'coverage_maxed';
    if (/not covered|non-?covered|excluded|denied/.test(detail)) return 'not_covered';
    if (/processing|pending|still/.test(detail)) return null;
    return null;
  }

  return null;
}
