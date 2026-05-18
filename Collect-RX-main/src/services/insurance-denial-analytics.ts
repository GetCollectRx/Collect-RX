import type { CarrierId, PrismaClient } from '@prisma/client';

export interface DenialByCarrier {
  carrierId: CarrierId;
  totalClaims: number;
  deniedClaims: number;
  denialRate: number;
}

export interface DenialReasonRow {
  reason: string;
  count: number;
}

export interface DenialAnalyticsSnapshot {
  byCarrier: DenialByCarrier[];
  topDenialReasons: DenialReasonRow[];
  appealWinRate: number;
  avgDaysToResolution: number;
}

export async function getDenialAnalytics(
  prisma: PrismaClient,
  practiceId: string,
): Promise<DenialAnalyticsSnapshot> {
  const claims = await prisma.insuranceClaim.findMany({
    where: { practiceId },
    select: {
      carrierId: true,
      status: true,
      daysOutstanding: true,
      callAttempts: {
        select: { outcome: true, outcomeDetail: true, completedAt: true, initiatedAt: true },
        orderBy: { initiatedAt: 'desc' },
        take: 5,
      },
    },
  });

  const byCarrierMap = new Map<CarrierId, { total: number; denied: number }>();
  const reasonCounts = new Map<string, number>();
  let resolvedCount = 0;
  let resolvedDaysSum = 0;

  for (const c of claims) {
    const cur = byCarrierMap.get(c.carrierId) ?? { total: 0, denied: 0 };
    cur.total += 1;
    if (c.status === 'DENIED' || c.status === 'ESCALATED') cur.denied += 1;
    byCarrierMap.set(c.carrierId, cur);

    const deniedAttempt = c.callAttempts.find((a) => a.outcome === 'DENIED');
    if (deniedAttempt?.outcomeDetail) {
      const key = deniedAttempt.outcomeDetail.slice(0, 80);
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }

    if (c.status === 'RESOLVED' && c.callAttempts[0]?.completedAt) {
      resolvedCount += 1;
      const start = c.callAttempts[c.callAttempts.length - 1]?.initiatedAt ?? c.callAttempts[0].initiatedAt;
      const end = c.callAttempts[0].completedAt!;
      resolvedDaysSum += Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
    }
  }

  const byCarrier: DenialByCarrier[] = [...byCarrierMap.entries()].map(([carrierId, v]) => ({
    carrierId,
    totalClaims: v.total,
    deniedClaims: v.denied,
    denialRate: v.total > 0 ? Math.round((v.denied / v.total) * 1000) / 10 : 0,
  }));

  const topDenialReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const deniedTotal = claims.filter((c) => c.status === 'DENIED').length;
  const resolvedFromDenied = claims.filter(
    (c) => c.status === 'RESOLVED' && c.callAttempts.some((a) => a.outcome === 'DENIED'),
  ).length;
  const appealWinRate =
    deniedTotal > 0 ? Math.round((resolvedFromDenied / deniedTotal) * 1000) / 10 : 0;

  return {
    byCarrier: byCarrier.sort((a, b) => b.denialRate - a.denialRate),
    topDenialReasons,
    appealWinRate,
    avgDaysToResolution: resolvedCount > 0 ? Math.round(resolvedDaysSum / resolvedCount) : 0,
  };
}
