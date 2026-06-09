import type { ClaimStatus, PrismaClient, RecoveryRoute, Prisma } from '@prisma/client';
import { routeForSyncPaymentVerified } from './claimRouter.js';
import { enqueueEmrClaimEvent } from '../emrSyncOutbox.js';

export type RecoveryTransitionKind =
  | 'GATE_CLEARED'
  | 'MANUAL_PAYMENT_CONFIRMED'
  | 'MANUAL_ESCALATION_RESOLVED'
  | 'PAYMENT_VERIFIED_SYNC';

export interface TransitionClaimRecoveryInput {
  practiceId: string;
  claimId: string;
  kind: RecoveryTransitionKind;
  /** Required for GATE_CLEARED */
  actionId?: string;
  paymentAmountCents?: number;
  notes?: string;
  resolvedBy?: string;
  /** Required for PAYMENT_VERIFIED_SYNC */
  previousOutstanding?: number;
  newOutstanding?: number;
  amountRecoveredCents?: number;
}

export interface TransitionClaimRecoveryResult {
  claimId: string;
  claimStatus: ClaimStatus;
  recoveryRoute: RecoveryRoute | null;
  outstandingAmount: number;
  scheduledRecallAt: Date | null;
  eventType: string;
}

async function emitRecoveryEvent(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    claimId: string;
    eventType: string;
    amountRecoveredCents?: number;
    previousOutstanding?: number;
    newOutstanding?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await prisma.claimRecoveryEvent.create({
    data: {
      practiceId: params.practiceId,
      claimId: params.claimId,
      eventType: params.eventType,
      amountRecoveredCents: params.amountRecoveredCents ?? null,
      previousOutstanding: params.previousOutstanding ?? null,
      newOutstanding: params.newOutstanding ?? null,
      metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

async function clearAllOpenRecoveryActions(prisma: PrismaClient, claimId: string): Promise<void> {
  await prisma.claimRecoveryAction.updateMany({
    where: { claimId, status: { in: ['OPEN', 'BLOCKING'] }, clearedAt: null },
    data: { status: 'CLEARED', clearedAt: new Date() },
  });
}

/**
 * Single entry point for staff-driven and sync-driven recovery state changes.
 */
export async function transitionClaimRecovery(
  prisma: PrismaClient,
  input: TransitionClaimRecoveryInput,
): Promise<TransitionClaimRecoveryResult> {
  const claim = await prisma.insuranceClaim.findUnique({
    where: { id: input.claimId },
    include: { queueEntry: true },
  });
  if (!claim || claim.practiceId !== input.practiceId) {
    throw new Error('Claim not found');
  }

  const now = new Date();

  if (input.kind === 'GATE_CLEARED') {
    if (!input.actionId) throw new Error('actionId required');

    const action = await prisma.claimRecoveryAction.findFirst({
      where: {
        id: input.actionId,
        claimId: input.claimId,
        practiceId: input.practiceId,
        status: 'BLOCKING',
      },
    });
    if (!action) throw new Error('Recovery gate not found');

    const recallAt =
      action.actionType === 'PRACTICE_RESUBMIT'
        ? new Date(Date.now() + 14 * 86_400_000)
        : new Date(Date.now() + 24 * 3_600_000);

    await prisma.$transaction([
      prisma.claimRecoveryAction.update({
        where: { id: action.id },
        data: { status: 'CLEARED', clearedAt: now },
      }),
      prisma.insuranceClaim.update({
        where: { id: input.claimId },
        data: { status: 'IN_QUEUE', recoveryRoute: 'CALL_CARRIER' },
      }),
      prisma.callQueue.updateMany({
        where: { claimId: input.claimId },
        data: { status: 'PENDING', scheduledFor: recallAt },
      }),
    ]);

    await emitRecoveryEvent(prisma, {
      practiceId: input.practiceId,
      claimId: input.claimId,
      eventType: 'GATE_CLEARED',
      metadata: {
        actionId: action.id,
        actionType: action.actionType,
        scheduledRecallAt: recallAt.toISOString(),
      },
    });

    return {
      claimId: input.claimId,
      claimStatus: 'IN_QUEUE',
      recoveryRoute: 'CALL_CARRIER',
      outstandingAmount: Number(claim.outstandingAmount),
      scheduledRecallAt: recallAt,
      eventType: 'GATE_CLEARED',
    };
  }

  if (input.kind === 'MANUAL_PAYMENT_CONFIRMED') {
    let remaining = Number(claim.outstandingAmount);
    if (typeof input.paymentAmountCents === 'number' && input.paymentAmountCents > 0) {
      remaining = Math.max(0, Math.round((remaining - input.paymentAmountCents / 100) * 100) / 100);
    } else {
      remaining = 0;
    }

    const fullyPaid = remaining <= 0.009;
    const newStatus: ClaimStatus = fullyPaid ? 'RESOLVED' : claim.status;
    const newRoute: RecoveryRoute | null = fullyPaid ? 'STOP' : claim.recoveryRoute;

    await prisma.insuranceClaim.update({
      where: { id: input.claimId },
      data: {
        outstandingAmount: remaining,
        status: newStatus,
        recoveryRoute: newRoute,
        paymentExpectedBy: fullyPaid ? null : claim.paymentExpectedBy,
      },
    });

    if (fullyPaid) {
      await clearAllOpenRecoveryActions(prisma, input.claimId);
      await prisma.callQueue.updateMany({
        where: { claimId: input.claimId },
        data: { status: 'COMPLETED' },
      });
    }

    const recoveredCents = fullyPaid
      ? Math.round((Number(claim.outstandingAmount) - remaining) * 100)
      : input.paymentAmountCents;

    await emitRecoveryEvent(prisma, {
      practiceId: input.practiceId,
      claimId: input.claimId,
      eventType: 'MANUAL_PAYMENT_CONFIRMED',
      amountRecoveredCents: recoveredCents ?? undefined,
      previousOutstanding: Number(claim.outstandingAmount),
      newOutstanding: remaining,
      metadata: { notes: input.notes ?? null, fullyPaid },
    });

    if (fullyPaid) {
      try {
        await enqueueEmrClaimEvent(prisma, {
          practiceId: input.practiceId,
          claimId: input.claimId,
          eventType: 'PAYMENT_CONFIRMED',
          payload: {
            notes: input.notes ?? null,
            at: now.toISOString(),
            outstandingAfter: remaining,
          },
        });
      } catch (emrErr) {
        console.error('[transitionClaimRecovery] EMR outbox:', emrErr);
      }
    }

    return {
      claimId: input.claimId,
      claimStatus: newStatus,
      recoveryRoute: newRoute,
      outstandingAmount: remaining,
      scheduledRecallAt: claim.queueEntry?.scheduledFor ?? null,
      eventType: 'MANUAL_PAYMENT_CONFIRMED',
    };
  }

  if (input.kind === 'MANUAL_ESCALATION_RESOLVED') {
    const resolutionNote = [
      'Resolved via human call after AI escalation.',
      input.resolvedBy ? `Resolved by: ${input.resolvedBy}.` : '',
      input.notes ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    await prisma.insuranceClaim.update({
      where: { id: input.claimId },
      data: { status: 'RESOLVED', recoveryRoute: 'STOP' },
    });

    await clearAllOpenRecoveryActions(prisma, input.claimId);
    await prisma.callQueue.updateMany({
      where: { claimId: input.claimId },
      data: { status: 'COMPLETED' },
    });

    await emitRecoveryEvent(prisma, {
      practiceId: input.practiceId,
      claimId: input.claimId,
      eventType: 'MANUAL_ESCALATION_RESOLVED',
      metadata: { notes: resolutionNote, resolvedBy: input.resolvedBy ?? null },
    });

    try {
      await enqueueEmrClaimEvent(prisma, {
        practiceId: input.practiceId,
        claimId: input.claimId,
        eventType: 'PAYMENT_CONFIRMED',
        payload: {
          notes: resolutionNote,
          at: now.toISOString(),
          resolvedByHuman: true,
          outstandingAfter: Number(claim.outstandingAmount),
        },
      });
    } catch (emrErr) {
      console.error('[transitionClaimRecovery] EMR outbox:', emrErr);
    }

    return {
      claimId: input.claimId,
      claimStatus: 'RESOLVED',
      recoveryRoute: 'STOP',
      outstandingAmount: Number(claim.outstandingAmount),
      scheduledRecallAt: null,
      eventType: 'MANUAL_ESCALATION_RESOLVED',
    };
  }

  if (input.kind === 'PAYMENT_VERIFIED_SYNC') {
    const previousOutstanding = input.previousOutstanding ?? Number(claim.outstandingAmount);
    const newOutstanding = input.newOutstanding ?? 0;
    const amountRecoveredCents =
      input.amountRecoveredCents ?? Math.round((previousOutstanding - newOutstanding) * 100);

    const route = routeForSyncPaymentVerified();
    await prisma.$transaction([
      prisma.insuranceClaim.update({
        where: { id: input.claimId },
        data: {
          status: route.claimStatus,
          recoveryRoute: route.route,
          outstandingAmount: newOutstanding,
          paymentExpectedBy: null,
        },
      }),
      prisma.callQueue.updateMany({
        where: { claimId: input.claimId },
        data: { status: route.queueStatus },
      }),
    ]);
    await clearAllOpenRecoveryActions(prisma, input.claimId);

    await emitRecoveryEvent(prisma, {
      practiceId: input.practiceId,
      claimId: input.claimId,
      eventType: 'PAYMENT_VERIFIED_SYNC',
      amountRecoveredCents,
      previousOutstanding,
      newOutstanding,
      metadata: { reason: route.reason },
    });

    return {
      claimId: input.claimId,
      claimStatus: route.claimStatus,
      recoveryRoute: route.route,
      outstandingAmount: newOutstanding,
      scheduledRecallAt: null,
      eventType: 'PAYMENT_VERIFIED_SYNC',
    };
  }

  throw new Error(`Unknown recovery transition: ${String(input.kind)}`);
}
