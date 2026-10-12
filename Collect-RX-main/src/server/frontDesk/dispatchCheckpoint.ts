import type { CarrierId, DispatchCheckpoint, PrismaClient } from '@prisma/client';
import { DISPATCH_FEATURES, isDispatchFeatureEnabled } from '../featureFlags/dispatchFeatures.js';

/**
 * DEC-9 (b): a staff checkpoint at first use per practice and carrier.
 *
 * Enforcement point is validateDispatch(), so the scheduler and the manual
 * "Call now" route both pass through it. The checkpoint is pure policy about
 * whether a human has signed off on automated calling to this carrier for this
 * practice; it carries no claim data and no PHI.
 */
export const DISPATCH_CHECKPOINT_CODE = 'PENDING_DISPATCH_APPROVAL';

export type CheckpointDecision = 'APPROVED' | 'REVOKED';

export interface CheckpointGuard {
  allowed: boolean;
  code?: typeof DISPATCH_CHECKPOINT_CODE;
  reason?: string;
}

/**
 * Decides whether this practice may dial this carrier. Not enforced while the
 * rollout flag is off. When enforced and not approved, makes sure a PENDING
 * checkpoint exists (and a REQUESTED event the first time) so staff can see
 * what is waiting, then refuses. Creating the request is idempotent and safe
 * under concurrent ticks (unique practice + carrier; duplicate losers re-read).
 */
export async function evaluateDispatchCheckpoint(
  prisma: PrismaClient,
  practiceId: string,
  carrierId: CarrierId,
): Promise<CheckpointGuard> {
  const enforced = await isDispatchFeatureEnabled(prisma, practiceId, DISPATCH_FEATURES.APPROVAL_CHECKPOINT);
  if (!enforced) return { allowed: true };

  const existing = await prisma.dispatchCheckpoint.findUnique({
    where: { practiceId_carrierId: { practiceId, carrierId } },
    select: { status: true },
  });
  if (existing?.status === 'APPROVED') return { allowed: true };

  if (!existing) {
    try {
      await prisma.$transaction(async (tx) => {
        const created = await tx.dispatchCheckpoint.create({ data: { practiceId, carrierId } });
        await tx.dispatchCheckpointEvent.create({
          data: { practiceId, checkpointId: created.id, carrierId, action: 'REQUESTED' },
        });
      });
    } catch (err) {
      // Another tick created it first: that is the same outcome we wanted.
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
  }

  return {
    allowed: false,
    code: DISPATCH_CHECKPOINT_CODE,
    reason:
      existing?.status === 'REVOKED'
        ? `Calls to ${carrierId} were stopped by staff for this practice. Approve the carrier again to resume calling.`
        : `First calls to ${carrierId} for this practice need staff approval. Review and approve the carrier checkpoint to start calling.`,
  };
}

export async function listDispatchCheckpoints(
  prisma: PrismaClient,
  practiceId: string,
): Promise<Array<DispatchCheckpoint & { queuedClaims: number }>> {
  const rows = await prisma.dispatchCheckpoint.findMany({
    where: { practiceId },
    orderBy: [{ status: 'asc' }, { requestedAt: 'asc' }],
  });
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      queuedClaims: await countQueuedClaims(prisma, practiceId, row.carrierId),
    })),
  );
}

async function countQueuedClaims(prisma: PrismaClient, practiceId: string, carrierId: CarrierId): Promise<number> {
  return prisma.callQueue.count({
    where: { practiceId, status: 'PENDING', claim: { carrierId } },
  });
}

export class CheckpointNotFoundError extends Error {
  constructor() {
    super('Checkpoint not found for this practice');
  }
}

export async function decideDispatchCheckpoint(
  prisma: PrismaClient,
  input: {
    practiceId: string;
    checkpointId: string;
    decision: CheckpointDecision;
    decidedByUserId: string;
    notes?: string;
  },
): Promise<DispatchCheckpoint> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.dispatchCheckpoint.findFirst({
      where: { id: input.checkpointId, practiceId: input.practiceId },
    });
    if (!current) throw new CheckpointNotFoundError();
    if (current.status === input.decision) return current;

    const queued = await tx.callQueue.count({
      where: { practiceId: input.practiceId, status: 'PENDING', claim: { carrierId: current.carrierId } },
    });
    const updated = await tx.dispatchCheckpoint.update({
      where: { id: current.id },
      data: {
        status: input.decision,
        decidedByUserId: input.decidedByUserId,
        decidedAt: new Date(),
        notes: input.notes ?? null,
      },
    });
    if (input.decision === 'APPROVED') {
      // Entries parked by the checkpoint retry now rather than after their
      // staff-action deferral window.
      await tx.callQueue.updateMany({
        where: {
          practiceId: input.practiceId,
          status: 'PENDING',
          dispatchDeferralCode: DISPATCH_CHECKPOINT_CODE,
          claim: { carrierId: current.carrierId },
        },
        data: {
          scheduledFor: new Date(),
          dispatchDeferralCode: null,
          dispatchDeferralNextAction: null,
          dispatchDeferredAt: null,
        },
      });
    }
    await tx.dispatchCheckpointEvent.create({
      data: {
        practiceId: input.practiceId,
        checkpointId: current.id,
        carrierId: current.carrierId,
        action: input.decision,
        actorUserId: input.decidedByUserId,
        queuedClaimsAtDecision: queued,
        notes: input.notes ?? null,
      },
    });
    return updated;
  });
}
