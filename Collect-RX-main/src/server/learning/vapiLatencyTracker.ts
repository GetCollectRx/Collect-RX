/**
 * Vapi call latency tracking and dashboarding.
 * Measures end-to-end call performance: initiation → completion, broken down by carrier.
 * Targets industry baseline: <500ms response time from speech recognition to LLM output.
 */

import type { PrismaClient } from '@prisma/client';
import type { CarrierId } from '@prisma/client';

export interface LatencyMetrics {
  carrier: CarrierId | 'all';
  sampleSize: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  window: {
    start: string;
    end: string;
    days: number;
  };
}

export interface CallLatencySummary {
  callId: string;
  carrierId: CarrierId;
  initiatedAt: Date;
  completedAt: Date | null;
  durationSeconds: number | null;
  minutesBilled: number | null;
  latencyMs: number | null;
}

function percentile(sortedArray: number[], p: number): number {
  if (sortedArray.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedArray.length) - 1;
  return sortedArray[Math.max(0, index)];
}

async function getCallLatencies(
  prisma: PrismaClient,
  carrierId?: CarrierId,
  windowDays = 7,
): Promise<CallLatencySummary[]> {
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const calls = await prisma.callAttempt.findMany({
    where: {
      completedAt: { gte: since },
      claim: carrierId
        ? { carrierId }
        : undefined,
      outcome: { not: null },
    },
    select: {
      vapiCallId: true,
      claim: { select: { carrierId: true } },
      initiatedAt: true,
      completedAt: true,
      durationSeconds: true,
      minutesBilled: true,
    },
    orderBy: { completedAt: 'asc' },
    take: 10000,
  });

  return calls.map((c) => ({
    callId: c.vapiCallId,
    carrierId: c.claim.carrierId,
    initiatedAt: c.initiatedAt,
    completedAt: c.completedAt,
    durationSeconds: c.durationSeconds,
    minutesBilled: c.minutesBilled,
    latencyMs: c.completedAt
      ? Math.round((c.completedAt.getTime() - c.initiatedAt.getTime()) / 100) / 10
      : null,
  }));
}

export async function getLatencyMetrics(
  prisma: PrismaClient,
  opts: {
    carrier?: CarrierId;
    windowDays?: number;
  } = {},
): Promise<LatencyMetrics | null> {
  const windowDays = opts.windowDays || 7;
  const latencies = await getCallLatencies(prisma, opts.carrier, windowDays);

  if (latencies.length === 0) {
    return null;
  }

  const ms = latencies
    .filter((c) => c.latencyMs !== null)
    .map((c) => c.latencyMs!)
    .sort((a, b) => a - b);

  if (ms.length === 0) return null;

  const sum = ms.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / ms.length);
  const median = percentile(ms, 50);

  const now = new Date();
  const start = new Date(now.getTime() - windowDays * 86_400_000);

  return {
    carrier: opts.carrier || 'all',
    sampleSize: latencies.length,
    p50Ms: Math.round(percentile(ms, 50)),
    p90Ms: Math.round(percentile(ms, 90)),
    p95Ms: Math.round(percentile(ms, 95)),
    p99Ms: Math.round(percentile(ms, 99)),
    avgMs: avg,
    medianMs: median,
    minMs: Math.min(...ms),
    maxMs: Math.max(...ms),
    window: {
      start: start.toISOString(),
      end: now.toISOString(),
      days: windowDays,
    },
  };
}

export async function getLatencyMetricsByCarrier(
  prisma: PrismaClient,
  windowDays = 7,
): Promise<LatencyMetrics[]> {
  const calls = await getCallLatencies(prisma, undefined, windowDays);
  const byCarrier = new Map<CarrierId, number[]>();

  for (const call of calls) {
    if (call.latencyMs !== null) {
      if (!byCarrier.has(call.carrierId)) {
        byCarrier.set(call.carrierId, []);
      }
      byCarrier.get(call.carrierId)!.push(call.latencyMs);
    }
  }

  const metrics: LatencyMetrics[] = [];
  const now = new Date();
  const start = new Date(now.getTime() - windowDays * 86_400_000);

  for (const [carrier, ms] of byCarrier.entries()) {
    if (ms.length === 0) continue;

    ms.sort((a, b) => a - b);
    const sum = ms.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / ms.length);
    const median = percentile(ms, 50);

    metrics.push({
      carrier,
      sampleSize: ms.length,
      p50Ms: Math.round(percentile(ms, 50)),
      p90Ms: Math.round(percentile(ms, 90)),
      p95Ms: Math.round(percentile(ms, 95)),
      p99Ms: Math.round(percentile(ms, 99)),
      avgMs: avg,
      medianMs: median,
      minMs: Math.min(...ms),
      maxMs: Math.max(...ms),
      window: {
        start: start.toISOString(),
        end: now.toISOString(),
        days: windowDays,
      },
    });
  }

  return metrics.sort((a, b) => a.avgMs - b.avgMs);
}

export async function getLatencyHealthStatus(
  prisma: PrismaClient,
  windowDays = 7,
): Promise<{
  healthy: boolean;
  p99BreachCount: number;
  p90BreachCount: number;
  targetMs: number;
  recommendation: string;
}> {
  const allMetrics = await getLatencyMetricsByCarrier(prisma, windowDays);
  const targetMs = 500;

  let p99Breaches = 0;
  let p90Breaches = 0;

  for (const m of allMetrics) {
    if (m.p99Ms > targetMs * 2) p99Breaches++;
    if (m.p90Ms > targetMs) p90Breaches++;
  }

  const healthy = p99Breaches === 0 && p90Breaches <= 1;

  let recommendation = 'Latency is within acceptable bounds.';
  if (p99Breaches > 0) {
    recommendation = `${p99Breaches} carriers exceed 2x target (${targetMs * 2}ms p99). Consider agent warmups or menu caching.`;
  } else if (p90Breaches > 0) {
    recommendation = `${p90Breaches} carriers exceed target (${targetMs}ms p90). Monitor for IVR delays during peak hours.`;
  }

  return {
    healthy,
    p99BreachCount: p99Breaches,
    p90BreachCount: p90Breaches,
    targetMs,
    recommendation,
  };
}
