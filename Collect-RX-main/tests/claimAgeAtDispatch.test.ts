import { describe, expect, it } from 'vitest';
import { claimAgeDays } from '../src/carriers/adapter';

const NOW = new Date('2026-11-23T12:00:00Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

describe('claimAgeDays', () => {
  it('counts from the submission date, not the import snapshot', () => {
    expect(claimAgeDays({ submittedAt: daysAgo(10), daysOutstanding: 85 }, NOW)).toBe(10);
  });

  it('ages a claim into the 90-day ceiling as time passes', () => {
    expect(claimAgeDays({ submittedAt: daysAgo(95), daysOutstanding: 10 }, NOW)).toBe(95);
  });

  it('falls back to the snapshot when there is no submission date', () => {
    expect(claimAgeDays({ submittedAt: null, daysOutstanding: 45 }, NOW)).toBe(45);
  });

  it('never returns a negative age for a submission date in the future', () => {
    expect(claimAgeDays({ submittedAt: new Date(NOW.getTime() + 3_600_000), daysOutstanding: 0 }, NOW)).toBe(0);
  });
});
