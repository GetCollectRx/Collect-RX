import type { PrismaClient } from '@prisma/client';

export interface Phase5CallKpis {
  totalCalls: number;
  resolvedCalls: number;
  resolutionRate: number;
  avgCallDurationSeconds: number | null;
  escalationRate: number;
}

export async function getPhase5CallKpis(
  prisma: PrismaClient,
  practiceId: string,
  since: Date,
): Promise<Phase5CallKpis> {
  const [total, resolved, escalated, avgDuration] = await Promise.all([
    prisma.callAttempt.count({
      where: { claim: { practiceId }, initiatedAt: { gte: since } },
    }),
    prisma.callAttempt.count({
      where: { claim: { practiceId }, initiatedAt: { gte: since }, outcome: 'RESOLVED' },
    }),
    prisma.callAttempt.count({
      where: { claim: { practiceId }, initiatedAt: { gte: since }, outcome: 'ESCALATED' },
    }),
    prisma.callAttempt.aggregate({
      where: { claim: { practiceId }, initiatedAt: { gte: since }, durationSeconds: { not: null } },
      _avg: { durationSeconds: true },
    }),
  ]);

  const avg = avgDuration._avg?.durationSeconds ?? null;

  return {
    totalCalls: total,
    resolvedCalls: resolved,
    resolutionRate: total > 0 ? Math.round((resolved / total) * 100) : 0,
    avgCallDurationSeconds: avg,
    escalationRate: total > 0 ? Math.round((escalated / total) * 100) : 0,
  };
}
