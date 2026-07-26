// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Assumption Validation (Day 30/60/90)
//
// Phase 7 acceptance criteria: after a pilot window, three assumptions must
// hold before scaling —
//   1. Carriers accept AI calls (acceptance rate: calls that reached a
//      carrier conversation vs. calls rejected/blocked/unanswered)
//   2. Resolution rate ≥ 60% of completed calls
//   3. Recovered revenue exceeds the subscription cost (ROI ≥ 1)
// ─────────────────────────────────────────────────────────────────────────────

import type { PrismaClient } from '@prisma/client';
import { TIERS } from '../../billing/tiers.js';

export const RESOLUTION_RATE_TARGET_PCT = 60;

/** Outcomes where the carrier never engaged in a conversation. */
const NOT_ACCEPTED_OUTCOMES = ['BLOCK_DETECTED', 'FAILED', 'NO_ANSWER', 'HUNG_UP'] as const;

export type ValidationWindowDays = 30 | 60 | 90;

export interface AssumptionValidationReport {
  windowDays: ValidationWindowDays;
  periodStart: string;
  periodEnd: string;
  carrierAcceptance: {
    totalCompletedCalls: number;
    acceptedCalls: number;
    ratePct: number | null;
  };
  resolution: {
    totalCompletedCalls: number;
    resolvedCalls: number;
    ratePct: number | null;
    targetPct: number;
    meetsTarget: boolean | null;
  };
  roi: {
    revenueRecovered: number;
    billingTier: string;
    subscriptionCost: number;
    ratio: number | null;
    positive: boolean | null;
  };
}

export function parseValidationWindow(raw: unknown): ValidationWindowDays {
  const n = parseInt(String(raw ?? '30'), 10);
  return n === 60 || n === 90 ? n : 30;
}

export async function computeAssumptionValidation(
  prisma: PrismaClient,
  practiceId: string,
  windowDays: ValidationWindowDays,
  now = new Date(),
): Promise<AssumptionValidationReport> {
  const periodStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const [attempts, practice] = await Promise.all([
    prisma.callAttempt.findMany({
      where: {
        completedAt: { gte: periodStart, lte: now },
        outcome: { not: null },
        claim: { practiceId },
      },
      select: {
        outcome: true,
        claim: { select: { billedAmount: true } },
      },
    }),
    prisma.practice.findUnique({
      where: { id: practiceId },
      select: { billingTier: true },
    }),
  ]);

  const total = attempts.length;
  const accepted = attempts.filter(
    (a) => !NOT_ACCEPTED_OUTCOMES.includes(a.outcome as (typeof NOT_ACCEPTED_OUTCOMES)[number]),
  ).length;
  const resolvedAttempts = attempts.filter((a) => a.outcome === 'RESOLVED');
  const resolved = resolvedAttempts.length;

  const revenueRecovered = resolvedAttempts.reduce(
    (sum, a) => sum + Number(a.claim?.billedAmount ?? 0),
    0,
  );

  const billingTier = practice?.billingTier ?? 'trial';
  const monthlyPrice = TIERS[billingTier]?.price ?? 0;
  const subscriptionCost = Math.round(monthlyPrice * (windowDays / 30) * 100) / 100;

  const pct = (num: number, denom: number): number | null =>
    denom > 0 ? Math.round((num / denom) * 1000) / 10 : null;

  const resolutionRatePct = pct(resolved, total);
  const roiRatio =
    subscriptionCost > 0 ? Math.round((revenueRecovered / subscriptionCost) * 100) / 100 : null;

  return {
    windowDays,
    periodStart: periodStart.toISOString(),
    periodEnd: now.toISOString(),
    carrierAcceptance: {
      totalCompletedCalls: total,
      acceptedCalls: accepted,
      ratePct: pct(accepted, total),
    },
    resolution: {
      totalCompletedCalls: total,
      resolvedCalls: resolved,
      ratePct: resolutionRatePct,
      targetPct: RESOLUTION_RATE_TARGET_PCT,
      meetsTarget: resolutionRatePct === null ? null : resolutionRatePct >= RESOLUTION_RATE_TARGET_PCT,
    },
    roi: {
      revenueRecovered: Math.round(revenueRecovered * 100) / 100,
      billingTier,
      subscriptionCost,
      ratio: roiRatio,
      positive: roiRatio === null ? null : roiRatio >= 1,
    },
  };
}
