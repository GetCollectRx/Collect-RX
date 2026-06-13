import type { Prisma, PrismaClient, Prospect, ProspectSource } from '@prisma/client';

/** Tunable weights for prospect harvest / outreach priority scoring. */
export interface ScoreWeights {
  base: number;
  hasPhone: number;
  hasWebsite: number;
  hasEmail: number;
  ratingGte4: number;
  ratingGte45: number;
  sourceReferral: number;
  sourceHarvest: number;
  hasPmsHint: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  base: 40,
  hasPhone: 20,
  hasWebsite: 15,
  hasEmail: 5,
  ratingGte4: 10,
  ratingGte45: 5,
  sourceReferral: 15,
  sourceHarvest: 0,
  hasPmsHint: 5,
};

const WEIGHT_BOUNDS: Record<keyof ScoreWeights, { min: number; max: number }> = {
  base: { min: 20, max: 60 },
  hasPhone: { min: 0, max: 30 },
  hasWebsite: { min: 0, max: 25 },
  hasEmail: { min: 0, max: 15 },
  ratingGte4: { min: 0, max: 20 },
  ratingGte45: { min: 0, max: 15 },
  sourceReferral: { min: 0, max: 25 },
  sourceHarvest: { min: -10, max: 10 },
  hasPmsHint: { min: 0, max: 15 },
};

export interface ProspectSignals {
  hasPhone: boolean;
  hasWebsite: boolean;
  hasEmail: boolean;
  rating: number | null;
  source: ProspectSource;
  hasPmsHint: boolean;
}

function clampWeight(key: keyof ScoreWeights, value: number): number {
  const { min, max } = WEIGHT_BOUNDS[key];
  return Math.round(Math.min(max, Math.max(min, value)));
}

export function normalizeScoreWeights(raw: unknown): ScoreWeights {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<ScoreWeights>;
  const out = { ...DEFAULT_SCORE_WEIGHTS };
  for (const key of Object.keys(DEFAULT_SCORE_WEIGHTS) as (keyof ScoreWeights)[]) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[key] = clampWeight(key, v);
    }
  }
  return out;
}

export function computeProspectScore(signals: ProspectSignals, weights: ScoreWeights): number {
  let score = weights.base;
  if (signals.hasPhone) score += weights.hasPhone;
  if (signals.hasWebsite) score += weights.hasWebsite;
  if (signals.hasEmail) score += weights.hasEmail;
  if (signals.rating != null && signals.rating >= 4) score += weights.ratingGte4;
  if (signals.rating != null && signals.rating >= 4.5) score += weights.ratingGte45;
  if (signals.source === 'referral') score += weights.sourceReferral;
  if (signals.source === 'harvest') score += weights.sourceHarvest;
  if (signals.hasPmsHint) score += weights.hasPmsHint;
  return Math.min(100, Math.max(0, Math.round(score)));
}

export function signalsFromProspect(prospect: Pick<
  Prospect,
  'phone' | 'website' | 'email' | 'source' | 'pmsHint' | 'metadata'
>): ProspectSignals {
  const meta = prospect.metadata as { rating?: number | null } | null;
  const rating =
    typeof meta?.rating === 'number' && Number.isFinite(meta.rating) ? meta.rating : null;
  return {
    hasPhone: Boolean(prospect.phone?.trim()),
    hasWebsite: Boolean(prospect.website?.trim()),
    hasEmail: Boolean(prospect.email?.trim()),
    rating,
    source: prospect.source,
    hasPmsHint: Boolean(prospect.pmsHint?.trim()),
  };
}

export interface HarvestPlaceSignals {
  formatted_phone_number?: string;
  website?: string;
  rating?: number;
}

export function signalsFromHarvestPlace(place: HarvestPlaceSignals): ProspectSignals {
  return {
    hasPhone: Boolean(place.formatted_phone_number?.trim()),
    hasWebsite: Boolean(place.website?.trim()),
    hasEmail: false,
    rating: typeof place.rating === 'number' ? place.rating : null,
    source: 'harvest',
    hasPmsHint: false,
  };
}

export async function loadScoreWeights(prisma: PrismaClient): Promise<ScoreWeights> {
  const row = await prisma.marketingScoreConfig.findUnique({ where: { id: 'default' } });
  if (!row) return DEFAULT_SCORE_WEIGHTS;
  return normalizeScoreWeights(row.weights);
}

export async function saveScoreWeights(
  prisma: PrismaClient,
  weights: ScoreWeights,
  stats: Record<string, unknown>,
): Promise<void> {
  const weightsJson = weights as Prisma.InputJsonValue;
  const statsJson = stats as Prisma.InputJsonValue;
  await prisma.marketingScoreConfig.upsert({
    where: { id: 'default' },
    create: { id: 'default', weights: weightsJson, stats: statsJson },
    update: { weights: weightsJson, stats: statsJson },
  });
}
