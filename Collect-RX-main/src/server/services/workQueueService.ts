import type { CarrierId, Prisma, PrismaClient } from '@prisma/client';
import { PAYER_PROGRAM_ACTIVATION } from '../../carriers/payerProgram.js';
import { resolveDispatchMode } from '../frontDesk/dispatchDecision.js';
import logger from '../observability/logger.js';
import {
  buildPriorityScoreInput,
  rankClaimForPractice,
  scoreClaim,
} from './priorityEngine.js';

export interface QueueRankingWeights {
  dollarsWeight: number;
  daysWeight: number;
  carrierRiskWeight: number;
}

/**
 * Create the carrier-call work implied by a successful CSV import.
 *
 * This mirrors the dispatch rules in validateDispatch so a claim that dispatch
 * would refuse never enters the queue: the 30-day floor, the payer-program
 * rule (DEC-10), and the over-90 rule (DEC-2: age alone blocks only in
 * autonomous mode). Claims with a blocking recovery action, a terminal or
 * non-pending status, or outside those rules remain visible as work items but
 * are not placed in the call queue. A claim with no payerType is treated as
 * PRIVATE, as dispatch does.
 *
 * Existing queue rows are left untouched. In particular, a re-import must not
 * reset attempts, revive a terminal queue row, or move a scheduled recall.
 */
export async function syncEligibleCallQueueForPractice(
  prisma: PrismaClient,
  practiceId: string,
): Promise<{ created: number; excludedByPayerProgram: number }> {
  const mode = await resolveDispatchMode(prisma, practiceId);
  const enabledPayerTypes = (Object.keys(PAYER_PROGRAM_ACTIVATION) as Array<keyof typeof PAYER_PROGRAM_ACTIVATION>)
    .filter((payerType) => PAYER_PROGRAM_ACTIVATION[payerType].enabled);
  const baseWhere = {
    practiceId,
    deletedAt: null,
    status: 'PENDING' as const,
    outstandingAmount: { gt: 0 },
    daysOutstanding: mode.humanAssisted ? { gte: 30 } : { gte: 30, lte: 90 },
    queueEntry: null,
    recoveryActions: {
      none: { status: 'BLOCKING' as const, clearedAt: null },
    },
  };
  const eligibleClaims = await prisma.insuranceClaim.findMany({
    where: {
      ...baseWhere,
      OR: [{ payerType: null }, { payerType: { in: enabledPayerTypes } }],
    },
    select: { id: true, priority: true },
  });
  const excludedByPayerProgram = await prisma.insuranceClaim.count({
    where: { ...baseWhere, payerType: { notIn: enabledPayerTypes, not: null } },
  });
  if (excludedByPayerProgram > 0) {
    logger.info('[workQueue] claims not queued: payer program not enabled for carrier calls', {
      practiceId,
      excludedByPayerProgram,
    });
  }

  let created = 0;
  for (const claim of eligibleClaims) {
    // claimId is unique. createMany(skipDuplicates) makes concurrent imports
    // and repeated imports idempotent without modifying existing queue state.
    const result = await prisma.callQueue.createMany({
      data: [{
        practiceId,
        claimId: claim.id,
        scheduledFor: new Date(),
        priority: claim.priority,
        attempts: 0,
        status: 'PENDING',
      }],
      skipDuplicates: true,
    });
    created += result.count;
  }

  return { created, excludedByPayerProgram };
}

const DEFAULT_WEIGHTS: QueueRankingWeights = {
  dollarsWeight: 0.5,
  daysWeight: 0.35,
  carrierRiskWeight: 0.15,
};

export async function getQueueWeights(
  prisma: PrismaClient,
  practiceId: string,
): Promise<QueueRankingWeights> {
  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    select: { settings: true },
  });
  const settings = practice?.settings as { workQueue?: Partial<QueueRankingWeights> } | null;
  return { ...DEFAULT_WEIGHTS, ...settings?.workQueue };
}

export async function syncWorkItemsForPractice(
  prisma: PrismaClient,
  practiceId: string,
): Promise<{ upserted: number }> {
  let upserted = 0;
  const referenceDate = new Date();

  // Retire legacy patient/outreach queue rows — insurance claims only.
  await prisma.workItem.updateMany({
    where: {
      practiceId,
      status: 'open',
      itemType: { not: 'insurance' },
    },
    data: { status: 'closed' },
  });

  const openClaimStatuses = ['PENDING', 'IN_QUEUE', 'CALLING', 'DENIED', 'ESCALATED', 'ON_HOLD', 'APPROVED_PENDING_PAYMENT'] as const;

  const claims = await prisma.insuranceClaim.findMany({
    where: {
      practiceId,
      deletedAt: null,
      status: { in: [...openClaimStatuses] },
      outstandingAmount: { gt: 0 },
    },
    include: {
      queueEntry: { select: { attempts: true } },
      callAttempts: {
        orderBy: { initiatedAt: 'desc' },
        take: 1,
        select: { outcomeDetail: true },
      },
    },
  });

  // Close WorkItems whose source claim left the open set (resolved, written
  // off, soft-deleted) — the upsert loop below only ever reopens/refreshes
  // items for claims still in `claims`, so without this an already-resolved
  // claim's WorkItem stays 'open' forever and the priority queue shows it as
  // still actionable indefinitely.
  const openClaimIds = claims.map((c) => c.id);
  await prisma.workItem.updateMany({
    where: {
      practiceId,
      status: 'open',
      itemType: 'insurance',
      ...(openClaimIds.length > 0 ? { sourceId: { notIn: openClaimIds } } : {}),
    },
    data: { status: 'closed' },
  });

  const scored = claims.map((c) => {
    const input = buildPriorityScoreInput(c, referenceDate);
    return { claim: c, input, total: scoreClaim(input).total };
  });
  const practiceMaxScore = Math.max(...scored.map((s) => s.total), 1);

  for (const { claim: c, input } of scored) {
    const dollars = Number(c.outstandingAmount);
    const rankScore = rankClaimForPractice(input, practiceMaxScore);
    await prisma.workItem.upsert({
      where: {
        practiceId_sourceType_sourceId: {
          practiceId,
          sourceType: 'insurance_claim',
          sourceId: c.id,
        },
      },
      create: {
        practiceId,
        sourceType: 'insurance_claim',
        sourceId: c.id,
        itemType: 'insurance',
        dollarsAtRisk: dollars,
        daysOutstanding: c.daysOutstanding,
        carrierId: c.carrierId,
        title: `Claim ${c.claimNumber}`,
        rankScore,
        status: 'open',
      },
      update: {
        dollarsAtRisk: dollars,
        daysOutstanding: c.daysOutstanding,
        carrierId: c.carrierId,
        title: `Claim ${c.claimNumber}`,
        rankScore,
      },
    });
    upserted += 1;
  }

  return { upserted };
}

export interface WorkQueueFilters {
  itemType?: string;
  carrierId?: CarrierId;
  aging?: '30' | '60' | '90' | '120+';
  assignedRep?: string;
  status?: string;
  gatesDueToday?: boolean;
}

export interface WorkItemRecoveryFields {
  recoveryRoute: string | null;
  blockingGateTitle: string | null;
  gateDueToday: boolean;
}

async function enrichWorkItemsWithRecovery(
  prisma: PrismaClient,
  items: Awaited<ReturnType<typeof prisma.workItem.findMany>>,
): Promise<Array<(typeof items)[number] & WorkItemRecoveryFields>> {
  const claimIds = items
    .filter((i) => i.sourceType === 'insurance_claim')
    .map((i) => i.sourceId);
  if (claimIds.length === 0) {
    return items.map((i) => ({
      ...i,
      recoveryRoute: null,
      blockingGateTitle: null,
      gateDueToday: false,
    }));
  }

  const startOfUtcDay = new Date();
  startOfUtcDay.setUTCHours(0, 0, 0, 0);
  const endOfUtcDay = new Date(startOfUtcDay);
  endOfUtcDay.setUTCDate(endOfUtcDay.getUTCDate() + 1);

  const [claims, gates, traces] = await Promise.all([
    prisma.insuranceClaim.findMany({
      where: { id: { in: claimIds }, deletedAt: null },
      select: { id: true, recoveryRoute: true },
    }),
    prisma.claimRecoveryAction.findMany({
      where: { claimId: { in: claimIds }, status: 'BLOCKING', clearedAt: null },
      select: { claimId: true, title: true, createdAt: true },
    }),
    prisma.claimRecoveryAction.findMany({
      where: {
        claimId: { in: claimIds },
        actionType: 'PAYMENT_VERIFY_SYNC',
        status: 'OPEN',
        clearedAt: null,
        scheduledRecallAt: { lte: endOfUtcDay },
      },
      select: { claimId: true, scheduledRecallAt: true },
    }),
  ]);

  const routeByClaim = new Map(claims.map((c) => [c.id, c.recoveryRoute]));
  const gateByClaim = new Map(gates.map((g) => [g.claimId, g]));
  const traceDueClaimIds = new Set(traces.map((t) => t.claimId));

  return items.map((item) => {
    if (item.sourceType !== 'insurance_claim') {
      return { ...item, recoveryRoute: null, blockingGateTitle: null, gateDueToday: false };
    }
    const gate = gateByClaim.get(item.sourceId);
    const gateDueToday = Boolean(gate) || traceDueClaimIds.has(item.sourceId);
    return {
      ...item,
      recoveryRoute: routeByClaim.get(item.sourceId) ?? null,
      blockingGateTitle: gate?.title ?? null,
      gateDueToday,
    };
  });
}

export async function listWorkItems(
  prisma: PrismaClient,
  practiceId: string,
  filters: WorkQueueFilters,
  page = 1,
  limit = 50,
) {
  const where: Prisma.WorkItemWhereInput = {
    practiceId,
    status: filters.status ?? 'open',
    itemType: filters.itemType ? (filters.itemType as Prisma.EnumWorkItemTypeFilter['equals']) : 'insurance',
  };

  if (filters.carrierId) where.carrierId = filters.carrierId;
  if (filters.assignedRep) where.assignedRep = filters.assignedRep;

  if (filters.aging) {
    const agingMap: Record<string, Prisma.IntFilter> = {
      '30': { gte: 30, lt: 60 },
      '60': { gte: 60, lt: 90 },
      '90': { gte: 90, lt: 120 },
      '120+': { gte: 120 },
    };
    where.daysOutstanding = agingMap[filters.aging];
  }

  const skip = (page - 1) * limit;
  const [rawItems, total] = await Promise.all([
    prisma.workItem.findMany({
      where,
      orderBy: [{ rankScore: 'desc' }, { dollarsAtRisk: 'desc' }],
      skip: 0,
      take: Math.min(500, skip + limit + 50),
    }),
    prisma.workItem.count({ where }),
  ]);

  let enriched = await enrichWorkItemsWithRecovery(prisma, rawItems);
  if (filters.gatesDueToday) {
    enriched = enriched.filter((i) => i.gateDueToday);
  }
  enriched.sort((a, b) => {
    if (a.gateDueToday !== b.gateDueToday) return a.gateDueToday ? -1 : 1;
    return b.rankScore - a.rankScore;
  });
  const items = enriched.slice(skip, skip + limit);

  return { items, total: filters.gatesDueToday ? enriched.length : total, page, limit, pages: Math.ceil((filters.gatesDueToday ? enriched.length : total) / limit) };
}
