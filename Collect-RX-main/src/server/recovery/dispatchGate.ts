import type { PrismaClient } from '@prisma/client';

export interface RecoveryDispatchGate {
  allowed: boolean;
  reason?: string;
}

/**
 * Blocks carrier dispatch when recovery router says stop, gate uncleared, or recall not due.
 */
export async function checkRecoveryDispatchGate(
  prisma: PrismaClient,
  claimId: string,
  scheduledFor?: Date,
): Promise<RecoveryDispatchGate> {
  const claim = await prisma.insuranceClaim.findUnique({
    where: { id: claimId },
    select: {
      recoveryRoute: true,
      status: true,
      queueEntry: { select: { scheduledFor: true, status: true } },
    },
  });
  if (!claim) return { allowed: false, reason: 'Claim not found' };

  if (
    claim.recoveryRoute === 'STOP' ||
    claim.recoveryRoute === 'WAIT_SYNC' ||
    claim.recoveryRoute === 'OPEN_CDCP' ||
    claim.recoveryRoute === 'PRACTICE_GATE'
  ) {
    return {
      allowed: false,
      reason: `Recovery route is ${claim.recoveryRoute} — carrier dial not permitted until route changes.`,
    };
  }

  if (claim.status === 'ESCALATED' && claim.recoveryRoute !== 'CALL_CARRIER') {
    return {
      allowed: false,
      reason: 'Claim escalated — clear recovery gate or resolve manually before automated carrier dial.',
    };
  }

  const blockingGate = await prisma.claimRecoveryAction.findFirst({
    where: {
      claimId,
      status: 'BLOCKING',
      clearedAt: null,
    },
    select: { title: true, actionType: true },
  });
  if (blockingGate) {
    const actionLabel = blockingGate.actionType
      ? blockingGate.actionType.replace(/_/g, ' ').toLowerCase()
      : 'practice gate';
    return {
      allowed: false,
      reason: `Blocking recovery action (${actionLabel}): ${blockingGate.title}. Clear gate before calling.`,
    };
  }

  if (claim.status === 'ON_HOLD') {
    return {
      allowed: false,
      reason: 'Claim on hold — clear recovery gate before calling.',
    };
  }

  const recallAt = claim.queueEntry?.scheduledFor ?? scheduledFor;
  if (recallAt && recallAt.getTime() > Date.now()) {
    return {
      allowed: false,
      reason: `Re-call scheduled for ${recallAt.toISOString()} — not yet due.`,
    };
  }

  return { allowed: true };
}
