/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Call Quality Scorer Service
 *
 * Aggregates and scores call quality across all carriers, agents, and time
 * periods. Provides:
 *   1. Success rate by carrier (RESOLVED/APPROVED outcomes)
 *   2. Average call duration trends (increasing/decreasing/stable)
 *   3. Agent performance metrics (success rates)
 *   4. Outcome distribution (RESOLVED%, TIMEOUT%, NOT_FOUND%, ESCALATED%)
 *   5. Quality score trends (week-over-week comparison)
 *
 * Public API:
 *   scoreCallQuality(prisma, since?, to?)      → comprehensive quality report
 *   scoreSingleCarrier(prisma, carrierId, since?, to?) → carrier-specific metrics
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CarrierId, PrismaClient } from '@prisma/client';
import { CARRIER_CONFIGS } from '../../carriers/adapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface QualityScoreInput {
  since?: Date;
  to?: Date;
  practiceId?: string; // If provided, scope to single practice; otherwise platform-wide
}

export interface CarrierQualityMetrics {
  carrierId: string;
  carrierName: string;
  successRate: number; // % (0-100): (RESOLVED + APPROVED) / total_calls
  successCount: number;
  totalCalls: number;
  avgDurationSeconds: number;
  durationTrend: 'increasing' | 'decreasing' | 'stable';
  outcomeDistribution: {
    resolved: number;
    approved: number;
    denied: number;
    escalated: number;
    failed: number;
    noAnswer: number;
    other: number;
  };
  outliers: string[];
}

export interface AgentPerformance {
  agentName: string;
  successRate: number; // % (0-100)
  totalCalls: number;
  successCount: number;
  avgDurationSeconds: number;
  carriers: string[]; // Carriers this agent primarily handles
}

export interface WeekOverWeekTrend {
  week: string; // ISO week start date (YYYY-MM-DD)
  callsCount: number;
  successRate: number;
  qualityScore: number; // 0-100
  durationTrend: number; // +/- change from previous week
}

export interface CallQualityReport {
  timestamp: Date;
  timeWindow: {
    from: Date;
    to: Date;
    days: number;
  };
  overallQualityScore: number; // 0-100
  overallSuccessRate: number; // % (0-100)
  trend: 'improving' | 'stable' | 'declining';
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;

  // By carrier
  carrierMetrics: CarrierQualityMetrics[];

  // By agent
  agentPerformance: AgentPerformance[];

  // Outcome distribution (platform-wide)
  outcomeDistribution: {
    resolved: number;
    approved: number;
    denied: number;
    escalated: number;
    failed: number;
    noAnswer: number;
    other: number;
  };

  // Time series for week-over-week analysis
  weeklyTrends: WeekOverWeekTrend[];

  // Escalation recommendations
  escalationRecommendations: {
    type: 'carrier' | 'agent' | 'outcome';
    subject: string;
    reason: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    suggestedAction: string;
  }[];

  // Quality outliers
  outliers: {
    lowPerformingCarriers: string[];
    highErrorRates: string[];
    unusualDurationPatterns: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const SUCCESS_OUTCOMES = new Set(['RESOLVED', 'APPROVED_PENDING_PAYMENT']);
const FAILURE_OUTCOMES = new Set(['FAILED', 'NO_ANSWER', 'HUNG_UP']);

// ─────────────────────────────────────────────────────────────────────────────
// MAIN API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score call quality across all carriers and agents.
 *
 * Default window: last 30 days from now.
 */
export async function scoreCallQuality(
  prisma: PrismaClient,
  input: QualityScoreInput = {},
): Promise<CallQualityReport> {
  const to = input.to ?? new Date();
  const since = input.since ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Fetch all call attempts in the window
  const callAttempts = await prisma.callAttempt.findMany({
    where: {
      initiatedAt: { gte: since, lte: to },
      ...(input.practiceId ? { claim: { practiceId: input.practiceId } } : {}),
    },
    include: {
      claim: { select: { carrierId: true, practiceId: true } },
    },
    orderBy: { initiatedAt: 'asc' },
  });

  // Aggregate metrics by carrier
  const carrierMetrics = computeCarrierMetrics(callAttempts);

  // Aggregate metrics by agent
  const agentMetrics = computeAgentMetrics(callAttempts);

  // Overall outcome distribution
  const outcomeDistribution = computeOutcomeDistribution(callAttempts);

  // Week-over-week trends
  const weeklyTrends = computeWeeklyTrends(callAttempts, since, to);

  // Overall quality score and success rate
  const successfulCalls = callAttempts.filter((a) =>
    SUCCESS_OUTCOMES.has(a.outcome as string),
  ).length;
  const failedCalls = callAttempts.filter((a) =>
    FAILURE_OUTCOMES.has(a.outcome as string),
  ).length;

  const overallSuccessRate =
    callAttempts.length > 0
      ? Math.round((successfulCalls / callAttempts.length) * 100)
      : 0;

  const overallQualityScore = calculateQualityScore(
    overallSuccessRate,
    callAttempts,
  );

  // Determine trend
  const trend = determineTrend(weeklyTrends);

  // Identify outliers
  const outliers = identifyOutliers(carrierMetrics, agentMetrics);

  // Generate escalation recommendations
  const escalationRecommendations = generateEscalationRecommendations(
    carrierMetrics,
    agentMetrics,
    outcomeDistribution,
  );

  const daysDiff = Math.round(
    (to.getTime() - since.getTime()) / (1000 * 60 * 60 * 24),
  );

  return {
    timestamp: new Date(),
    timeWindow: {
      from: since,
      to,
      days: daysDiff,
    },
    overallQualityScore,
    overallSuccessRate,
    trend,
    totalCalls: callAttempts.length,
    successfulCalls,
    failedCalls,
    carrierMetrics: sortBySuccessRate(carrierMetrics),
    agentPerformance: sortAgentsBySuccessRate(agentMetrics),
    outcomeDistribution,
    weeklyTrends,
    escalationRecommendations,
    outliers,
  };
}

/**
 * Score quality for a single carrier.
 */
export async function scoreSingleCarrier(
  prisma: PrismaClient,
  carrierId: CarrierId,
  input: QualityScoreInput = {},
): Promise<CarrierQualityMetrics> {
  const to = input.to ?? new Date();
  const since = input.since ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  const calls = await prisma.callAttempt.findMany({
    where: {
      claim: { carrierId, ...(input.practiceId ? { practiceId: input.practiceId } : {}) },
      initiatedAt: { gte: since, lte: to },
    },
    include: { claim: { select: { carrierId: true } } },
    orderBy: { initiatedAt: 'asc' },
  });

  if (calls.length === 0) {
    return {
      carrierId: String(carrierId),
      carrierName: CARRIER_CONFIGS[carrierId]?.displayName ?? String(carrierId),
      successRate: 0,
      successCount: 0,
      totalCalls: 0,
      avgDurationSeconds: 0,
      durationTrend: 'stable',
      outcomeDistribution: {
        resolved: 0,
        approved: 0,
        denied: 0,
        escalated: 0,
        failed: 0,
        noAnswer: 0,
        other: 0,
      },
      outliers: [],
    };
  }

  const successCount = calls.filter((c) =>
    SUCCESS_OUTCOMES.has(c.outcome as string),
  ).length;
  const totalDuration = calls
    .filter((c) => c.durationSeconds)
    .reduce((sum, c) => sum + (c.durationSeconds ?? 0), 0);
  const durationTrend = calculateDurationTrend(calls);
  const outcomeDistribution = computeOutcomeDistributionForCalls(calls);

  return {
    carrierId: String(carrierId),
    carrierName: CARRIER_CONFIGS[carrierId]?.displayName ?? String(carrierId),
    successRate: Math.round((successCount / calls.length) * 100),
    successCount,
    totalCalls: calls.length,
    avgDurationSeconds:
      calls.filter((c) => c.durationSeconds).length > 0
        ? Math.round(
            totalDuration /
              calls.filter((c) => c.durationSeconds).length,
          )
        : 0,
    durationTrend,
    outcomeDistribution,
    outliers: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function computeCarrierMetrics(
  calls: Array<{ outcome: string | null; claim: { carrierId: string } | null; durationSeconds: number | null; initiatedAt: Date }>,
): CarrierQualityMetrics[] {
  const byCarrier = new Map<
    string,
    {
      calls: Array<{ outcome: string | null; durationSeconds: number | null; initiatedAt: Date }>;
    }
  >();

  for (const call of calls) {
    const cid = call.claim?.carrierId ?? 'unknown';
    if (!byCarrier.has(cid)) {
      byCarrier.set(cid, { calls: [] });
    }
    byCarrier.get(cid)!.calls.push({ outcome: call.outcome, durationSeconds: call.durationSeconds, initiatedAt: call.initiatedAt });
  }

  return Array.from(byCarrier.entries()).map(([carrierId, data]) => {
    const successCount = data.calls.filter((c) =>
      SUCCESS_OUTCOMES.has(c.outcome as string),
    ).length;
    const totalDuration = data.calls
      .filter((c) => c.durationSeconds)
      .reduce((sum, c) => sum + (c.durationSeconds ?? 0), 0);
    const durationCount = data.calls.filter((c) => c.durationSeconds).length;
    const durationTrend = calculateDurationTrend(data.calls);
    const outcomeDistribution = computeOutcomeDistributionForCalls(data.calls);

    return {
      carrierId,
      carrierName: CARRIER_CONFIGS[carrierId as CarrierId]?.displayName ?? carrierId,
      successRate: Math.round((successCount / data.calls.length) * 100),
      successCount,
      totalCalls: data.calls.length,
      avgDurationSeconds: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
      durationTrend,
      outcomeDistribution,
      outliers: [],
    };
  });
}

function computeAgentMetrics(
  calls: Array<{
    activeAgent: string | null;
    outcome: string | null;
    durationSeconds: number | null;
    claim: { carrierId: string } | null;
  }>,
): AgentPerformance[] {
  const byAgent = new Map<
    string,
    {
      calls: typeof calls;
      carriers: Set<string>;
    }
  >();

  for (const call of calls) {
    const agent = call.activeAgent ?? 'unknown';
    if (!byAgent.has(agent)) {
      byAgent.set(agent, { calls: [], carriers: new Set() });
    }
    const data = byAgent.get(agent)!;
    data.calls.push(call);
    if (call.claim?.carrierId) {
      data.carriers.add(call.claim.carrierId);
    }
  }

  return Array.from(byAgent.entries()).map(([agentName, data]) => {
    const successCount = data.calls.filter((c) =>
      SUCCESS_OUTCOMES.has(c.outcome as string),
    ).length;
    const totalDuration = data.calls
      .filter((c) => c.durationSeconds)
      .reduce((sum, c) => sum + (c.durationSeconds ?? 0), 0);
    const durationCount = data.calls.filter((c) => c.durationSeconds).length;

    return {
      agentName,
      successRate: Math.round((successCount / data.calls.length) * 100),
      totalCalls: data.calls.length,
      successCount,
      avgDurationSeconds: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
      carriers: Array.from(data.carriers),
    };
  });
}

function computeOutcomeDistribution(
  calls: Array<{ outcome: string | null }>,
): ReturnType<typeof computeOutcomeDistributionForCalls> {
  return computeOutcomeDistributionForCalls(calls);
}

function computeOutcomeDistributionForCalls(
  calls: Array<{ outcome: string | null }>,
) {
  const dist = {
    resolved: 0,
    approved: 0,
    denied: 0,
    escalated: 0,
    failed: 0,
    noAnswer: 0,
    other: 0,
  };

  for (const call of calls) {
    const outcome = call.outcome ?? 'other';
    if (outcome === 'RESOLVED') dist.resolved++;
    else if (outcome === 'APPROVED_PENDING_PAYMENT') dist.approved++;
    else if (outcome === 'DENIED') dist.denied++;
    else if (outcome === 'ESCALATED') dist.escalated++;
    else if (outcome === 'FAILED') dist.failed++;
    else if (outcome === 'NO_ANSWER') dist.noAnswer++;
    else dist.other++;
  }

  return dist;
}

function computeWeeklyTrends(
  calls: Array<{
    initiatedAt: Date;
    outcome: string | null;
    durationSeconds: number | null;
  }>,
  since: Date,
  to: Date,
): WeekOverWeekTrend[] {
  const weekMap = new Map<string, typeof calls>();

  for (const call of calls) {
    const weekStart = getWeekStart(call.initiatedAt);
    const key = weekStart.toISOString().split('T')[0];
    if (!weekMap.has(key)) {
      weekMap.set(key, []);
    }
    weekMap.get(key)!.push(call);
  }

  const trends: WeekOverWeekTrend[] = [];
  let cursor = getWeekStart(since);
  const endUtc = getWeekStart(new Date(to.getTime() + 7 * 24 * 60 * 60 * 1000));

  while (cursor <= endUtc) {
    const key = cursor.toISOString().split('T')[0];
    const weekCalls = weekMap.get(key) ?? [];

    const successCount = weekCalls.filter((c) =>
      SUCCESS_OUTCOMES.has(c.outcome as string),
    ).length;
    const successRate =
      weekCalls.length > 0
        ? Math.round((successCount / weekCalls.length) * 100)
        : 0;

    const qualityScore = calculateQualityScore(successRate, weekCalls);

    // Calculate duration trend vs previous week
    const prevWeekKey = new Date(
      cursor.getTime() - 7 * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .split('T')[0];
    const prevWeekCalls = weekMap.get(prevWeekKey) ?? [];
    const prevWeekAvgDuration =
      prevWeekCalls.filter((c) => c.durationSeconds).length > 0
        ? prevWeekCalls
            .filter((c) => c.durationSeconds)
            .reduce((s, c) => s + (c.durationSeconds ?? 0), 0) /
          prevWeekCalls.filter((c) => c.durationSeconds).length
        : 0;

    const currentAvgDuration =
      weekCalls.filter((c) => c.durationSeconds).length > 0
        ? weekCalls
            .filter((c) => c.durationSeconds)
            .reduce((s, c) => s + (c.durationSeconds ?? 0), 0) /
          weekCalls.filter((c) => c.durationSeconds).length
        : 0;

    const durationTrend = Math.round(currentAvgDuration - prevWeekAvgDuration);

    trends.push({
      week: key,
      callsCount: weekCalls.length,
      successRate,
      qualityScore,
      durationTrend,
    });

    cursor = new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  return trends;
}

function calculateQualityScore(
  successRate: number,
  calls: Array<{ durationSeconds?: number | null }>,
): number {
  // Quality score factors:
  // - Success rate (60% weight)
  // - Reasonable call duration (20% weight) — too short or too long is bad
  // - Volume consistency (20% weight)

  const baseScore = successRate * 0.6;

  // Duration quality: expect 120-300 seconds (2-5 min)
  const validDurationCalls = calls.filter((c) => c.durationSeconds);
  let durationScore = 20;
  if (validDurationCalls.length > 0) {
    const avgDuration =
      validDurationCalls.reduce((s, c) => s + (c.durationSeconds ?? 0), 0) /
      validDurationCalls.length;
    if (avgDuration >= 120 && avgDuration <= 300) {
      durationScore = 20;
    } else if (avgDuration < 60 || avgDuration > 600) {
      durationScore = 0;
    } else {
      // Partial credit for marginal durations
      durationScore = 10;
    }
  }

  // Volume: penalize very small or very large single-call reports
  const volumeScore = calls.length >= 5 ? 20 : calls.length >= 1 ? 10 : 0;

  return Math.min(100, Math.round(baseScore + durationScore + volumeScore));
}

function calculateDurationTrend(
  calls: Array<{ initiatedAt: Date; durationSeconds: number | null }>,
): 'increasing' | 'decreasing' | 'stable' {
  const sorted = calls.sort((a, b) => a.initiatedAt.getTime() - b.initiatedAt.getTime());
  const validCalls = sorted.filter((c) => c.durationSeconds);

  if (validCalls.length < 4) return 'stable';

  const half = Math.floor(validCalls.length / 2);
  const firstHalf = validCalls.slice(0, half);
  const secondHalf = validCalls.slice(half);

  const avgFirst =
    firstHalf.reduce((s, c) => s + (c.durationSeconds ?? 0), 0) /
    firstHalf.length;
  const avgSecond =
    secondHalf.reduce((s, c) => s + (c.durationSeconds ?? 0), 0) /
    secondHalf.length;

  const diff = avgSecond - avgFirst;
  if (Math.abs(diff) < 10) return 'stable';
  return diff > 0 ? 'increasing' : 'decreasing';
}

function determineTrend(
  weeklyTrends: WeekOverWeekTrend[],
): 'improving' | 'stable' | 'declining' {
  if (weeklyTrends.length < 2) return 'stable';

  const recent = weeklyTrends.slice(-2);
  if (recent.length < 2) return 'stable';

  const prevScore = recent[0].qualityScore;
  const currentScore = recent[1].qualityScore;
  const diff = currentScore - prevScore;

  if (Math.abs(diff) < 3) return 'stable';
  return diff > 0 ? 'improving' : 'declining';
}

function identifyOutliers(
  carrierMetrics: CarrierQualityMetrics[],
  agentMetrics: AgentPerformance[],
) {
  const lowPerformingCarriers = carrierMetrics
    .filter((c) => c.successRate < 40 && c.totalCalls >= 5)
    .map((c) => `${c.carrierName} (${c.successRate}%)`);

  const highErrorRates = agentMetrics
    .filter((a) => a.successRate < 30 && a.totalCalls >= 10)
    .map((a) => `${a.agentName} (${a.successRate}%)`);

  const unusualDurationPatterns = agentMetrics
    .filter((a) => a.avgDurationSeconds < 60 || a.avgDurationSeconds > 600)
    .map((a) => `${a.agentName} (${a.avgDurationSeconds}s avg)`);

  return {
    lowPerformingCarriers,
    highErrorRates,
    unusualDurationPatterns,
  };
}

function generateEscalationRecommendations(
  carrierMetrics: CarrierQualityMetrics[],
  agentMetrics: AgentPerformance[],
  outcomeDistribution: ReturnType<typeof computeOutcomeDistributionForCalls>,
): CallQualityReport['escalationRecommendations'] {
  const recommendations: CallQualityReport['escalationRecommendations'] = [];

  // Escalate low-performing carriers
  for (const carrier of carrierMetrics) {
    if (carrier.successRate < 40 && carrier.totalCalls >= 10) {
      recommendations.push({
        type: 'carrier',
        subject: carrier.carrierName,
        reason: `Success rate of ${carrier.successRate}% is below acceptable threshold (50%)`,
        severity: carrier.successRate < 25 ? 'critical' : 'high',
        suggestedAction:
          `Review carrier ${carrier.carrierName} IVR navigation, escalation procedures, and rep engagement strategy`,
      });
    }
  }

  // Escalate high-error agents
  for (const agent of agentMetrics) {
    if (agent.successRate < 30 && agent.totalCalls >= 20) {
      recommendations.push({
        type: 'agent',
        subject: agent.agentName,
        reason: `Error rate of ${100 - agent.successRate}% for ${agent.totalCalls} calls`,
        severity: 'high',
        suggestedAction: `Review ${agent.agentName} transcripts; consider tuning prompt or reducing call volume temporarily`,
      });
    }
  }

  // Escalate unusual outcome patterns
  const total =
    outcomeDistribution.resolved +
    outcomeDistribution.approved +
    outcomeDistribution.denied +
    outcomeDistribution.escalated +
    outcomeDistribution.failed +
    outcomeDistribution.noAnswer;

  if (total > 0) {
    const escalationRate = Math.round(
      ((outcomeDistribution.escalated + outcomeDistribution.denied) / total) * 100,
    );
    if (escalationRate > 30) {
      recommendations.push({
        type: 'outcome',
        subject: 'High escalation/denial rate',
        reason: `${escalationRate}% of calls result in ESCALATED or DENIED outcomes`,
        severity: 'medium',
        suggestedAction: `Analyze top denial reasons and adjust pre-call validation or documentation requirements`,
      });
    }
  }

  return recommendations;
}

function sortBySuccessRate(
  metrics: CarrierQualityMetrics[],
): CarrierQualityMetrics[] {
  return metrics.sort((a, b) => b.successRate - a.successRate);
}

function sortAgentsBySuccessRate(metrics: AgentPerformance[]): AgentPerformance[] {
  return metrics.sort((a, b) => b.successRate - a.successRate);
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
