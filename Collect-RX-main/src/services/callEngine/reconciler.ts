// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Aging Report Reconciliation & Telemetry
//
// Proves the product's ROI claim: given a practice's original AR aging report
// (outstanding claims before the engine touched them) and the call attempts
// the engine made against those claims, compute how much of the aging bucket
// actually got resolved, how efficiently, and where the two data sources
// disagree.
//
// This is distinct from `../eligibility/reconciliation.ts`, which compares a
// pre-treatment *estimate* against the actual EOB for variance >$50 on a
// single claim. This module operates over a whole aging report and reports
// fleet-level metrics (success rate, hold time, dollars resolved) — a
// different question at a different grain, not a duplicate.
// ─────────────────────────────────────────────────────────────────────────────

import type { CallOutcome } from '@prisma/client';

export interface AgingReportRow {
  claimId: string;
  carrierId: string;
  /** Outstanding balance as of the aging report snapshot, in cents. */
  outstandingAmountCents: number;
  daysOutstanding: number;
}

export interface CallAttemptMetric {
  claimId: string;
  outcome: CallOutcome | null;
  initiatedAt: Date;
  completedAt: Date | null;
  /**
   * Seconds spent in QUEUE_HOLD before a rep connected, when known — populate
   * from `stateMachine.ts` state-entry timestamps (time between entering
   * QUEUE_HOLD and the AGENT_CONNECTED transition). Optional because older
   * attempts predate that instrumentation.
   */
  holdDurationSeconds?: number;
  carrierBlockDetected: boolean;
}

const RESOLVED_OUTCOMES: ReadonlySet<CallOutcome> = new Set(['RESOLVED']);

export interface ReconciliationMetrics {
  totalClaims: number;
  totalCallAttempts: number;
  resolvedCallAttempts: number;
  /** resolvedCallAttempts / totalCallAttempts, 0 when there were no attempts. */
  callSuccessRate: number;
  /** Average of `holdDurationSeconds` across attempts that reported one. */
  averageHoldTimeSeconds: number;
  totalOutstandingCents: number;
  /** Sum of outstandingAmountCents for claims whose most recent attempt outcome is RESOLVED. */
  totalDollarsResolvedCents: number;
  carrierBlockEvents: number;
}

export interface Discrepancy {
  claimId: string;
  kind: 'MISSING_FROM_AGING_REPORT' | 'NO_CALL_ATTEMPT_ON_RECORD' | 'RESOLVED_BUT_STILL_AGED';
  detail: string;
}

export interface ReconciliationReport {
  generatedAt: Date;
  metrics: ReconciliationMetrics;
  discrepancies: Discrepancy[];
}

/** Most recent attempt per claim, by initiatedAt. */
function latestAttemptByClaimId(attempts: CallAttemptMetric[]): Map<string, CallAttemptMetric> {
  const latest = new Map<string, CallAttemptMetric>();
  for (const attempt of attempts) {
    const current = latest.get(attempt.claimId);
    if (!current || attempt.initiatedAt > current.initiatedAt) {
      latest.set(attempt.claimId, attempt);
    }
  }
  return latest;
}

function computeMetrics(
  agingReport: AgingReportRow[],
  attempts: CallAttemptMetric[],
): ReconciliationMetrics {
  const resolvedCallAttempts = attempts.filter(
    (a) => a.outcome !== null && RESOLVED_OUTCOMES.has(a.outcome),
  ).length;

  const holdSamples = attempts
    .map((a) => a.holdDurationSeconds)
    .filter((seconds): seconds is number => typeof seconds === 'number');

  const latestByClaimId = latestAttemptByClaimId(attempts);
  const totalOutstandingCents = agingReport.reduce((sum, row) => sum + row.outstandingAmountCents, 0);
  const totalDollarsResolvedCents = agingReport.reduce((sum, row) => {
    const latest = latestByClaimId.get(row.claimId);
    const isResolved = latest?.outcome !== null && latest?.outcome !== undefined && RESOLVED_OUTCOMES.has(latest.outcome);
    return isResolved ? sum + row.outstandingAmountCents : sum;
  }, 0);

  return {
    totalClaims: agingReport.length,
    totalCallAttempts: attempts.length,
    resolvedCallAttempts,
    callSuccessRate: attempts.length === 0 ? 0 : resolvedCallAttempts / attempts.length,
    averageHoldTimeSeconds:
      holdSamples.length === 0 ? 0 : holdSamples.reduce((sum, s) => sum + s, 0) / holdSamples.length,
    totalOutstandingCents,
    totalDollarsResolvedCents,
    carrierBlockEvents: attempts.filter((a) => a.carrierBlockDetected).length,
  };
}

function findDiscrepancies(
  agingReport: AgingReportRow[],
  attempts: CallAttemptMetric[],
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];
  const agingClaimIds = new Set(agingReport.map((r) => r.claimId));
  const attemptedClaimIds = new Set(attempts.map((a) => a.claimId));
  const latestByClaimId = latestAttemptByClaimId(attempts);

  for (const attempt of attempts) {
    if (!agingClaimIds.has(attempt.claimId)) {
      discrepancies.push({
        claimId: attempt.claimId,
        kind: 'MISSING_FROM_AGING_REPORT',
        detail: 'A call attempt references a claim not present in the source aging report.',
      });
    }
  }

  for (const row of agingReport) {
    if (row.daysOutstanding < 30) continue; // not yet queue-eligible, absence is expected
    if (!attemptedClaimIds.has(row.claimId)) {
      discrepancies.push({
        claimId: row.claimId,
        kind: 'NO_CALL_ATTEMPT_ON_RECORD',
        detail: `Claim is ${row.daysOutstanding} days outstanding with no recorded call attempt.`,
      });
      continue;
    }
    const latest = latestByClaimId.get(row.claimId);
    const isResolved = latest?.outcome !== null && latest?.outcome !== undefined && RESOLVED_OUTCOMES.has(latest.outcome);
    if (isResolved && row.outstandingAmountCents > 0) {
      discrepancies.push({
        claimId: row.claimId,
        kind: 'RESOLVED_BUT_STILL_AGED',
        detail:
          'Latest call attempt outcome is RESOLVED but the aging report still shows an outstanding balance — check for a missed EMR sync write-back.',
      });
    }
  }

  return discrepancies;
}

/**
 * Compare a practice's AR aging report against the engine's call attempts
 * and produce a fleet-level ROI report. Pure function — callers own fetching
 * `agingReport` (from the PMS/CSV import) and `attempts` (from `CallAttempt`)
 * and persisting the result if they want a historical snapshot.
 */
export function reconcileAgingReport(
  agingReport: AgingReportRow[],
  attempts: CallAttemptMetric[],
  now: Date = new Date(),
): ReconciliationReport {
  return {
    generatedAt: now,
    metrics: computeMetrics(agingReport, attempts),
    discrepancies: findDiscrepancies(agingReport, attempts),
  };
}
