/**
 * Per-carrier medians of hybrid call flow segment timings.
 *
 * Reads only phase seconds and carrier ids, never transcripts or patient data.
 * The figures aggregate other practices' calls, so the route that exposes this
 * is platform-only and the query runs with RLS bypass.
 */
import type { CallEnding } from './callPhase.js';
import type { CarrierId, PrismaClient } from '@prisma/client';
import { runWithRlsBypass } from '../db/rlsContext.js';

export const SEGMENT_KEYS = ['menu', 'hold', 'rep', 'staffOrAgent', 'wrapUp'] as const;
export type SegmentKey = (typeof SEGMENT_KEYS)[number];

export interface SegmentMedian {
  /** Calls where this segment was observed. Unobserved calls are excluded, not counted as zero. */
  observed: number;
  medianSeconds: number | null;
}

export interface CarrierSegmentMedians {
  carrierId: CarrierId;
  ending: CallEnding;
  /** Closed calls with phase tracking in the window. */
  calls: number;
  segments: Record<SegmentKey, SegmentMedian>;
}

export interface SegmentMediansReport {
  windowDays: number;
  /** True when more calls matched than the row cap, so the figures cover the most recent only. */
  truncated: boolean;
  carriers: CarrierSegmentMedians[];
}

const ROW_CAP = 50_000;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return value === undefined ? null : Math.round(value * 10) / 10;
}

interface Row {
  carrierId: CarrierId;
  ending: CallEnding;
  menu: number | null;
  hold: number | null;
  rep: number | null;
  staffOrAgent: number | null;
  wrapUp: number | null;
}

export function summarizeSegments(rows: readonly Row[], windowDays: number, truncated: boolean): SegmentMediansReport {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row.carrierId}|${row.ending}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const carriers: CarrierSegmentMedians[] = [...groups.values()].map((group) => {
    const first = group[0] as Row;
    const segments = {} as Record<SegmentKey, SegmentMedian>;
    for (const key of SEGMENT_KEYS) {
      const observed = group.map((r) => r[key]).filter((v): v is number => v !== null);
      segments[key] = { observed: observed.length, medianSeconds: median(observed) };
    }
    return { carrierId: first.carrierId, ending: first.ending, calls: group.length, segments };
  });
  carriers.sort((a, b) => (a.carrierId + a.ending).localeCompare(b.carrierId + b.ending));
  return { windowDays, truncated, carriers };
}

export async function loadCarrierSegmentMedians(
  prisma: PrismaClient,
  windowDays: number,
  now: Date = new Date(),
): Promise<SegmentMediansReport> {
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const found = await runWithRlsBypass(() =>
    prisma.callAttempt.findMany({
      where: {
        initiatedAt: { gte: since },
        // wrap_up is always entered when a call is closed, so this marks closed calls.
        wrapUpSeconds: { not: null },
        callEnding: { in: ['staff', 'agent'] },
      },
      orderBy: { initiatedAt: 'desc' },
      take: ROW_CAP + 1,
      select: {
        callEnding: true,
        menuSeconds: true,
        holdSeconds: true,
        repSeconds: true,
        staffAgentSeconds: true,
        wrapUpSeconds: true,
        claim: { select: { carrierId: true } },
      },
    }),
  );
  const truncated = found.length > ROW_CAP;
  const rows: Row[] = found.slice(0, ROW_CAP).map((r) => ({
    carrierId: r.claim.carrierId,
    ending: r.callEnding === 'agent' ? 'agent' : 'staff',
    menu: r.menuSeconds,
    hold: r.holdSeconds,
    rep: r.repSeconds,
    staffOrAgent: r.staffAgentSeconds,
    wrapUp: r.wrapUpSeconds,
  }));
  return summarizeSegments(rows, windowDays, truncated);
}
