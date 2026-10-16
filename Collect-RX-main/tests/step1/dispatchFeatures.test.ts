// The manual-dispatch rollout flag resolves most specific first: a practice row
// decides for that practice; otherwise a paused global row turns it off;
// otherwise it is on. That is what makes a staged release possible.
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { DISPATCH_FEATURES, isDispatchFeatureEnabled } from '../../src/server/featureFlags/dispatchFeatures.js';

type Row = { practiceId: string | null; paused: boolean };

function enabled(rows: Row[], practiceId = 'p1') {
  const prisma = { featureFlag: { findMany: vi.fn(async () => rows) } };
  return isDispatchFeatureEnabled(prisma as unknown as PrismaClient, practiceId, DISPATCH_FEATURES.MANUAL_SHARED_BUILDER);
}

describe('isDispatchFeatureEnabled', () => {
  it('is ON by default: no row at all means on', async () => {
    expect(await enabled([])).toBe(true);
  });
  it('a paused global row turns it off for every practice', async () => {
    expect(await enabled([{ practiceId: null, paused: true }])).toBe(false);
    expect(await enabled([{ practiceId: null, paused: true }], 'p2')).toBe(false);
  });
  it('a practice row enabling it beats a paused global row (staged release)', async () => {
    expect(await enabled([{ practiceId: null, paused: true }, { practiceId: 'p1', paused: false }])).toBe(true);
  });
  it('a practice row only affects its own practice', async () => {
    // the query only returns rows for this practice and the global scope
    expect(await enabled([{ practiceId: null, paused: true }], 'p2')).toBe(false);
  });
  it('a paused practice row turns it off for that practice alone', async () => {
    expect(await enabled([{ practiceId: 'p1', paused: true }])).toBe(false);
    expect(await enabled([], 'p2')).toBe(true);
  });
  it('a paused practice row stays off when the global row is not paused', async () => {
    expect(await enabled([{ practiceId: null, paused: false }, { practiceId: 'p1', paused: true }])).toBe(false);
  });
  it('an unpaused global row alone leaves it on', async () => {
    expect(await enabled([{ practiceId: null, paused: false }])).toBe(true);
  });
  it('any paused global row among several turns it off', async () => {
    expect(await enabled([{ practiceId: null, paused: false }, { practiceId: null, paused: true }])).toBe(false);
  });
});

describe('isDispatchFeatureEnabled for a default-off feature (approval checkpoint)', () => {
  const checkpointEnabled = (rows: Row[], practiceId = 'p1') => {
    const prisma = { featureFlag: { findMany: vi.fn(async () => rows) } };
    return isDispatchFeatureEnabled(prisma as unknown as PrismaClient, practiceId, DISPATCH_FEATURES.APPROVAL_CHECKPOINT);
  };
  it('is OFF with no row, so a deploy never stalls calling', async () => {
    expect(await checkpointEnabled([])).toBe(false);
  });
  it('a practice row that is not paused turns it on for that practice only', async () => {
    expect(await checkpointEnabled([{ practiceId: 'p1', paused: false }])).toBe(true);
    expect(await checkpointEnabled([], 'p2')).toBe(false);
  });
  it('a global row that is not paused turns it on for every practice without its own row', async () => {
    expect(await checkpointEnabled([{ practiceId: null, paused: false }], 'p2')).toBe(true);
  });
  it('a paused practice row beats an enabled global row', async () => {
    expect(await checkpointEnabled([{ practiceId: null, paused: false }, { practiceId: 'p1', paused: true }])).toBe(false);
  });
  it('a paused global row keeps it off', async () => {
    expect(await checkpointEnabled([{ practiceId: null, paused: true }])).toBe(false);
  });
});
