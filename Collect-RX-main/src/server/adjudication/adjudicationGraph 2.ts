import type { PrismaClient } from '@prisma/client';

export interface AdjudicationGraphBucket {
  key: string;
  count: number;
  successCount: number;
}

export interface AdjudicationWeeklyPoint {
  weekStart: string;
  events: number;
  successRate: number;
  medianDurationMs: number | null;
}

export interface AdjudicationGraph {
  totalEvents: number;
  byCallType: AdjudicationGraphBucket[];
  byDenialCode: AdjudicationGraphBucket[];
  byCarrier: AdjudicationGraphBucket[];
  byOutcome: AdjudicationGraphBucket[];
  weeklyTrend: AdjudicationWeeklyPoint[];
  days: number;
}

function bucketize(
  rows: Array<{ key: string; outcome: string }>,
): AdjudicationGraphBucket[] {
  const map = new Map<string, { count: number; successCount: number }>();
  for (const row of rows) {
    const cur = map.get(row.key) ?? { count: 0, successCount: 0 };
    cur.count += 1;
    if (row.outcome === 'success') cur.successCount += 1;
    map.set(row.key, cur);
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, count: v.count, successCount: v.successCount }))
    .sort((a, b) => b.count - a.count);
}

function weekStartIso(d: Date): string {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy.toISOString().slice(0, 10);
}

export async function getAdjudicationGraph(
  prisma: PrismaClient,
  practiceId: string,
  days = 90,
): Promise<AdjudicationGraph> {
  const since = new Date(Date.now() - days * 86_400_000);
  const events = await prisma.adjudicationEvent.findMany({
    where: { practiceId, createdAt: { gte: since } },
    select: {
      callType: true,
      denialReasonCode: true,
      carrierId: true,
      outcome: true,
      callDurationMs: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const byCallType = bucketize(
    events.map((e) => ({ key: e.callType, outcome: e.outcome })),
  );
  const byDenialCode = bucketize(
    events
      .filter((e) => e.denialReasonCode)
      .map((e) => ({ key: e.denialReasonCode as string, outcome: e.outcome })),
  );
  const byCarrier = bucketize(
    events.map((e) => ({ key: e.carrierId, outcome: e.outcome })),
  );
  const byOutcome = bucketize(
    events.map((e) => ({ key: e.outcome, outcome: e.outcome })),
  );

  const weekMap = new Map<
    string,
    { events: number; successes: number; durations: number[] }
  >();
  for (const e of events) {
    const ws = weekStartIso(e.createdAt);
    const cur = weekMap.get(ws) ?? { events: 0, successes: 0, durations: [] };
    cur.events += 1;
    if (e.outcome === 'success') cur.successes += 1;
    if (e.callDurationMs && e.callDurationMs > 0) cur.durations.push(e.callDurationMs);
    weekMap.set(ws, cur);
  }

  const weeklyTrend: AdjudicationWeeklyPoint[] = [...weekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, v]) => {
      v.durations.sort((a, b) => a - b);
      const medianDurationMs =
        v.durations.length > 0
          ? v.durations[Math.floor(v.durations.length / 2)]
          : null;
      return {
        weekStart,
        events: v.events,
        successRate: v.events > 0 ? Math.round((v.successes / v.events) * 1000) / 10 : 0,
        medianDurationMs,
      };
    });

  return {
    totalEvents: events.length,
    byCallType,
    byDenialCode,
    byCarrier,
    byOutcome,
    weeklyTrend,
    days,
  };
}
