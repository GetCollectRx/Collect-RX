import type { ClaimStatus, PrismaClient, QueueStatus } from '@prisma/client';

export interface ManualDispatchReservation {
  claimStatus: ClaimStatus;
  queue: {
    attempts: number;
    status: QueueStatus;
    lastAttemptAt: Date | null;
    dispatchDeferralCode: string | null;
    dispatchDeferralNextAction: string | null;
    dispatchDeferredAt: Date | null;
  } | null;
}

/**
 * Compensates the external call before returning the local dispatch slot to its
 * exact pre-dispatch state. The restore is one transaction so claim and queue
 * cannot diverge if the attempt row was not persisted.
 *
 * The slot is restored only when the request to end the call was accepted. If
 * ending it failed, a live call may exist with no record of it, and putting the
 * claim back in the pool would let it be dialed again; the caller must hold it
 * for staff instead (see dispatchUnresolved.ts).
 */
export async function compensateFailedManualDispatch(
  prisma: PrismaClient,
  params: {
    claimId: string;
    vapiCallId: string;
    reservation: ManualDispatchReservation;
    terminateCall: (vapiCallId: string) => Promise<void>;
  },
): Promise<{ terminationError: unknown | null; restored: boolean }> {
  let terminationError: unknown | null = null;
  try {
    await params.terminateCall(params.vapiCallId);
  } catch (error) {
    terminationError = error;
  }

  if (terminationError !== null) return { terminationError, restored: false };

  await prisma.$transaction(async (tx) => {
    await tx.insuranceClaim.update({
      where: { id: params.claimId },
      data: { status: params.reservation.claimStatus },
    });

    if (params.reservation.queue) {
      await tx.callQueue.update({
        where: { claimId: params.claimId },
        data: params.reservation.queue,
      });
      return;
    }

    await tx.callQueue.deleteMany({ where: { claimId: params.claimId } });
  });

  return { terminationError, restored: true };
}
