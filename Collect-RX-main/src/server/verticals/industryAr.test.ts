import { describe, expect, it } from 'vitest';
import {
  agingBucket,
  buildIndustryWorklist,
  decimalStringToCents,
  liveAgeDays,
  NOT_DIALABLE_REASON,
  summarizeIndustryAr,
  WORKLIST_MAX_LIMIT,
  type OpenIndustryClaim,
} from './industryAr';

const NOW = new Date('2026-11-06T12:00:00Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

function claim(overrides: Partial<OpenIndustryClaim> & Pick<OpenIndustryClaim, 'id'>): OpenIndustryClaim {
  return {
    claimNumber: overrides.id.toUpperCase(),
    industryType: 'AUTO_COLLISION',
    payerName: 'Synthetic Mutual Insurance Inc.',
    outstandingAmount: '100.00',
    servicedAt: daysAgo(10),
    daysOutstanding: 0,
    status: 'IN_QUEUE',
    ...overrides,
  };
}

describe('decimalStringToCents', () => {
  it.each([
    ['1234.50', 123450],
    ['1234.5', 123450],
    ['1234', 123400],
    ['0.07', 7],
    ['-3', -300],
    ['  12.34 ', 1234],
    ['12.349', 1234],
    ['abc', 0],
    ['', 0],
  ])('%j is %i cents', (input, cents) => {
    expect(decimalStringToCents(input)).toBe(cents);
  });
});

describe('liveAgeDays and agingBucket', () => {
  it('ages from the date of service at read time, not the frozen import value', () => {
    expect(liveAgeDays({ servicedAt: daysAgo(75), daysOutstanding: 3 }, NOW)).toBe(75);
  });

  it('falls back to the stored age when there is no date of service, never negative', () => {
    expect(liveAgeDays({ servicedAt: null, daysOutstanding: 41 }, NOW)).toBe(41);
    expect(liveAgeDays({ servicedAt: null, daysOutstanding: -5 }, NOW)).toBe(0);
    expect(liveAgeDays({ servicedAt: new Date(NOW.getTime() + 86_400_000 * 3), daysOutstanding: 0 }, NOW)).toBe(0);
  });

  it.each([
    [0, '0-29'], [29, '0-29'], [30, '30-59'], [59, '30-59'], [60, '60-89'],
    [89, '60-89'], [90, '90-119'], [119, '90-119'], [120, '120+'], [400, '120+'],
  ])('age %i falls in %s', (age, bucket) => {
    expect(agingBucket(age)).toBe(bucket);
  });
});

describe('summarizeIndustryAr', () => {
  const claims: OpenIndustryClaim[] = [
    claim({ id: 'a1', payerName: 'Synthetic Mutual Insurance Inc.', outstandingAmount: '1200.00', servicedAt: daysAgo(10) }),
    claim({ id: 'a2', payerName: 'SYNTHETIC MUTUAL INS.', outstandingAmount: '300.50', servicedAt: daysAgo(95) }),
    claim({ id: 'p1', industryType: 'PROPERTY_RESTORATION', payerName: 'synthetic mutual', outstandingAmount: '5000.00', servicedAt: daysAgo(130), status: 'ESCALATED' }),
    claim({ id: 'x1', industryType: 'PARAMEDICAL_PHYSIO', payerName: 'Placeholder General Insurance', outstandingAmount: '80.00', servicedAt: daysAgo(45) }),
    claim({ id: 'u1', industryType: 'PARAMEDICAL_PHYSIO', payerName: null, outstandingAmount: '20.00', servicedAt: null, daysOutstanding: 61 }),
  ];
  const summary = summarizeIndustryAr(claims, NOW);

  it('totals claims and balance in cents', () => {
    expect(summary.totals).toEqual({ claims: 5, balanceCents: 120000 + 30050 + 500000 + 8000 + 2000 });
  });

  it('buckets by live age', () => {
    expect(summary.buckets['0-29']).toEqual({ claims: 1, balanceCents: 120000 });
    expect(summary.buckets['30-59']).toEqual({ claims: 1, balanceCents: 8000 });
    expect(summary.buckets['60-89']).toEqual({ claims: 1, balanceCents: 2000 });
    expect(summary.buckets['90-119']).toEqual({ claims: 1, balanceCents: 30050 });
    expect(summary.buckets['120+']).toEqual({ claims: 1, balanceCents: 500000 });
  });

  it('merges spelling variants of one payer across industries into one row', () => {
    const synthetic = summary.byPayer.find((p) => p.payerKey === 'synthetic mutual');
    expect(synthetic).toMatchObject({
      claims: 3,
      balanceCents: 650050,
      oldestAgeDays: 130,
      industries: ['AUTO_COLLISION', 'PROPERTY_RESTORATION'],
    });
    expect(summary.byPayer[0]?.payerKey).toBe('synthetic mutual');
  });

  it('keeps claims with no payer in an unknown group instead of dropping them', () => {
    expect(summary.byPayer.find((p) => p.payerKey === 'unknown')).toMatchObject({ claims: 1, payerName: 'Unknown payer' });
  });

  it('breaks down by industry, largest balance first, and counts statuses', () => {
    expect(summary.byIndustry.map((i) => i.industryType)).toEqual(['PROPERTY_RESTORATION', 'AUTO_COLLISION', 'PARAMEDICAL_PHYSIO']);
    expect(summary.statusCounts).toEqual({ IN_QUEUE: 4, ESCALATED: 1 });
  });

  it('says plainly that nothing here can be dialled yet', () => {
    expect(summary.dialable).toBe(false);
    expect(summary.notDialableReason).toBe(NOT_DIALABLE_REASON);
    expect(summary.asOf).toBe(NOW.toISOString());
  });

  it('returns empty, zeroed structures for no claims', () => {
    const empty = summarizeIndustryAr([], NOW);
    expect(empty.totals).toEqual({ claims: 0, balanceCents: 0 });
    expect(empty.byPayer).toEqual([]);
    expect(empty.byIndustry).toEqual([]);
  });
});

describe('buildIndustryWorklist', () => {
  const claims: OpenIndustryClaim[] = [
    claim({ id: 'young-small', outstandingAmount: '50.00', servicedAt: daysAgo(5) }),
    claim({ id: 'old-large', outstandingAmount: '9000.00', servicedAt: daysAgo(150), payerName: 'SYNTHETIC MUTUAL INS.' }),
    claim({ id: 'mid', industryType: 'DME', outstandingAmount: '700.00', servicedAt: daysAgo(70), payerName: 'Placeholder General Insurance' }),
  ];

  it('puts the oldest, largest balance first', () => {
    const items = buildIndustryWorklist(claims, NOW);
    expect(items.map((i) => i.claimId)).toEqual(['old-large', 'mid', 'young-small']);
    expect(items[0]?.priorityScore).toBeGreaterThan(items[1]?.priorityScore ?? Infinity);
  });

  it('reports a payer key and the group display name on each item', () => {
    const items = buildIndustryWorklist(claims, NOW);
    const oldLarge = items.find((i) => i.claimId === 'old-large');
    expect(oldLarge).toMatchObject({ payerKey: 'synthetic mutual', ageDays: 150, agingBucket: '120+', balanceCents: 900000 });
    expect(oldLarge?.payerName).toBe('Synthetic Mutual Insurance Inc.');
    expect(items.every((i) => i.dialable === false && i.notDialableReason === NOT_DIALABLE_REASON)).toBe(true);
  });

  it('filters by industry and by payer key', () => {
    expect(buildIndustryWorklist(claims, NOW, { industryType: 'DME' }).map((i) => i.claimId)).toEqual(['mid']);
    expect(buildIndustryWorklist(claims, NOW, { payerKey: 'synthetic mutual' }).map((i) => i.claimId)).toEqual(['old-large', 'young-small']);
    expect(buildIndustryWorklist(claims, NOW, { payerKey: 'no such payer' })).toEqual([]);
  });

  it('clamps the limit between 1 and the maximum', () => {
    expect(buildIndustryWorklist(claims, NOW, { limit: 1 })).toHaveLength(1);
    expect(buildIndustryWorklist(claims, NOW, { limit: 0 })).toHaveLength(1);
    expect(buildIndustryWorklist(claims, NOW, { limit: -10 })).toHaveLength(1);
    const many = Array.from({ length: WORKLIST_MAX_LIMIT + 5 }, (_, i) => claim({ id: `c${i}` }));
    expect(buildIndustryWorklist(many, NOW, { limit: 10_000 })).toHaveLength(WORKLIST_MAX_LIMIT);
  });

  it('orders ties deterministically by claim number', () => {
    const tied = [claim({ id: 'b' }), claim({ id: 'a' })];
    expect(buildIndustryWorklist(tied, NOW).map((i) => i.claimNumber)).toEqual(['A', 'B']);
  });
});
