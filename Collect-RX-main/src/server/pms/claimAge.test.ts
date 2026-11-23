import { describe, expect, it } from 'vitest';
import { deriveDaysOutstanding } from './claimAge';

const NOW = new Date('2026-06-30T12:00:00.000Z');
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000);

describe('deriveDaysOutstanding', () => {
  it('uses the exported age when the file states one', () => {
    expect(
      deriveDaysOutstanding({ daysOutstanding: 45, submittedAt: daysAgo(5), servicedAt: daysAgo(200) }, NOW),
    ).toBe(45);
  });

  it('ages from the submission date, not the treatment date', () => {
    // Treated 120 days ago but submitted 40 days ago: the carrier has had it 40 days.
    expect(
      deriveDaysOutstanding({ daysOutstanding: 0, submittedAt: daysAgo(40), servicedAt: daysAgo(120) }, NOW),
    ).toBe(40);
  });

  it('falls back to the service date when there is no submission date', () => {
    expect(deriveDaysOutstanding({ daysOutstanding: 0, submittedAt: null, servicedAt: daysAgo(55) }, NOW)).toBe(55);
  });

  it('is 0 when no age and no dates are present', () => {
    expect(deriveDaysOutstanding({ daysOutstanding: 0, submittedAt: null, servicedAt: null }, NOW)).toBe(0);
  });

  it('never goes negative for a future-dated claim', () => {
    expect(
      deriveDaysOutstanding({ daysOutstanding: 0, submittedAt: new Date(NOW.getTime() + 5 * 86_400_000), servicedAt: null }, NOW),
    ).toBe(0);
  });

  it('floors partial days', () => {
    const start = new Date(NOW.getTime() - (10 * 86_400_000 + 3_600_000));
    expect(deriveDaysOutstanding({ daysOutstanding: 0, submittedAt: start, servicedAt: null }, NOW)).toBe(10);
  });
});
