import { describe, expect, it } from 'vitest';
import type { CarrierId } from '@prisma/client';
import {
  PriorityEngine,
  addCalendarMonths,
  buildPriorityQueue,
  computeDeadlineDaysRemaining,
  computeStatusModifier,
  scoreClaim,
  scoreToClaimPriority,
} from '../../src/server/services/priorityEngine';

describe('priorityEngine', () => {
  it('65-day-old $200 claim outscores 5-day-old $800 claim', () => {
    const ref = new Date('2026-05-10T12:00:00.000Z');
    const svc = (days: number) => PriorityEngine.estimateServiceDateFromOutstanding(ref, days);

    const older = scoreClaim({
      carrierId: 'sun_life',
      amountCents: 20_000,
      daysOutstanding: 65,
      attemptCount: 0,
      referenceDate: ref,
      serviceDate: svc(65),
      claimStatus: 'PENDING',
    });
    const newer = scoreClaim({
      carrierId: 'sun_life',
      amountCents: 80_000,
      daysOutstanding: 5,
      attemptCount: 0,
      referenceDate: ref,
      serviceDate: svc(5),
      claimStatus: 'PENDING',
    });

    expect(older.total).toBeGreaterThan(newer.total);
  });

  it('claim within 30 days of carrier deadline ranks above a much older/heavier claim', () => {
    const ref = new Date('2026-05-10T12:00:00.000Z');
    const carrierId: CarrierId = 'sun_life';
    const deadline = new Date(ref);
    deadline.setUTCDate(deadline.getUTCDate() + 20);
    const serviceNearDeadline = addCalendarMonths(deadline, -12);

    expect(computeDeadlineDaysRemaining(serviceNearDeadline, carrierId, ref)).toBe(20);

    const urgent = scoreClaim({
      carrierId,
      amountCents: 5_000,
      daysOutstanding: 10,
      attemptCount: 1,
      referenceDate: ref,
      serviceDate: serviceNearDeadline,
      claimStatus: 'PENDING',
    });

    const heavyOld = scoreClaim({
      carrierId,
      amountCents: 500_000,
      daysOutstanding: 80,
      attemptCount: 1,
      referenceDate: ref,
      serviceDate: PriorityEngine.estimateServiceDateFromOutstanding(ref, 80),
      claimStatus: 'PENDING',
    });

    expect(urgent.deadlineMultiplier).toBe(5);
    expect(heavyOld.deadlineMultiplier).toBe(1);
    expect(urgent.total).toBeGreaterThan(heavyOld.total);
  });

  it('3+ attempt denied claim scores lower than a fresh $100 pending claim', () => {
    const ref = new Date('2026-05-10T12:00:00.000Z');
    const svc = PriorityEngine.estimateServiceDateFromOutstanding(ref, 20);

    const deniedStale = scoreClaim({
      carrierId: 'manulife',
      amountCents: 10_000,
      daysOutstanding: 20,
      attemptCount: 3,
      referenceDate: ref,
      serviceDate: svc,
      claimStatus: 'DENIED',
    });

    const fresh = scoreClaim({
      carrierId: 'manulife',
      amountCents: 10_000,
      daysOutstanding: 0,
      attemptCount: 0,
      referenceDate: ref,
      serviceDate: PriorityEngine.estimateServiceDateFromOutstanding(ref, 0),
      claimStatus: 'PENDING',
    });

    expect(fresh.total).toBeGreaterThan(deniedStale.total);
  });

  it('approved-but-unpaid claim stays in the top 5 when mixed with nine similar peers', () => {
    const ref = new Date('2026-05-10T12:00:00.000Z');

    const peers = Array.from({ length: 9 }, (_, i) =>
      scoreClaim({
        carrierId: 'canada_life',
        amountCents: 20_000,
        daysOutstanding: 30 + i,
        attemptCount: 1,
        referenceDate: ref,
        serviceDate: PriorityEngine.estimateServiceDateFromOutstanding(ref, 30 + i),
        claimStatus: 'PENDING',
        approvedButUnpaid: false,
      }),
    );

    const approved = scoreClaim({
      carrierId: 'canada_life',
      amountCents: 25_000,
      daysOutstanding: 25,
      attemptCount: 1,
      referenceDate: ref,
      serviceDate: PriorityEngine.estimateServiceDateFromOutstanding(ref, 25),
      claimStatus: 'PENDING',
      approvedButUnpaid: true,
    });

    const all = [...peers.map((p) => p.total), approved.total].sort((a, b) => b - a);
    const rank = all.indexOf(approved.total) + 1;
    expect(rank).toBeGreaterThanOrEqual(1);
    expect(rank).toBeLessThanOrEqual(5);
  });
});

describe('APPROVED_PENDING_PAYMENT + servicedAt', () => {
  it('uses enum status for +100 without legacy text flag', () => {
    expect(computeStatusModifier('APPROVED_PENDING_PAYMENT', false)).toBe(100);
    expect(computeStatusModifier('APPROVED_PENDING_PAYMENT', true)).toBe(100);
  });

  it('uses servicedAt for deadline math when provided', () => {
    const ref = new Date('2026-06-01T12:00:00.000Z');
    const servicedAt = new Date('2025-06-01T12:00:00.000Z');
    const fromService = computeDeadlineDaysRemaining(servicedAt, 'sun_life', ref);
    const fromEstimate = computeDeadlineDaysRemaining(
      PriorityEngine.estimateServiceDateFromOutstanding(ref, 5),
      'sun_life',
      ref,
    );
    expect(fromService).not.toBe(fromEstimate);
    expect(fromService).toBeLessThan(fromEstimate);
  });
});

describe('scoreToClaimPriority', () => {
  it('maps ratio of total to max into ClaimPriority bands', () => {
    expect(scoreToClaimPriority(95, 100)).toBe('URGENT');
    expect(scoreToClaimPriority(70, 100)).toBe('HIGH');
    expect(scoreToClaimPriority(40, 100)).toBe('NORMAL');
    expect(scoreToClaimPriority(10, 100)).toBe('LOW');
  });
});

describe('buildPriorityQueue (integration)', () => {
  it('returns a sorted array for a practice with no claims', async () => {
    const ranked = await buildPriorityQueue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { insuranceClaim: { findMany: async () => [] } } as any,
      'practice-no-claims',
      new Date('2026-05-10T12:00:00.000Z'),
    );
    expect(ranked).toEqual([]);
  });
});
