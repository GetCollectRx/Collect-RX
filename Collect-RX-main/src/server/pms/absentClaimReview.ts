import type { CarrierId, PrismaClient } from '@prisma/client';
import {
  ABSENT_CONFIRMED_RESOLVED_EVENT,
  ABSENT_FROM_EXPORT_EVENT,
  ABSENT_RESTORED_BY_STAFF_EVENT,
  restoreRouteFrom,
} from './absentClaimHandler.js';
import { syncEligibleCallQueueForPractice, syncWorkItemsForPractice } from '../services/workQueueService.js';

/**
 * Claims a confirmed full export did not list. Calls to them are paused (route
 * STOP). Nothing resumes or closes them on a timer: silence is not evidence a
 * claim was paid, so only staff (or the claim reappearing with a balance in a
 * later export) moves them.
 *
 * "Awaiting staff" is derived, not stored: the claim's newest recovery event is
 * still ABSENT_FROM_FULL_EXPORT. Staff decisions append a newer event.
 */

export type AbsentDecision = 'RESOLVED' | 'RESTORE';

export interface AwaitingClaim {
  id: string;
  claimNumber: string;
  carrierId: CarrierId;
  outstandingAmount: number;
  daysOutstanding: number;
  notInFileSince: Date;
}

const LIST_LIMIT = 500;

export async function listClaimsAwaitingConfirmation(prisma: PrismaClient, practiceId: string): Promise<AwaitingClaim[]> {
  const claims = await prisma.insuranceClaim.findMany({
    where: {
      practiceId,
      deletedAt: null,
      recoveryRoute: 'STOP',
      recoveryEvents: { some: { eventType: ABSENT_FROM_EXPORT_EVENT } },
    },
    select: {
      id: true,
      claimNumber: true,
      carrierId: true,
      outstandingAmount: true,
      daysOutstanding: true,
      recoveryEvents: { orderBy: { createdAt: 'desc' }, take: 1, select: { eventType: true, createdAt: true } },
    },
    orderBy: { claimNumber: 'asc' },
    take: LIST_LIMIT,
  });
  return claims
    .filter((c) => c.recoveryEvents[0]?.eventType === ABSENT_FROM_EXPORT_EVENT)
    .map((c) => ({
      id: c.id,
      claimNumber: c.claimNumber,
      carrierId: c.carrierId,
      outstandingAmount: Number(c.outstandingAmount),
      daysOutstanding: c.daysOutstanding,
      notInFileSince: c.recoveryEvents[0].createdAt,
    }));
}

export interface AbsentDecisionResult {
  decided: number;
  /** Claims that were not awaiting confirmation (already decided, restored, or not this practice's). */
  skipped: string[];
}

export async function decideAbsentClaims(
  prisma: PrismaClient,
  input: { practiceId: string; claimIds: string[]; decision: AbsentDecision; decidedByUserId: string },
): Promise<AbsentDecisionResult> {
  const result = await prisma.$transaction(async (tx) => {
    const claims = await tx.insuranceClaim.findMany({
      where: { id: { in: input.claimIds }, practiceId: input.practiceId, deletedAt: null, recoveryRoute: 'STOP' },
      select: {
        id: true,
        outstandingAmount: true,
        recoveryEvents: { orderBy: { createdAt: 'desc' }, take: 1, select: { eventType: true, metadata: true } },
      },
    });
    const awaiting = claims.filter((c) => c.recoveryEvents[0]?.eventType === ABSENT_FROM_EXPORT_EVENT);
    const decidedIds = new Set(awaiting.map((c) => c.id));

    for (const claim of awaiting) {
      const latest = claim.recoveryEvents[0];
      if (input.decision === 'RESTORE') {
        const restoreRoute = restoreRouteFrom(latest.metadata);
        await tx.insuranceClaim.update({ where: { id: claim.id }, data: { recoveryRoute: restoreRoute } });
        await tx.claimRecoveryEvent.create({
          data: {
            practiceId: input.practiceId,
            claimId: claim.id,
            eventType: ABSENT_RESTORED_BY_STAFF_EVENT,
            metadata: { restoredRoute: restoreRoute, decidedByUserId: input.decidedByUserId },
          },
        });
      } else {
        await tx.claimRecoveryEvent.create({
          data: {
            practiceId: input.practiceId,
            claimId: claim.id,
            eventType: ABSENT_CONFIRMED_RESOLVED_EVENT,
            previousOutstanding: claim.outstandingAmount,
            metadata: { decidedByUserId: input.decidedByUserId },
          },
        });
      }
    }
    if (input.decision === 'RESTORE' && awaiting.length > 0) {
      await syncWorkItemsForPractice(tx as unknown as PrismaClient, input.practiceId);
      await syncEligibleCallQueueForPractice(tx as unknown as PrismaClient, input.practiceId);
    }
    return { decided: awaiting.length, skipped: input.claimIds.filter((id) => !decidedIds.has(id)) };
  });
  return result;
}
