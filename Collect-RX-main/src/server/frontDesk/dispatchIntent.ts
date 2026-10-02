import type { CallAttempt, CallDispatchIntent, PrismaClient } from '@prisma/client';

export const DISPATCH_INTENT_RECONCILE_AFTER_MS = 5 * 60 * 1000;

export async function ensureDispatchIntent(
  prisma: PrismaClient,
  input: { practiceId: string; claimId: string; queueEntryId: string; attemptNumber: number },
): Promise<CallDispatchIntent> {
  const idempotencyKey = `carrier-call:${input.queueEntryId}:${input.attemptNumber}`;
  const existing = await prisma.callDispatchIntent.upsert({
    where: { queueEntryId_attemptNumber: { queueEntryId: input.queueEntryId, attemptNumber: input.attemptNumber } },
    create: { ...input, idempotencyKey, status: 'READY' },
    update: {},
  });
  if (existing.status !== 'FAILED') return existing;
  // FAILED is only assigned to a confirmed rejection or an intent that never
  // crossed the network boundary. Those states are safe to retry with the same
  // stable vendor idempotency key. Every uncertain/confirmed state stays held.
  return prisma.callDispatchIntent.update({
    where: { id: existing.id, status: 'FAILED' },
    data: { status: 'READY', failureCode: null, sendStartedAt: null, reconciledAt: null },
  });
}

export async function markDispatchSending(
  prisma: PrismaClient,
  intentId: string,
): Promise<CallDispatchIntent> {
  return prisma.callDispatchIntent.update({
    where: { id: intentId, status: 'READY' },
    data: { status: 'SENDING', sendStartedAt: new Date(), failureCode: null },
  });
}

export async function recordAmbiguousDispatch(
  prisma: PrismaClient,
  input: { intentId: string; queueEntryId: string; failureCode: string },
): Promise<void> {
  await prisma.$transaction([
    prisma.callDispatchIntent.update({
      where: { id: input.intentId },
      data: { status: 'AMBIGUOUS', failureCode: input.failureCode },
    }),
    prisma.callQueue.update({
      where: { id: input.queueEntryId },
      data: {
        status: 'BLOCKED',
        dispatchDeferralCode: 'VAPI_DISPATCH_OUTCOME_UNKNOWN',
        dispatchDeferralNextAction: 'Reconcile this intent with Vapi before retrying; automatic redial is disabled.',
        dispatchDeferredAt: new Date(),
      },
    }),
  ]);
}

export async function recordRejectedDispatch(
  prisma: PrismaClient,
  input: { intentId: string; queueEntryId: string; retryAt: Date },
): Promise<void> {
  await prisma.$transaction([
    prisma.callDispatchIntent.update({
      where: { id: input.intentId },
      data: { status: 'FAILED', failureCode: 'VAPI_REJECTED', reconciledAt: new Date() },
    }),
    prisma.callQueue.update({
      where: { id: input.queueEntryId },
      data: {
        status: 'PENDING', scheduledFor: input.retryAt,
        dispatchDeferralCode: 'TRANSIENT_DISPATCH_FAILURE',
        dispatchDeferralNextAction: 'The system will create a new attempt during the next scheduled dispatch window.',
        dispatchDeferredAt: new Date(),
      },
    }),
  ]);
}

export async function confirmDispatch(
  prisma: PrismaClient,
  input: { intentId: string; queueEntryId: string; claimId: string; vapiCallId: string },
): Promise<CallAttempt> {
  return prisma.$transaction(async (tx) => {
    const intent = await tx.callDispatchIntent.update({
      where: { id: input.intentId, status: 'SENDING' },
      data: { status: 'CONFIRMED', vapiCallId: input.vapiCallId, confirmedAt: new Date(), reconciledAt: new Date() },
    });
    const attempt = await tx.callAttempt.create({
      data: {
        claimId: input.claimId, vapiCallId: input.vapiCallId,
        dispatchIntentId: intent.id, initiatedAt: new Date(), liveState: 'dialing', activeAgent: 'IVR_Navigator',
      },
    });
    await tx.insuranceClaim.update({ where: { id: input.claimId }, data: { status: 'CALLING' } });
    await tx.callQueue.update({
      where: { id: input.queueEntryId },
      data: {
        status: 'IN_PROGRESS', attempts: { increment: 1 }, lastAttemptAt: new Date(),
        dispatchDeferralCode: null, dispatchDeferralNextAction: null, dispatchDeferredAt: null,
      },
    });
    return attempt;
  });
}

export async function reconcileStaleDispatchIntents(
  prisma: PrismaClient,
  now = new Date(),
): Promise<{ safeExpired: number; heldAmbiguous: number }> {
  const staleBefore = new Date(now.getTime() - DISPATCH_INTENT_RECONCILE_AFTER_MS);
  const stale = await prisma.callDispatchIntent.findMany({
    where: { status: { in: ['READY', 'SENDING'] }, updatedAt: { lt: staleBefore } },
    select: { id: true, queueEntryId: true, status: true },
  });
  let safeExpired = 0;
  let heldAmbiguous = 0;
  for (const intent of stale) {
    if (intent.status === 'READY') {
      await prisma.callDispatchIntent.update({
        where: { id: intent.id, status: 'READY' },
        data: { status: 'FAILED', failureCode: 'EXPIRED_BEFORE_SEND', reconciledAt: now },
      });
      safeExpired += 1;
    } else {
      await recordAmbiguousDispatch(prisma, {
        intentId: intent.id, queueEntryId: intent.queueEntryId, failureCode: 'PROCESS_EXIT_DURING_SEND',
      });
      heldAmbiguous += 1;
    }
  }
  return { safeExpired, heldAmbiguous };
}
