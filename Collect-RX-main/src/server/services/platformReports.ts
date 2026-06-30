import type { CarrierId, PrismaClient } from '@prisma/client';
import { CARRIER_CONFIGS } from '../../carriers/adapter.js';
import type {
  AgingBucket,
  CarrierAgingRow,
  CarrierStatRow,
  QueueStats,
} from '../../types/practiceSettings.js';
import { isPracticeQueuePaused } from '../frontDesk/queueEngine.js';

const OPEN_OUTCOMES = new Set(['PENDING', 'DENIED', 'ESCALATED', 'FAILED', 'NO_ANSWER']);

function bucketLabel(days: number): AgingBucket['label'] {
  if (days <= 30) return 'Current';
  if (days <= 60) return '31–60';
  if (days <= 90) return '61–90';
  return '90+';
}

function carrierName(id: CarrierId): string {
  return CARRIER_CONFIGS[id]?.displayName ?? id;
}

function isWithinCallWindow(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 8 * 60 && mins < 17 * 60;
}

export async function computeAgingReport(
  prisma: PrismaClient,
  practiceId: string,
  timeframe: '30d' | '90d' | 'all' = '30d',
): Promise<{ buckets: AgingBucket[]; carrierRows: CarrierAgingRow[] }> {
  const since =
    timeframe === 'all'
      ? null
      : new Date(Date.now() - (timeframe === '90d' ? 90 : 30) * 86400000);

  const claims = await prisma.insuranceClaim.findMany({
    where: {
      practiceId,
      status: { notIn: ['RESOLVED'] },
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    select: {
      carrierId: true,
      outstandingAmount: true,
      daysOutstanding: true,
    },
  });

  const bucketMap: Record<AgingBucket['label'], { total: number; count: number }> = {
    Current: { total: 0, count: 0 },
    '31–60': { total: 0, count: 0 },
    '61–90': { total: 0, count: 0 },
    '90+': { total: 0, count: 0 },
  };

  const carrierMap = new Map<CarrierId, CarrierAgingRow>();

  for (const c of claims) {
    const cents = Math.round(Number(c.outstandingAmount) * 100);
    const label = bucketLabel(c.daysOutstanding);
    bucketMap[label].total += cents;
    bucketMap[label].count += 1;

    const row =
      carrierMap.get(c.carrierId) ??
      ({
        carrierId: c.carrierId,
        carrierName: carrierName(c.carrierId),
        current: 0,
        days31to60: 0,
        days61to90: 0,
        days90plus: 0,
        total: 0,
      } satisfies CarrierAgingRow);
    if (label === 'Current') row.current += cents;
    else if (label === '31–60') row.days31to60 += cents;
    else if (label === '61–90') row.days61to90 += cents;
    else row.days90plus += cents;
    row.total += cents;
    carrierMap.set(c.carrierId, row);
  }

  const grandTotal = Object.values(bucketMap).reduce((s, b) => s + b.total, 0);
  const buckets: AgingBucket[] = (Object.keys(bucketMap) as AgingBucket['label'][]).map(
    (label) => ({
      label,
      totalAmount: bucketMap[label].total,
      claimCount: bucketMap[label].count,
      percentOfTotal: grandTotal > 0 ? (bucketMap[label].total / grandTotal) * 100 : 0,
    }),
  );

  return { buckets, carrierRows: [...carrierMap.values()] };
}

export async function computeCarrierStats(
  prisma: PrismaClient,
  practiceId: string,
  timeframe: '30d' | '90d' | 'all' = '30d',
): Promise<{ stats: CarrierStatRow[]; blockHistory: unknown[] }> {
  const days = timeframe === 'all' ? 3650 : timeframe === '90d' ? 90 : 30;
  const since = new Date(Date.now() - days * 86400000);
  const mid = new Date(Date.now() - (days / 2) * 86400000);

  const attempts = await prisma.callAttempt.findMany({
    where: {
      claim: { practiceId },
      initiatedAt: { gte: since },
      completedAt: { not: null },
    },
    include: { claim: { select: { carrierId: true } } },
  });

  const byCarrier = new Map<
    CarrierId,
    { total: number; resolved: number; duration: number; attempts: number; denials: Map<string, number> }
  >();

  const recentRate = new Map<CarrierId, { recent: number; recentOk: number; prior: number; priorOk: number }>();

  for (const a of attempts) {
    const cid = a.claim.carrierId;
    const agg = byCarrier.get(cid) ?? { total: 0, resolved: 0, duration: 0, attempts: 0, denials: new Map() };
    agg.total += 1;
    agg.attempts += 1;
    if (a.durationSeconds) agg.duration += a.durationSeconds;
    if (a.outcome === 'RESOLVED') agg.resolved += 1;
    if (a.outcome === 'DENIED' && a.outcomeDetail) {
      agg.denials.set(a.outcomeDetail, (agg.denials.get(a.outcomeDetail) ?? 0) + 1);
    }
    byCarrier.set(cid, agg);

    const tr = recentRate.get(cid) ?? { recent: 0, recentOk: 0, prior: 0, priorOk: 0 };
    const isRecent = a.initiatedAt >= mid;
    if (isRecent) {
      tr.recent += 1;
      if (a.outcome === 'RESOLVED') tr.recentOk += 1;
    } else {
      tr.prior += 1;
      if (a.outcome === 'RESOLVED') tr.priorOk += 1;
    }
    recentRate.set(cid, tr);
  }

  const stats: CarrierStatRow[] = [...byCarrier.entries()].map(([carrierId, agg]) => {
    const tr = recentRate.get(carrierId)!;
    const recentRatePct = tr.recent > 0 ? (tr.recentOk / tr.recent) * 100 : 0;
    const priorRatePct = tr.prior > 0 ? (tr.priorOk / tr.prior) * 100 : 0;
    const delta = recentRatePct - priorRatePct;
    let trend: CarrierStatRow['trend'] = 'stable';
    if (delta > 3) trend = 'improving';
    else if (delta < -3) trend = 'declining';

    let topDenial: string | null = null;
    let topCount = 0;
    for (const [reason, count] of agg.denials) {
      if (count > topCount) {
        topCount = count;
        topDenial = reason;
      }
    }

    return {
      carrierId,
      carrierName: carrierName(carrierId),
      totalClaims: agg.total,
      successRate: agg.total > 0 ? (agg.resolved / agg.total) * 100 : 0,
      avgCallDurationSeconds: agg.total > 0 ? Math.round(agg.duration / agg.total) : 0,
      avgAttempts: agg.total > 0 ? agg.attempts / agg.total : 0,
      topDenialReason: topDenial,
      trend,
    };
  });

  const blockHistory = await prisma.carrierBlockEvent.findMany({
    where: { practiceId, blockedAt: { gte: since } },
    orderBy: { blockedAt: 'desc' },
    take: 50,
  });

  return { stats, blockHistory };
}

export async function computeQueueStats(
  prisma: PrismaClient,
  practiceId: string,
): Promise<QueueStats> {
  const [queued, held, paused, active, resolvedToday] = await Promise.all([
    prisma.callQueue.count({ where: { practiceId, status: 'PENDING' } }),
    prisma.callQueue.count({ where: { practiceId, status: 'BLOCKED' } }),
    isPracticeQueuePaused(prisma, practiceId),
    prisma.callAttempt.findFirst({
      where: { completedAt: null, claim: { practiceId } },
      include: { claim: { select: { id: true, claimNumber: true, carrierId: true } } },
    }),
    prisma.callAttempt.count({
      where: {
        claim: { practiceId },
        outcome: 'RESOLVED',
        completedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
  ]);

  return {
    queued,
    held,
    isPaused: paused,
    isWithinCallWindow: isWithinCallWindow(),
    activeCall: active
      ? {
          id: active.id,
          claimId: active.claim.id,
          claimRef: active.claim.claimNumber,
          carrierId: active.claim.carrierId,
          activeAgent: active.activeAgent,
          startedAt: active.initiatedAt.toISOString(),
          vapiCallId: active.vapiCallId,
        }
      : null,
    resolvedToday,
  };
}

export async function computePortfolioSummary(prisma: PrismaClient) {
  const practices = await prisma.practice.findMany({
    select: { id: true, name: true, settings: true },
  });

  const results = [];
  for (const p of practices) {
    const { buckets } = await computeAgingReport(prisma, p.id, 'all');
    const queueStats = await computeQueueStats(prisma, p.id);
    const openEsc = await prisma.callEscalation.count({
      where: { practiceId: p.id, status: 'open' },
    });
    const worst = buckets.find((b) => b.label === '90+' && b.totalAmount > 0);
    results.push({
      practice: { id: p.id, name: p.name },
      aging: buckets,
      queueStats,
      openEscalations: openEsc,
      topCarrierIssue: worst && worst.totalAmount > 0 ? '90+ day AR elevated' : null,
    });
  }
  return results;
}

/** Claims included in aging per brief — open outcomes only */
export function claimEligibleForAging(outcome: string | null): boolean {
  if (!outcome) return true;
  return OPEN_OUTCOMES.has(outcome);
}
