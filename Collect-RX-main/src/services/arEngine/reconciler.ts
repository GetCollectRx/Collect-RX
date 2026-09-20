// ─────────────────────────────────────────────────────────────────────────────
// CollectRx AR Engine — Aging Report Reconciliation
//
// Proves ROI by comparing a practice's PMS/CSV aging report (what the office
// believes is outstanding) against what the automated calling engine actually
// resolved. Distinct from `src/services/eligibility/reconciliation.ts`, which
// compares a pre-treatment *estimate* to the carrier's actual adjudication —
// this module compares *aging balances* to *call outcomes* after the fact.
//
// Kept in the same pure-core / thin-Prisma-wrapper shape as
// `src/server/adjudication/adjudicationGraph.ts`: `reconcileAgingAgainstCalls`
// takes plain arrays and is unit-testable without a database;
// `getPracticeReconciliation` is the thin fetch that feeds it from Prisma.
// ─────────────────────────────────────────────────────────────────────────────

import type { CallOutcome, PrismaClient } from '@prisma/client';

export interface AgingReportRow {
  claimNumber: string;
  carrierId: string;
  /** Outstanding balance per the practice's PMS/CSV aging export. */
  outstandingCents: number;
  asOfDate: Date;
}

export interface ResolvedCallSignal {
  claimNumber: string;
  carrierId: string;
  outcome: CallOutcome | null;
  durationSeconds: number | null;
  /** From `stateMachine.computeHoldSecondsFromHistory`, when tracked. */
  holdSeconds: number | null;
  /** What the carrier confirmed as covered, in cents — null when unconfirmed. */
  resolvedAmountCents: number | null;
  occurredAt: Date;
}

export type DiscrepancyKind =
  | 'NO_CALL_ACTIVITY'
  | 'UNRESOLVED_IN_AGING_AFTER_CALL_RESOLVED'
  | 'AMOUNT_MISMATCH';

export interface ReconciliationDiscrepancy {
  claimNumber: string;
  carrierId: string;
  kind: DiscrepancyKind;
  detail: string;
}

export interface ReconciliationReport {
  totalAgingClaims: number;
  totalCallAttempts: number;
  /** Fraction (0–1) of call attempts whose outcome was RESOLVED. */
  callSuccessRate: number;
  /** Mean hold duration across attempts that recorded one; null if none did. */
  averageHoldSeconds: number | null;
  /** Sum of aging-report outstanding balances for claims the engine resolved. */
  totalDollarsResolvedCents: number;
  discrepancies: ReconciliationDiscrepancy[];
}

const RESOLVED_OUTCOMES: ReadonlySet<CallOutcome> = new Set(['RESOLVED']);

function claimKey(claimNumber: string, carrierId: string): string {
  return `${carrierId}::${claimNumber}`;
}

/** Latest signal per claim by `occurredAt` — a claim may have several call attempts. */
function latestSignalPerClaim(
  signals: readonly ResolvedCallSignal[],
): Map<string, ResolvedCallSignal> {
  const latest = new Map<string, ResolvedCallSignal>();
  for (const signal of signals) {
    const key = claimKey(signal.claimNumber, signal.carrierId);
    const current = latest.get(key);
    if (!current || signal.occurredAt > current.occurredAt) {
      latest.set(key, signal);
    }
  }
  return latest;
}

/**
 * Pure reconciliation core. `AMOUNT_MISMATCH` fires only when both sides
 * report a number — a missing figure is a coverage gap in the extraction
 * pipeline, not necessarily a real discrepancy, and is reported as
 * `NO_CALL_ACTIVITY` / left uncompared instead of guessed at.
 */
export function reconcileAgingAgainstCalls(
  agingRows: readonly AgingReportRow[],
  callSignals: readonly ResolvedCallSignal[],
): ReconciliationReport {
  const latestByClaim = latestSignalPerClaim(callSignals);
  const discrepancies: ReconciliationDiscrepancy[] = [];
  let totalDollarsResolvedCents = 0;

  for (const row of agingRows) {
    const key = claimKey(row.claimNumber, row.carrierId);
    const signal = latestByClaim.get(key);

    if (!signal) {
      discrepancies.push({
        claimNumber: row.claimNumber,
        carrierId: row.carrierId,
        kind: 'NO_CALL_ACTIVITY',
        detail: `Aging report shows $${(row.outstandingCents / 100).toFixed(2)} outstanding with no recorded call attempt.`,
      });
      continue;
    }

    if (!signal.outcome || !RESOLVED_OUTCOMES.has(signal.outcome)) {
      continue; // Not yet resolved per the call record — nothing to reconcile.
    }

    if (row.outstandingCents > 0) {
      discrepancies.push({
        claimNumber: row.claimNumber,
        carrierId: row.carrierId,
        kind: 'UNRESOLVED_IN_AGING_AFTER_CALL_RESOLVED',
        detail:
          `Call marked RESOLVED but aging report still shows $${(row.outstandingCents / 100).toFixed(2)} outstanding — ` +
          'PMS sync may be lagging or the payment has not posted yet.',
      });
      if (signal.resolvedAmountCents !== null && signal.resolvedAmountCents !== row.outstandingCents) {
        discrepancies.push({
          claimNumber: row.claimNumber,
          carrierId: row.carrierId,
          kind: 'AMOUNT_MISMATCH',
          detail:
            `Carrier confirmed $${(signal.resolvedAmountCents / 100).toFixed(2)} covered but aging report shows ` +
            `$${(row.outstandingCents / 100).toFixed(2)} outstanding.`,
        });
      }
      continue;
    }

    // Aging confirms the balance actually cleared — count the dollars this call recovered.
    totalDollarsResolvedCents += signal.resolvedAmountCents ?? 0;
  }

  const totalCallAttempts = callSignals.length;
  const resolvedAttempts = callSignals.filter(
    (s) => s.outcome && RESOLVED_OUTCOMES.has(s.outcome),
  ).length;
  const callSuccessRate = totalCallAttempts > 0 ? resolvedAttempts / totalCallAttempts : 0;

  const holdSamples = callSignals
    .map((s) => s.holdSeconds)
    .filter((s): s is number => s !== null);
  const averageHoldSeconds =
    holdSamples.length > 0
      ? Math.round(holdSamples.reduce((sum, s) => sum + s, 0) / holdSamples.length)
      : null;

  return {
    totalAgingClaims: agingRows.length,
    totalCallAttempts,
    callSuccessRate: Math.round(callSuccessRate * 1000) / 1000,
    averageHoldSeconds,
    totalDollarsResolvedCents,
    discrepancies,
  };
}

// ---------------------------------------------------------------------------
// Prisma-backed fetch (thin — all computation stays in the pure core above)
// ---------------------------------------------------------------------------

/**
 * Build call signals from this practice's `CallAttempt` + `InsuranceClaim`
 * rows since `since`, then reconcile against a caller-supplied aging report.
 * The aging report itself is external input (a CSV/PMS export) — this
 * module does not assume a canonical "aging report" DB table exists.
 */
export async function getPracticeReconciliation(
  prisma: PrismaClient,
  practiceId: string,
  agingRows: readonly AgingReportRow[],
  since: Date,
): Promise<ReconciliationReport> {
  const attempts = await prisma.callAttempt.findMany({
    where: { initiatedAt: { gte: since }, claim: { practiceId } },
    select: {
      outcome: true,
      durationSeconds: true,
      initiatedAt: true,
      claim: {
        select: { claimNumber: true, carrierId: true, billedAmount: true, expectedAmount: true },
      },
    },
  });

  // `billedAmount`/`expectedAmount` (not `outstandingAmount`) are the resolved-dollar
  // proxy on purpose: `outstandingAmount` is zeroed by the same PMS sync that clears
  // the aging balance, so by the time this query runs it can no longer tell us what
  // was actually recovered — only what still needs recovering, which is 0 by then.
  const callSignals: ResolvedCallSignal[] = attempts.map((attempt) => ({
    claimNumber: attempt.claim.claimNumber,
    carrierId: attempt.claim.carrierId,
    outcome: attempt.outcome,
    durationSeconds: attempt.durationSeconds,
    holdSeconds: null,
    resolvedAmountCents:
      attempt.outcome === 'RESOLVED'
        ? Math.round(Number(attempt.claim.expectedAmount ?? attempt.claim.billedAmount) * 100)
        : null,
    occurredAt: attempt.initiatedAt,
  }));

  return reconcileAgingAgainstCalls(agingRows, callSignals);
}

export const reconciler = {
  reconcileAgingAgainstCalls,
  getPracticeReconciliation,
} as const;

export default reconciler;
