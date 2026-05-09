// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Insurance Analytics Service
//
// Provides the four aggregate metrics surfaced in the Phase 5 dashboard:
//
//   getTimeSaved(practiceId, dateRange)
//     → Hours saved: completed calls × AVG_MANUAL_CALL_MINUTES (18 min)
//
//   getDollarsRecovered(practiceId, dateRange)
//     → Sum of outstandingAmount for claims resolved in the window
//
//   getResolutionRateByCarrier(practiceId)
//     → Success % per carrier (resolved / total completed calls)
//
//   getCallVolumeOverTime(practiceId, dateRange, bucket)
//     → Call counts bucketed by day or week
// ─────────────────────────────────────────────────────────────────────────────

import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Average time a dental admin spends on a manual carrier call (minutes) */
const AVG_MANUAL_CALL_MINUTES = 18;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DateRange {
  from: Date;
  to: Date;
}

export interface TimeSavedResult {
  completedCalls: number;
  timeSavedMinutes: number;
  timeSavedHours: number;
  avgManualCallMinutes: number;
}

export interface DollarsRecoveredResult {
  resolvedClaimsCount: number;
  dollarsRecovered: number;
  currency: 'CAD';
}

export interface CarrierResolutionRate {
  carrierId: string;
  displayName: string;
  totalCalls: number;
  resolvedCalls: number;
  resolutionRate: number;   // 0–100
  deniedCalls: number;
  escalatedCalls: number;
}

export interface CallVolumePoint {
  date: string;             // ISO date string (day) or ISO week start
  calls: number;
  resolved: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// getTimeSaved
// ---------------------------------------------------------------------------

/**
 * Calculate hours of admin time saved by AI calls in the given window.
 *
 * Formula: completedCalls × AVG_MANUAL_CALL_MINUTES
 * where "completed" = outcome is not null (call reached the carrier).
 */
export async function getTimeSaved(
  prisma: PrismaClient,
  practiceId: string,
  dateRange: DateRange,
): Promise<TimeSavedResult> {
  const completedCalls = await prisma.callAttempt.count({
    where: {
      initiatedAt: { gte: dateRange.from, lte: dateRange.to },
      outcome: { not: null },
      claim: { practiceId },
    },
  });

  const timeSavedMinutes = completedCalls * AVG_MANUAL_CALL_MINUTES;

  return {
    completedCalls,
    timeSavedMinutes,
    timeSavedHours: Math.round((timeSavedMinutes / 60) * 10) / 10,
    avgManualCallMinutes: AVG_MANUAL_CALL_MINUTES,
  };
}

// ---------------------------------------------------------------------------
// getDollarsRecovered
// ---------------------------------------------------------------------------

/**
 * Sum of outstanding amounts for claims resolved in the given window.
 *
 * "Resolved" = claim status is RESOLVED and the resolution happened
 * (updatedAt) within the date range.
 */
export async function getDollarsRecovered(
  prisma: PrismaClient,
  practiceId: string,
  dateRange: DateRange,
): Promise<DollarsRecoveredResult> {
  const resolved = await prisma.insuranceClaim.findMany({
    where: {
      practiceId,
      status: 'RESOLVED',
      updatedAt: { gte: dateRange.from, lte: dateRange.to },
    },
    select: { outstandingAmount: true },
  });

  const dollarsRecovered = resolved.reduce(
    (sum, c) => sum + Number(c.outstandingAmount),
    0,
  );

  return {
    resolvedClaimsCount: resolved.length,
    dollarsRecovered: Math.round(dollarsRecovered * 100) / 100,
    currency: 'CAD',
  };
}

// ---------------------------------------------------------------------------
// getResolutionRateByCarrier
// ---------------------------------------------------------------------------

/**
 * Resolution rate per carrier — all time (not windowed) so the carrier
 * health cards always show lifetime performance.
 */
export async function getResolutionRateByCarrier(
  prisma: PrismaClient,
  practiceId: string,
): Promise<CarrierResolutionRate[]> {
  // Dynamically import to avoid circular dep
  const { CARRIER_CONFIGS } = await import('../carriers/adapter');

  // We need carrier-level breakdown — groupBy on a relation field requires
  // a raw query or a findMany + in-memory aggregation.
  const attempts = await prisma.callAttempt.findMany({
    where: {
      outcome: { not: null },
      claim: { practiceId },
    },
    select: {
      outcome: true,
      claim: { select: { carrierId: true } },
    },
  });

  const stats: Record<string, {
    totalCalls: number;
    resolvedCalls: number;
    deniedCalls: number;
    escalatedCalls: number;
  }> = {};

  for (const a of attempts) {
    const cid = a.claim.carrierId;
    if (!stats[cid]) stats[cid] = { totalCalls: 0, resolvedCalls: 0, deniedCalls: 0, escalatedCalls: 0 };
    stats[cid].totalCalls++;
    if (a.outcome === 'RESOLVED')  stats[cid].resolvedCalls++;
    if (a.outcome === 'DENIED')    stats[cid].deniedCalls++;
    if (a.outcome === 'ESCALATED') stats[cid].escalatedCalls++;
  }

  return Object.entries(CARRIER_CONFIGS).map(([cid, cfg]) => {
    const s = stats[cid] ?? { totalCalls: 0, resolvedCalls: 0, deniedCalls: 0, escalatedCalls: 0 };
    return {
      carrierId: cid,
      displayName: cfg.displayName,
      totalCalls: s.totalCalls,
      resolvedCalls: s.resolvedCalls,
      resolutionRate: s.totalCalls > 0
        ? Math.round((s.resolvedCalls / s.totalCalls) * 100)
        : 0,
      deniedCalls: s.deniedCalls,
      escalatedCalls: s.escalatedCalls,
    };
  });
}

// ---------------------------------------------------------------------------
// getCallVolumeOverTime
// ---------------------------------------------------------------------------

/**
 * Call volume bucketed by day or week.
 * Returns an array of { date, calls, resolved, failed } data points
 * suitable for a time-series chart.
 */
export async function getCallVolumeOverTime(
  prisma: PrismaClient,
  practiceId: string,
  dateRange: DateRange,
  bucket: 'day' | 'week' = 'day',
): Promise<CallVolumePoint[]> {
  const attempts = await prisma.callAttempt.findMany({
    where: {
      initiatedAt: { gte: dateRange.from, lte: dateRange.to },
      claim: { practiceId },
    },
    select: { initiatedAt: true, outcome: true },
    orderBy: { initiatedAt: 'asc' },
  });

  // Bucket attempts into day/week keys
  const buckets = new Map<string, CallVolumePoint>();

  for (const a of attempts) {
    const key = bucket === 'week'
      ? getWeekStart(a.initiatedAt).toISOString().slice(0, 10)
      : a.initiatedAt.toISOString().slice(0, 10);

    if (!buckets.has(key)) {
      buckets.set(key, { date: key, calls: 0, resolved: 0, failed: 0 });
    }

    const point = buckets.get(key)!;
    point.calls++;
    if (a.outcome === 'RESOLVED') point.resolved++;
    if (a.outcome === 'FAILED' || a.outcome === 'NO_ANSWER') point.failed++;
  }

  // Fill gaps with zeros for a continuous chart
  return fillDateGaps(buckets, dateRange, bucket);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fillDateGaps(
  buckets: Map<string, CallVolumePoint>,
  dateRange: DateRange,
  bucket: 'day' | 'week',
): CallVolumePoint[] {
  const result: CallVolumePoint[] = [];
  // Use UTC calendar days so keys match `initiatedAt.toISOString().slice(0, 10)` in all timezones.
  const cursor = new Date(
    Date.UTC(
      dateRange.from.getUTCFullYear(),
      dateRange.from.getUTCMonth(),
      dateRange.from.getUTCDate(),
    ),
  );
  const endUtc = Date.UTC(
    dateRange.to.getUTCFullYear(),
    dateRange.to.getUTCMonth(),
    dateRange.to.getUTCDate(),
    23,
    59,
    59,
    999,
  );

  while (cursor.getTime() <= endUtc) {
    const key = cursor.toISOString().slice(0, 10);
    result.push(buckets.get(key) ?? { date: key, calls: 0, resolved: 0, failed: 0 });

    if (bucket === 'week') {
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return result;
}
