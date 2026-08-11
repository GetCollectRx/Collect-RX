import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Prospect } from '@prisma/client';
import { makeProspect } from '../factories/prospect.js';
import {
  computeProspectScore,
  DEFAULT_SCORE_WEIGHTS,
  normalizeScoreWeights,
  signalsFromProspect,
} from '../../src/server/marketing/prospectScoring.js';
import { runMarketingLearningCycle } from '../../src/server/marketing/marketingLearningJob.js';

const baseProspect: Prospect = makeProspect({
  website: 'https://downtown.ca',
  stage: 'closed_won',
  source: 'referral',
  pmsHint: 'Abeldent',
  sequenceStep: 0,
  sequenceCompleted: true,
  closedWonAt: new Date(),
  metadata: { rating: 4.6 },
});

describe('prospectScoring', () => {
  it('scores referral + phone + website higher than bare base', () => {
    const rich = computeProspectScore(signalsFromProspect(baseProspect), DEFAULT_SCORE_WEIGHTS);
    const bare = computeProspectScore(
      {
        hasPhone: false,
        hasWebsite: false,
        hasEmail: false,
        rating: null,
        source: 'manual',
        hasPmsHint: false,
      },
      DEFAULT_SCORE_WEIGHTS,
    );
    expect(rich).toBeGreaterThan(bare);
    expect(rich).toBeLessThanOrEqual(100);
  });

  it('clamps learned weights to safe bounds', () => {
    const w = normalizeScoreWeights({
      base: 999,
      hasPhone: -50,
      sourceReferral: 100,
    });
    expect(w.base).toBeLessThanOrEqual(60);
    expect(w.hasPhone).toBeGreaterThanOrEqual(0);
    expect(w.sourceReferral).toBeLessThanOrEqual(25);
  });
});

describe('runMarketingLearningCycle', () => {
  it('skips when fewer than 8 closed outcomes', async () => {
    const prisma = {
      prospect: {
        findMany: vi.fn().mockResolvedValue([
          { ...baseProspect, stage: 'closed_won' },
          { ...baseProspect, id: 'p2', stage: 'closed_lost' },
        ]),
      },
      marketingScoreConfig: {
        findUnique: vi.fn().mockResolvedValue({ weights: DEFAULT_SCORE_WEIGHTS }),
      },
    } as unknown as PrismaClient;

    const result = await runMarketingLearningCycle(prisma);
    expect(result.skipped).toBe(true);
    expect(result.prospectsRescored).toBe(0);
  });

  it('adjusts weights and rescores when enough outcomes exist', async () => {
    const closedWonReferrals = Array.from({ length: 5 }, (_, i) => ({
      ...baseProspect,
      id: `w${i}`,
      stage: 'closed_won' as const,
      source: 'referral' as const,
    }));
    const closedLostManual = Array.from({ length: 5 }, (_, i) => ({
      ...baseProspect,
      id: `l${i}`,
      stage: 'closed_lost' as const,
      source: 'manual' as const,
      phone: null,
      website: null,
      pmsHint: null,
      metadata: null,
    }));

    const activeProspect = {
      id: 'active1',
      phone: '4165550199',
      website: null,
      email: 'a@b.ca',
      source: 'harvest' as const,
      pmsHint: null,
      metadata: { rating: 4.2 },
      score: 40,
    };

    const upsert = vi.fn().mockResolvedValue({});
    const update = vi.fn().mockResolvedValue({});
    const create = vi.fn().mockResolvedValue({});

    const prisma = {
      prospect: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([...closedWonReferrals, ...closedLostManual])
          .mockResolvedValueOnce([activeProspect]),
        update,
      },
      marketingScoreConfig: {
        findUnique: vi.fn().mockResolvedValue({ weights: DEFAULT_SCORE_WEIGHTS }),
        upsert,
      },
      marketingLearningRun: { create },
    } as unknown as PrismaClient;

    const result = await runMarketingLearningCycle(prisma);
    expect(result.skipped).toBe(false);
    expect(result.wins).toBe(5);
    expect(result.losses).toBe(5);
    expect(upsert).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });
});
