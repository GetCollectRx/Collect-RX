import type { CarrierId, PrismaClient } from '@prisma/client';
import { createEscalation } from '../services/escalationService.js';

/**
 * A dial whose outcome we cannot establish must never be released back to the
 * automatic queue: the next tick would call the carrier again, and a vendor
 * idempotency key is not something this code may rely on (it has not been
 * verified). Two cases land here:
 *
 *   VAPI_DISPATCH_OUTCOME_UNKNOWN  the create request timed out or the network
 *                                  failed, so a call may or may not exist
 *   VAPI_CALL_NOT_CANCELLED        the call was created, but it could not be
 *                                  recorded and the request to end it failed, so
 *                                  a live call may be running with no record
 *
 * The claim and its queue entry leave the automatic pool, the possible attempt
 * is counted, and an open escalation tells staff exactly what to check. Nothing
 * here dials, and nothing resumes automatic dialing: a person decides.
 */
export type UnresolvedCallKind = 'VAPI_DISPATCH_OUTCOME_UNKNOWN' | 'VAPI_CALL_NOT_CANCELLED';

const NEXT_ACTION: Record<UnresolvedCallKind, string> = {
  VAPI_DISPATCH_OUTCOME_UNKNOWN:
    'Vapi did not confirm whether this call was placed. Check the Vapi dashboard for a call on this claim before calling again. Automatic retries are off for this claim until you resolve the escalation.',
  VAPI_CALL_NOT_CANCELLED:
    'A call was created but could not be recorded or ended. End it in the Vapi dashboard, then handle the claim manually. Automatic retries are off for this claim.',
};

function escalationReason(kind: UnresolvedCallKind, vapiCallId?: string): string {
  return kind === 'VAPI_CALL_NOT_CANCELLED' && vapiCallId
    ? `${NEXT_ACTION[kind]} Vapi call id: ${vapiCallId}.`
    : NEXT_ACTION[kind];
}

export async function holdClaimForUnresolvedCall(
  prisma: PrismaClient,
  input: {
    practiceId: string;
    claimId: string;
    /** Null when only the claim id is known (the manual route). */
    queueEntryId: string | null;
    claimNumber: string;
    carrierId: CarrierId;
    outstandingAmount: unknown;
    kind: UnresolvedCallKind;
    vapiCallId?: string;
    /** True when the attempt has not been counted yet (the scheduler counts after the dial). */
    countAttempt: boolean;
    attemptNumber: number;
  },
): Promise<void> {
  const queueData = {
    status: 'ESCALATED' as const,
    lastAttemptAt: new Date(),
    dispatchDeferralCode: input.kind,
    dispatchDeferralNextAction: NEXT_ACTION[input.kind],
    dispatchDeferredAt: new Date(),
    ...(input.countAttempt ? { attempts: { increment: 1 } } : {}),
  };
  await prisma.$transaction([
    prisma.insuranceClaim.update({ where: { id: input.claimId }, data: { status: 'ESCALATED' } }),
    input.queueEntryId
      ? prisma.callQueue.update({ where: { id: input.queueEntryId }, data: queueData })
      : prisma.callQueue.updateMany({ where: { claimId: input.claimId }, data: queueData }),
  ]);
  const reason = escalationReason(input.kind, input.vapiCallId);
  const existing = await prisma.callEscalation.findFirst({
    where: { practiceId: input.practiceId, claimId: input.claimId, status: 'open', reason },
    select: { id: true },
  });
  if (!existing) {
    await createEscalation(prisma, {
      practiceId: input.practiceId,
      claimId: input.claimId,
      claimRef: input.claimNumber,
      carrierId: input.carrierId,
      amountClaimedCents: Math.round(Number(input.outstandingAmount) * 100),
      reason,
      attemptNumber: input.attemptNumber,
    });
  }
}
