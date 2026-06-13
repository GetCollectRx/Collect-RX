import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, Prospect } from '@prisma/client';
import {
  computeProspectScore,
  DEFAULT_SCORE_WEIGHTS,
  loadScoreWeights,
  normalizeScoreWeights,
  saveScoreWeights,
  signalsFromProspect,
  type ScoreWeights,
} from './prospectScoring.js';

const MIN_CLOSED_OUTCOMES = 8;
const MIN_PER_BUCKET = 3;
const MAX_WEIGHT_DELTA = 5;

export interface MarketingLearningSummary {
  skipped: boolean;
  reason?: string;
  wins: number;
  losses: number;
  baselineWinRate: number;
  adjustments: Array<{ feature: keyof ScoreWeights; delta: number; lift: number }>;
  prospectsRescored: number;
  weightsBefore: ScoreWeights;
  weightsAfter: ScoreWeights;
}

type FeatureKey = Exclude<keyof ScoreWeights, 'base'>;

const FEATURE_KEYS: FeatureKey[] = [
  'hasPhone',
  'hasWebsite',
  'hasEmail',
  'ratingGte4',
  'ratingGte45',
  'sourceReferral',
  'sourceHarvest',
  'hasPmsHint',
];

function hasFeature(prospect: Prospect, key: FeatureKey): boolean {
  const s = signalsFromProspect(prospect);
  switch (key) {
    case 'hasPhone':
      return s.hasPhone;
    case 'hasWebsite':
      return s.hasWebsite;
    case 'hasEmail':
      return s.hasEmail;
    case 'ratingGte4':
      return s.rating != null && s.rating >= 4;
    case 'ratingGte45':
      return s.rating != null && s.rating >= 4.5;
    case 'sourceReferral':
      return s.source === 'referral';
    case 'sourceHarvest':
      return s.source === 'harvest';
    case 'hasPmsHint':
      return s.hasPmsHint;
    default:
      return false;
  }
}

function computeLift(
  closed: Prospect[],
  key: FeatureKey,
  baselineWinRate: number,
): { lift: number; withCount: number } | null {
  const withFeature = closed.filter((p) => hasFeature(p, key));
  const without = closed.filter((p) => !hasFeature(p, key));

  if (withFeature.length < MIN_PER_BUCKET && without.length < MIN_PER_BUCKET) {
    return null;
  }

  const winsWith = withFeature.filter((p) => p.stage === 'closed_won').length;
  const winRateWith = withFeature.length > 0 ? winsWith / withFeature.length : baselineWinRate;

  const winsWithout = without.filter((p) => p.stage === 'closed_won').length;
  const winRateWithout = without.length > 0 ? winsWithout / without.length : baselineWinRate;

  const lift = winRateWith - winRateWithout;
  return { lift, withCount: withFeature.length };
}

function adjustWeights(
  current: ScoreWeights,
  closed: Prospect[],
): { weights: ScoreWeights; adjustments: MarketingLearningSummary['adjustments'] } {
  const wins = closed.filter((p) => p.stage === 'closed_won').length;
  const losses = closed.filter((p) => p.stage === 'closed_lost').length;
  const baselineWinRate = wins / (wins + losses);

  const next = { ...current };
  const adjustments: MarketingLearningSummary['adjustments'] = [];

  for (const key of FEATURE_KEYS) {
    const result = computeLift(closed, key, baselineWinRate);
    if (!result) continue;

    const { lift } = result;
    if (Math.abs(lift) < 0.08) continue;

    const delta = Math.sign(lift) * Math.min(MAX_WEIGHT_DELTA, Math.round(Math.abs(lift) * 25));
    if (delta === 0) continue;

    next[key] = normalizeScoreWeights({ ...next, [key]: next[key] + delta })[key];
    adjustments.push({ feature: key, delta, lift: Math.round(lift * 1000) / 1000 });
  }

  // Nudge base score toward overall win rate (small correction)
  if (baselineWinRate > 0.35 && next.base < 55) {
    next.base = Math.min(55, next.base + 2);
    adjustments.push({ feature: 'base', delta: 2, lift: baselineWinRate });
  } else if (baselineWinRate < 0.15 && next.base > 30) {
    next.base = Math.max(30, next.base - 2);
    adjustments.push({ feature: 'base', delta: -2, lift: baselineWinRate });
  }

  return { weights: normalizeScoreWeights(next), adjustments };
}

async function rescoreActiveProspects(
  prisma: PrismaClient,
  weights: ScoreWeights,
): Promise<number> {
  const active = await prisma.prospect.findMany({
    where: {
      stage: { in: ['new', 'contacted', 'engaged', 'qualified', 'demo_booked'] },
      optOutAt: null,
    },
    select: {
      id: true,
      phone: true,
      website: true,
      email: true,
      source: true,
      pmsHint: true,
      metadata: true,
      score: true,
    },
  });

  let updated = 0;
  for (const p of active) {
    const nextScore = computeProspectScore(signalsFromProspect(p), weights);
    if (nextScore !== p.score) {
      await prisma.prospect.update({
        where: { id: p.id },
        data: { score: nextScore },
      });
      updated++;
    }
  }
  return updated;
}

export function isMarketingLearningEnabled(): boolean {
  const raw = (process.env.MARKETING_LEARNING_ENABLED ?? '1').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

export function marketingLearningCronExpression(): string {
  return (process.env.MARKETING_LEARNING_CRON || '0 7 * * 1').trim();
}

export async function runMarketingLearningCycle(
  prisma: PrismaClient,
): Promise<MarketingLearningSummary> {
  const weightsBefore = await loadScoreWeights(prisma);

  const closed = await prisma.prospect.findMany({
    where: { stage: { in: ['closed_won', 'closed_lost'] } },
  });

  const wins = closed.filter((p) => p.stage === 'closed_won').length;
  const losses = closed.filter((p) => p.stage === 'closed_lost').length;

  if (wins + losses < MIN_CLOSED_OUTCOMES) {
    const summary: MarketingLearningSummary = {
      skipped: true,
      reason: `Need at least ${MIN_CLOSED_OUTCOMES} closed outcomes (have ${wins + losses})`,
      wins,
      losses,
      baselineWinRate: wins + losses > 0 ? wins / (wins + losses) : 0,
      adjustments: [],
      prospectsRescored: 0,
      weightsBefore,
      weightsAfter: weightsBefore,
    };
    return summary;
  }

  const { weights: weightsAfter, adjustments } = adjustWeights(weightsBefore, closed);
  const baselineWinRate = wins / (wins + losses);
  const prospectsRescored = await rescoreActiveProspects(prisma, weightsAfter);

  const stats = {
    lastRunAt: new Date().toISOString(),
    wins,
    losses,
    baselineWinRate: Math.round(baselineWinRate * 1000) / 1000,
    adjustments,
    prospectsRescored,
  };

  await saveScoreWeights(prisma, weightsAfter, stats);

  await prisma.marketingLearningRun.create({
    data: {
      id: randomUUID(),
      wins,
      losses,
      prospectsRescored,
      weightsBefore: weightsBefore as Prisma.InputJsonValue,
      weightsAfter: weightsAfter as Prisma.InputJsonValue,
      summary: stats as Prisma.InputJsonValue,
    },
  });

  console.log('[marketing-learning] cycle complete', stats);

  return {
    skipped: false,
    wins,
    losses,
    baselineWinRate,
    adjustments,
    prospectsRescored,
    weightsBefore,
    weightsAfter,
  };
}

/** Seed default config row if migration insert was skipped. */
export async function ensureMarketingScoreConfig(prisma: PrismaClient): Promise<void> {
  await prisma.marketingScoreConfig.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      weights: DEFAULT_SCORE_WEIGHTS as Prisma.InputJsonValue,
      stats: { version: 1 } as Prisma.InputJsonValue,
    },
    update: {},
  });
}
