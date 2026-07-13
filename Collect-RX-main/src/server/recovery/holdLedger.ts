/**
 * Hold-dump ledger — tracks calls where a carrier parked the agent on hold and
 * then ended the call without any engagement. The per-carrier dump rate feeds
 * the claim router's retry ladder: carriers that routinely dump holds get their
 * claims steered to human escalation after fewer wasted attempts.
 */
import type { CallOutcome, PrismaClient } from '@prisma/client';

/** A call shorter than this never counts as a dumped hold — it simply failed. */
export const HELD_THEN_DUMPED_MIN_SECONDS = 600;

/** Dump rate at or above which the retry ladder escalates one attempt earlier. */
export const HOLD_DUMP_ESCALATE_RATE = 0.3;

/** Rolling window for the per-carrier dump-rate aggregation. */
const HOLD_LEDGER_WINDOW_DAYS = 30;

/** Dump rates from fewer completed calls than this are noise — ignored. */
const HOLD_LEDGER_MIN_SAMPLE = 5;

const NO_ENGAGEMENT_OUTCOMES: ReadonlySet<CallOutcome> = new Set<CallOutcome>([
  'NO_ANSWER',
  'HUNG_UP',
  'FAILED',
]);

/**
 * A dumped hold is a long call that ended with a no-engagement outcome and no
 * evidence a human ever picked up: the agent waited, then got disconnected.
 */
export function isHeldThenDumped(input: {
  outcome: CallOutcome | null;
  durationSeconds: number | null;
  repName: string | null;
  referenceNumber: string | null;
}): boolean {
  if (!input.outcome || !NO_ENGAGEMENT_OUTCOMES.has(input.outcome)) return false;
  if ((input.durationSeconds ?? 0) < HELD_THEN_DUMPED_MIN_SECONDS) return false;
  return !input.repName && !input.referenceNumber;
}

export type CarrierHoldStats = {
  completedCalls: number;
  dumpedHolds: number;
  /** dumpedHolds / completedCalls, or null below the minimum sample size. */
  dumpRate: number | null;
};

export type CarrierHoldLedgerEntry = CarrierHoldStats & {
  carrierId: string;
};

function toHoldStats(completedCalls: number, dumpedHolds: number): CarrierHoldStats {
  return {
    completedCalls,
    dumpedHolds,
    dumpRate: completedCalls >= HOLD_LEDGER_MIN_SAMPLE ? dumpedHolds / completedCalls : null,
  };
}

export async function getCarrierHoldStats(
  prisma: PrismaClient,
  practiceId: string,
  carrierId: string,
  now = new Date(),
): Promise<CarrierHoldStats> {
  const since = new Date(now.getTime() - HOLD_LEDGER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const where = {
    completedAt: { gte: since },
    claim: { practiceId, carrierId: carrierId as import('@prisma/client').CarrierId },
  };
  const [completedCalls, dumpedHolds] = await Promise.all([
    prisma.callAttempt.count({ where }),
    prisma.callAttempt.count({ where: { ...where, heldThenDumped: true } }),
  ]);
  return toHoldStats(completedCalls, dumpedHolds);
}

/**
 * Practice-scoped 30-day hold ledger for the front desk. It intentionally
 * reports aggregate carrier reliability only—never transcript or patient data.
 */
export async function getPracticeHoldLedger(
  prisma: PrismaClient,
  practiceId: string,
  now = new Date(),
): Promise<CarrierHoldLedgerEntry[]> {
  const since = new Date(now.getTime() - HOLD_LEDGER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const attempts = await prisma.callAttempt.findMany({
    where: { completedAt: { gte: since }, claim: { practiceId } },
    select: { heldThenDumped: true, claim: { select: { carrierId: true } } },
  });

  const counts = new Map<string, { completedCalls: number; dumpedHolds: number }>();
  for (const attempt of attempts) {
    const carrierId = attempt.claim.carrierId;
    const current = counts.get(carrierId) ?? { completedCalls: 0, dumpedHolds: 0 };
    current.completedCalls += 1;
    if (attempt.heldThenDumped) current.dumpedHolds += 1;
    counts.set(carrierId, current);
  }

  return [...counts.entries()]
    .map(([carrierId, stats]) => ({ carrierId, ...toHoldStats(stats.completedCalls, stats.dumpedHolds) }))
    .sort((a, b) => (b.dumpRate ?? -1) - (a.dumpRate ?? -1));
}
