import type { PrismaClient, ClaimStatus } from '@prisma/client';
import { categorizeDenial, type DenialCategory } from '../recovery/denialEvidenceRules.js';

export interface BatchClaimStatus {
  claimId: string;
  claimNumber: string;
  carrierId: string;
  outstandingAmount: number;
  status: ClaimStatus;
  daysOutstanding: number;
  lastOutcome: string | null;
  lastOutcomeAt: string | null;
  denialCategory: DenialCategory | null;
  denialReason: string | null;
  attemptCount: number;
  queueStatus: string | null;
  nextRecallAt: string | null;
}

export async function getBatchClaimStatus(
  prisma: PrismaClient,
  practiceId: string,
  claimIds: string[],
): Promise<BatchClaimStatus[]> {
  if (claimIds.length === 0) return [];
  if (claimIds.length > 100) throw new Error('Maximum 100 claims per batch');

  const claims = await prisma.insuranceClaim.findMany({
    where: {
      practiceId,
      id: { in: claimIds },
    },
    select: {
      id: true,
      claimNumber: true,
      carrierId: true,
      outstandingAmount: true,
      status: true,
      daysOutstanding: true,
      denialReasonCode: true,
      denialReasonText: true,
      callAttempts: {
        select: {
          outcome: true,
          outcomeDetail: true,
          completedAt: true,
        },
        orderBy: { completedAt: 'desc' },
        take: 1,
      },
    },
  });

  const allAttempts = await prisma.callAttempt.findMany({
    where: { claimId: { in: claimIds } },
    select: { claimId: true, id: true },
  });

  const attemptCounts = new Map<string, number>();
  for (const a of allAttempts) {
    attemptCounts.set(a.claimId, (attemptCounts.get(a.claimId) ?? 0) + 1);
  }

  return claims.map((claim) => {
    const lastAttempt = claim.callAttempts[0];
    const denial =
      claim.denialReasonCode || claim.denialReasonText || lastAttempt?.outcomeDetail
        ? categorizeDenial({
            denialReasonCode: claim.denialReasonCode,
            denialReasonText: claim.denialReasonText,
            outcomeDetail: lastAttempt?.outcomeDetail,
          })
        : null;

    return {
      claimId: claim.id,
      claimNumber: claim.claimNumber,
      carrierId: claim.carrierId,
      outstandingAmount: Number(claim.outstandingAmount),
      status: claim.status,
      daysOutstanding: claim.daysOutstanding,
      lastOutcome: lastAttempt?.outcome ?? null,
      lastOutcomeAt: lastAttempt?.completedAt?.toISOString() ?? null,
      denialCategory: denial,
      denialReason: claim.denialReasonText ?? lastAttempt?.outcomeDetail ?? null,
      attemptCount: attemptCounts.get(claim.id) ?? 0,
      queueStatus: null,
      nextRecallAt: null,
    };
  });
}

export async function getQueueSummary(
  prisma: PrismaClient,
  practiceId: string,
): Promise<{
  totalQueued: number;
  byStatus: Record<string, number>;
  byCarrier: Record<string, number>;
  nextCallAt: string | null;
}> {
  const queue = await prisma.callQueue.findMany({
    where: { claim: { practiceId } },
    select: {
      status: true,
      nextRecallAt: true,
      claim: { select: { carrierId: true } },
    },
  });

  const byStatus: Record<string, number> = {};
  const byCarrier: Record<string, number> = {};
  let nextCallAt: Date | null = null;

  for (const q of queue) {
    byStatus[q.status] = (byStatus[q.status] ?? 0) + 1;
    byCarrier[q.claim.carrierId] = (byCarrier[q.claim.carrierId] ?? 0) + 1;

    if (q.nextRecallAt && (!nextCallAt || q.nextRecallAt < nextCallAt)) {
      nextCallAt = q.nextRecallAt;
    }
  }

  return {
    totalQueued: queue.length,
    byStatus,
    byCarrier,
    nextCallAt: nextCallAt?.toISOString() ?? null,
  };
}
