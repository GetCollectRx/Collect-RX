import type { PrismaClient, RecoveryRoute } from '@prisma/client';
import { checkRecoveryDispatchGate } from './dispatchGate.js';

export interface PracticeGateInboxRow {
  id: string;
  claimId: string;
  claimNumber: string;
  carrierId: string;
  outstandingAmount: number;
  actionType: string;
  title: string;
  detail: string | null;
  createdAt: string;
  recoveryRoute: RecoveryRoute | null;
  deadline: string | null;
  escalatedAt: string | null;
}

export interface ClaimRecoveryListFields {
  recoveryRoute: RecoveryRoute | null;
  blockingGateTitle: string | null;
  scheduledRecallAt: string | null;
  canCallCarrier: boolean;
  dispatchBlockReason: string | null;
}

export async function listPracticeRecoveryGates(
  prisma: PrismaClient,
  practiceId: string,
): Promise<PracticeGateInboxRow[]> {
  const actions = await prisma.claimRecoveryAction.findMany({
    where: { practiceId, status: 'BLOCKING', clearedAt: null },
    include: {
      claim: {
        select: {
          id: true,
          claimNumber: true,
          carrierId: true,
          outstandingAmount: true,
          recoveryRoute: true,
        },
      },
    },
    orderBy: [{ deadline: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
  });

  return actions.map((a) => ({
    id: a.id,
    claimId: a.claimId,
    claimNumber: a.claim.claimNumber,
    carrierId: a.claim.carrierId,
    outstandingAmount: Number(a.claim.outstandingAmount),
    actionType: a.actionType,
    title: a.title,
    detail: a.detail,
    createdAt: a.createdAt.toISOString(),
    recoveryRoute: a.claim.recoveryRoute,
    deadline: a.deadline?.toISOString() ?? null,
    escalatedAt: a.escalatedAt?.toISOString() ?? null,
  }));
}

type ClaimRowForRecovery = {
  id: string;
  recoveryRoute: RecoveryRoute | null;
  queueEntry?: { scheduledFor: Date } | null;
};

export async function enrichClaimsWithRecoveryFields(
  prisma: PrismaClient,
  claims: ClaimRowForRecovery[],
): Promise<Map<string, ClaimRecoveryListFields>> {
  if (claims.length === 0) return new Map();

  const claimIds = claims.map((c) => c.id);
  const blocking = await prisma.claimRecoveryAction.findMany({
    where: { claimId: { in: claimIds }, status: 'BLOCKING', clearedAt: null },
    select: { claimId: true, title: true },
    orderBy: { createdAt: 'desc' },
  });
  const blockingByClaim = new Map<string, string>();
  for (const b of blocking) {
    if (!blockingByClaim.has(b.claimId)) blockingByClaim.set(b.claimId, b.title);
  }

  const dispatchResults = await Promise.all(
    claims.map(async (c) => {
      const gate = await checkRecoveryDispatchGate(prisma, c.id);
      return {
        claimId: c.id,
        recoveryRoute: c.recoveryRoute,
        blockingGateTitle: blockingByClaim.get(c.id) ?? null,
        scheduledRecallAt: c.queueEntry?.scheduledFor?.toISOString() ?? null,
        canCallCarrier: gate.allowed,
        dispatchBlockReason: gate.allowed ? null : gate.reason ?? null,
      } satisfies ClaimRecoveryListFields & { claimId: string };
    }),
  );

  return new Map(dispatchResults.map((r) => [r.claimId, r]));
}
