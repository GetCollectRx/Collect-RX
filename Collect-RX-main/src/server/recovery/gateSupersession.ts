import type { RecoveryActionType } from '@prisma/client';
import type { RecoveryDecision } from './types.js';
import { extractLegacyOutcomeCode } from './legacyOutcomeCode.js';

/**
 * Whether an existing BLOCKING gate should be cleared when a new call outcome arrives.
 * Non-blocking OPEN actions are always cleared separately.
 */
export function shouldSupersedeBlockingGate(
  actionType: RecoveryActionType,
  decision: RecoveryDecision,
  outcomeDetail: string | null | undefined,
): boolean {
  const legacy = extractLegacyOutcomeCode(outcomeDetail);

  // New explicit recovery action replaces any prior blocking gate of a different type.
  if (
    decision.recoveryActionType &&
    decision.recoveryActionType !== actionType &&
    decision.actionTitle
  ) {
    return true;
  }

  // Same gate type re-created (e.g. updated detail) — replace prior row.
  if (decision.recoveryActionType === actionType && decision.actionTitle) {
    return true;
  }

  if (actionType === 'PRACTICE_RESUBMIT' || actionType === 'PRACTICE_DOCS') {
    return (
      legacy === 'processing' ||
      (decision.route === 'STOP' &&
        (decision.claimStatus === 'RESOLVED' || decision.claimStatus === 'DENIED'))
    );
  }

  if (actionType === 'HUMAN_ESCALATION') {
    return decision.claimStatus === 'RESOLVED' || decision.claimStatus === 'DENIED';
  }

  if (actionType === 'CDCP_RECONSIDERATION') {
    return false;
  }

  if (actionType === 'PAYMENT_VERIFY_SYNC') {
    return decision.route === 'CALL_CARRIER' && legacy === 'processing';
  }

  return false;
}

/** Whether an OPEN (non-blocking) recovery action should be cleared on a new call outcome. */
export function shouldSupersedeOpenAction(
  actionType: RecoveryActionType,
  decision: RecoveryDecision,
): boolean {
  if (actionType === 'PROCESSING_RECALL') {
    return (
      decision.recoveryActionType === 'PROCESSING_RECALL' ||
      (decision.route === 'CALL_CARRIER' && decision.recoveryActionType !== 'PAYMENT_VERIFY_SYNC')
    );
  }

  if (actionType === 'PAYMENT_VERIFY_SYNC') {
    return (
      decision.route === 'STOP' ||
      decision.claimStatus === 'RESOLVED' ||
      decision.recoveryActionType === 'PAYMENT_TRACE'
    );
  }

  if (actionType === 'PAYMENT_TRACE') {
    return decision.route === 'STOP' || decision.claimStatus === 'RESOLVED';
  }

  if (decision.recoveryActionType && decision.recoveryActionType !== actionType) {
    return true;
  }

  return false;
}

/** Hold decision while an uncleared practice gate remains — do not mutate actions. */
export function isPracticeGateHoldDecision(decision: RecoveryDecision): boolean {
  return (
    decision.route === 'PRACTICE_GATE' &&
    decision.stopCalling &&
    !decision.recoveryActionType &&
    decision.claimStatus === 'ON_HOLD'
  );
}
