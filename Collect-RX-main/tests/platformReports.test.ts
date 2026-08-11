import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { computeCarrierStats } from '../src/server/services/platformReports.js';

interface FakeAttempt {
  claimId: string;
  claim: { carrierId: string };
  initiatedAt: Date;
  completedAt: Date | null;
  durationSeconds: number | null;
  outcome: string | null;
  outcomeDetail: string | null;
}

function makePrisma(attempts: FakeAttempt[]) {
  return {
    callAttempt: {
      findMany: async () => attempts,
    },
    carrierBlockEvent: {
      findMany: async () => [],
    },
  } as unknown as PrismaClient;
}

function attempt(overrides: Partial<FakeAttempt> & { claimId: string; initiatedAt: Date }): FakeAttempt {
  return {
    claim: { carrierId: 'sun_life' },
    completedAt: overrides.initiatedAt,
    durationSeconds: 300,
    outcome: null,
    outcomeDetail: null,
    ...overrides,
  };
}

describe('computeCarrierStats — avgAttempts (AA-09)', () => {
  it('is not trivially 1.0 — it reflects real attempts-to-resolution per claim', async () => {
    // claim-1 took 3 attempts to resolve; claim-2 resolved on the first try.
    const attempts = [
      attempt({ claimId: 'claim-1', initiatedAt: new Date('2026-06-01T00:00:00Z'), outcome: 'NO_ANSWER' }),
      attempt({ claimId: 'claim-1', initiatedAt: new Date('2026-06-02T00:00:00Z'), outcome: 'PENDING' }),
      attempt({ claimId: 'claim-1', initiatedAt: new Date('2026-06-03T00:00:00Z'), outcome: 'RESOLVED' }),
      attempt({ claimId: 'claim-2', initiatedAt: new Date('2026-06-04T00:00:00Z'), outcome: 'RESOLVED' }),
    ];
    const { stats } = await computeCarrierStats(makePrisma(attempts), 'practice-1', 'all');

    const sunLife = stats.find((s) => s.carrierId === 'sun_life');
    expect(sunLife).toBeDefined();
    // (3 attempts-to-resolve for claim-1 + 1 for claim-2) / 2 resolved claims = 2
    expect(sunLife!.avgAttempts).toBe(2);
    expect(sunLife!.totalClaims).toBe(4); // total call attempts, unaffected by this fix
  });

  it('excludes claims that never resolved in the window from the average', async () => {
    const attempts = [
      attempt({ claimId: 'claim-1', initiatedAt: new Date('2026-06-01T00:00:00Z'), outcome: 'RESOLVED' }),
      attempt({ claimId: 'claim-2', initiatedAt: new Date('2026-06-02T00:00:00Z'), outcome: 'NO_ANSWER' }),
      attempt({ claimId: 'claim-2', initiatedAt: new Date('2026-06-03T00:00:00Z'), outcome: 'DENIED', outcomeDetail: 'missing docs' }),
    ];
    const { stats } = await computeCarrierStats(makePrisma(attempts), 'practice-1', 'all');

    const sunLife = stats.find((s) => s.carrierId === 'sun_life');
    // Only claim-1 resolved, in exactly 1 attempt -- claim-2's 2 unresolved
    // attempts must not drag this toward "average calls per attempt" (which
    // would incorrectly be 3/3 = 1 under the old bug).
    expect(sunLife!.avgAttempts).toBe(1);
  });

  it('only counts attempts up to and including the FIRST resolution, not later re-attempts on the same claim', async () => {
    const attempts = [
      attempt({ claimId: 'claim-1', initiatedAt: new Date('2026-06-01T00:00:00Z'), outcome: 'NO_ANSWER' }),
      attempt({ claimId: 'claim-1', initiatedAt: new Date('2026-06-02T00:00:00Z'), outcome: 'RESOLVED' }),
      // A later, out-of-order-in-array attempt row on the same claim (e.g. a
      // stray retry) must not inflate the resolution count past 2.
      attempt({ claimId: 'claim-1', initiatedAt: new Date('2026-06-03T00:00:00Z'), outcome: 'RESOLVED' }),
    ];
    const { stats } = await computeCarrierStats(makePrisma(attempts), 'practice-1', 'all');

    const sunLife = stats.find((s) => s.carrierId === 'sun_life');
    expect(sunLife!.avgAttempts).toBe(2);
  });

  it('returns 0 when no claims resolved in the window (not NaN)', async () => {
    const attempts = [
      attempt({ claimId: 'claim-1', initiatedAt: new Date('2026-06-01T00:00:00Z'), outcome: 'NO_ANSWER' }),
    ];
    const { stats } = await computeCarrierStats(makePrisma(attempts), 'practice-1', 'all');

    expect(stats.find((s) => s.carrierId === 'sun_life')!.avgAttempts).toBe(0);
  });
});
