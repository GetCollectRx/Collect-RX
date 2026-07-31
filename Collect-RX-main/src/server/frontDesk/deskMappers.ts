import type { CallQueue, CarrierBlockEvent, InsuranceClaim, CallAttempt, CallTranscriptLine, ClaimPriority } from '@prisma/client'
import type { DeskActiveCall, DeskQueueEntry, DeskTranscriptLine, LiveCallState, ActiveAgent } from '../../types/frontDesk.js'

const PRIORITY_RANK: Record<ClaimPriority, number> = {
  URGENT: 0,
  HIGH: 25,
  NORMAL: 100,
  LOW: 150,
};

export function priorityToNumber(p: ClaimPriority): number {
  return PRIORITY_RANK[p] ?? 100;
}

export function claimRef(claimNumber: string): string {
  return claimNumber.startsWith('CRX-') ? claimNumber : `CRX-${claimNumber}`;
}

export function mapActiveCall(
  attempt: CallAttempt,
  claim: Pick<InsuranceClaim, 'id' | 'practiceId' | 'carrierId' | 'claimNumber' | 'outstandingAmount'>,
  attemptsMade: number,
): DeskActiveCall {
  return {
    id: attempt.id,
    practiceId: claim.practiceId,
    claimId: claim.id,
    claimRef: claimRef(claim.claimNumber),
    carrierId: claim.carrierId,
    attemptNumber: attemptsMade,
    state: (attempt.liveState as LiveCallState) ?? 'dialing',
    activeAgent: (attempt.activeAgent as ActiveAgent | null) ?? null,
    vapiCallId: attempt.vapiCallId,
    amountClaimedCents: Math.round(Number(claim.outstandingAmount) * 100),
    startedAt: attempt.initiatedAt.toISOString(),
    pausedByStaffAt: attempt.pausedByStaffAt?.toISOString() ?? null,
    takenOverByStaffAt: attempt.takenOverByStaffAt?.toISOString() ?? null,
  };
}

export function mapQueueEntry(
  row: CallQueue & {
    claim: Pick<InsuranceClaim, 'claimNumber' | 'carrierId' | 'outstandingAmount'>;
  },
): DeskQueueEntry {
  return {
    id: row.id,
    practiceId: row.practiceId,
    claimId: row.claimId,
    claimRef: claimRef(row.claim.claimNumber),
    carrierId: row.claim.carrierId,
    amountClaimedCents: Math.round(Number(row.claim.outstandingAmount) * 100),
    priority: priorityToNumber(row.priority),
    attemptsMade: row.attempts,
    heldForCarrierBlock: row.status === 'BLOCKED',
  heldReason: row.dispatchDeferralNextAction ?? (row.status === 'BLOCKED' ? 'Carrier block active' : null),
  dispatchDeferralCode: row.dispatchDeferralCode,
  dispatchDeferralNextAction: row.dispatchDeferralNextAction,
  dispatchDeferredAt: row.dispatchDeferredAt?.toISOString() ?? null,
    scheduledAfter: row.scheduledFor.toISOString(),
    addedAt: row.createdAt.toISOString(),
  };
}

export function mapTranscriptLine(row: CallTranscriptLine, callId: string): DeskTranscriptLine {
  return {
    id: row.id,
    callId,
    speaker: row.speaker as DeskTranscriptLine['speaker'],
    agentName: (row.agentName as ActiveAgent | null) ?? null,
    text: row.text,
    timestamp: row.recordedAt.toISOString(),
  };
}

export function mapCarrierBlock(
  block: CarrierBlockEvent,
  heldQueueCount: number,
): {
  id: string;
  carrierId: typeof block.carrierId;
  blockedAt: string;
  blockedByCallId: string | null;
  reason: string;
  heldQueueCount: number;
} {
  return {
    id: block.id,
    carrierId: block.carrierId,
    blockedAt: block.blockedAt.toISOString(),
    blockedByCallId: null,
    reason: block.notes ?? 'Carrier automation detected',
    heldQueueCount,
  };
}
