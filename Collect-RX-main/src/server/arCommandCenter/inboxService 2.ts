import type { PrismaClient } from '@prisma/client';

export interface ArInboxItem {
  id: string;
  kind: 'recovery_gate' | 'denial' | 'underpayment' | 'managed_recovery' | 'carrier_block';
  title: string;
  detail: string | null;
  claimId: string | null;
  claimNumber: string | null;
  carrierId: string | null;
  dollarsAtRisk: number;
  dueAt: string | null;
  route: string | null;
  priority: number;
}

export async function buildArCommandCenterInbox(
  prisma: PrismaClient,
  practiceId: string,
): Promise<ArInboxItem[]> {
  const items: ArInboxItem[] = [];

  const gates = await prisma.claimRecoveryAction.findMany({
    where: {
      practiceId,
      status: { in: ['OPEN', 'BLOCKING'] },
      clearedAt: null,
    },
    include: {
      claim: {
        select: {
          claimNumber: true,
          carrierId: true,
          outstandingAmount: true,
          recoveryRoute: true,
        },
      },
    },
    orderBy: [{ deadline: 'asc' }, { createdAt: 'asc' }],
    take: 100,
  });

  for (const gate of gates) {
    const kind =
      gate.actionType === 'DENIAL_REVIEW' || gate.actionType === 'PRACTICE_DOCS'
        ? 'denial'
        : gate.actionType === 'UNDERPAYMENT_REVIEW'
          ? 'underpayment'
          : gate.actionType === 'PROCESSING_RECALL' || gate.actionType === 'PAYMENT_TRACE'
            ? 'managed_recovery'
            : 'recovery_gate';

    items.push({
      id: gate.id,
      kind,
      title: gate.title,
      detail: gate.detail,
      claimId: gate.claimId,
      claimNumber: gate.claim?.claimNumber ?? null,
      carrierId: gate.claim?.carrierId ?? null,
      dollarsAtRisk: Number(gate.claim?.outstandingAmount ?? 0),
      dueAt: gate.deadline?.toISOString() ?? gate.scheduledRecallAt?.toISOString() ?? null,
      route: gate.route,
      priority: gate.status === 'BLOCKING' ? 0 : 1,
    });
  }

  const blocks = await prisma.carrierBlockEvent.findMany({
    where: { practiceId, resumedAt: null },
    select: { id: true, carrierId: true, notes: true, blockedAt: true },
  });

  for (const block of blocks) {
    items.push({
      id: block.id,
      kind: 'carrier_block',
      title: `Carrier block: ${block.carrierId}`,
      detail: block.notes,
      claimId: null,
      claimNumber: null,
      carrierId: block.carrierId,
      dollarsAtRisk: 0,
      dueAt: block.blockedAt.toISOString(),
      route: 'STOP',
      priority: 0,
    });
  }

  items.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (aDue !== bDue) return aDue - bDue;
    return b.dollarsAtRisk - a.dollarsAtRisk;
  });

  return items;
}

export async function listManagedRecoveryQueue(
  prisma: PrismaClient,
  practiceId: string,
) {
  return prisma.claimRecoveryAction.findMany({
    where: {
      practiceId,
      status: { in: ['OPEN', 'BLOCKING'] },
      actionType: { in: ['PROCESSING_RECALL', 'PAYMENT_TRACE', 'PAYMENT_VERIFY_SYNC'] },
      clearedAt: null,
    },
    include: {
      claim: {
        select: {
          id: true,
          claimNumber: true,
          carrierId: true,
          outstandingAmount: true,
          recoveryRoute: true,
          status: true,
        },
      },
    },
    orderBy: [{ scheduledRecallAt: 'asc' }, { createdAt: 'asc' }],
  });
}
