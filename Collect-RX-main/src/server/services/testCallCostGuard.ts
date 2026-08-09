// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Rep Simulator Test-Call Cost Guard
//
// "Kill Test 1" infrastructure: hard spend ceiling for synthetic Rep
// Simulator calls (scripts/rep-simulator/run-kill-test.ts). A single test
// run (all CallAttempt rows sharing one testRunId, isSynthetic=true) must
// never be allowed to cost more than TEST_CALL_COST_CEILING_USD.
//
// Mirrors the CARRIER_BLOCK "check before proceeding" idiom used in
// ../../carriers/adapter.ts (checkCarrierBlock): call
// assertUnderTestCallCostCeiling() before every synthetic-call dispatch and
// abort immediately if it throws — never place the call anyway.
// ─────────────────────────────────────────────────────────────────────────────

import type { CarrierId, PrismaClient } from '@prisma/client';
import { UNIT_ECONOMICS } from '../../billing/tiers.js';
import { maxCallDurationSeconds } from '../../vapi/client.js';

/** Hard ceiling for total estimated spend across one Rep Simulator test run. */
export const TEST_CALL_COST_CEILING_USD = 30;

/**
 * Cost-per-minute used to estimate synthetic test-call spend.
 *
 * Reused from UNIT_ECONOMICS.costPerMinute (src/billing/tiers.ts) rather than
 * a made-up placeholder — that constant is CollectRx's actual metered COGS
 * rate (Vapi + GPT + Deepgram + voice + Twilio + hosting) for a real call, so
 * the $30 kill-test ceiling tracks real infra pricing instead of a number
 * that can silently drift out of sync with reality.
 */
export const SYNTHETIC_CALL_COST_PER_MINUTE_USD = UNIT_ECONOMICS.costPerMinute;

export interface TestCallCostSummary {
  testRunId: string;
  /** Estimated cost, in USD, of synthetic calls already recorded for this run. */
  existingCostUsd: number;
  /** Worst-case estimated cost of the call about to be dispatched. */
  projectedNextCallCostUsd: number;
  /** existingCostUsd + projectedNextCallCostUsd. */
  projectedTotalCostUsd: number;
  ceilingUsd: number;
}

/** Thrown by assertUnderTestCallCostCeiling() — never caught-and-ignored by dispatch code. */
export class TestCallCostCeilingExceededError extends Error {
  readonly summary: TestCallCostSummary;

  constructor(summary: TestCallCostSummary) {
    super(
      `Rep Simulator test run ${summary.testRunId} would exceed the $${summary.ceilingUsd.toFixed(2)} ` +
        `cost ceiling (existing $${summary.existingCostUsd.toFixed(2)} + next-call worst case ` +
        `$${summary.projectedNextCallCostUsd.toFixed(2)} = $${summary.projectedTotalCostUsd.toFixed(2)}). ` +
        'Dispatch blocked — start a new testRunId or raise the ceiling deliberately.',
    );
    this.name = 'TestCallCostCeilingExceededError';
    this.summary = summary;
  }
}

/**
 * Estimated cost of one recorded synthetic CallAttempt row.
 *
 * A call still in flight (or one that failed before Vapi returned duration)
 * has minutesBilled === null. It has no confirmed cost yet, so it is not
 * counted here — the worst-case cost of an in-flight call is instead covered
 * by the projectedNextCallCostUsd term the caller supplies for the call it
 * is about to dispatch.
 */
function estimateAttemptCostUsd(minutesBilled: number | null): number {
  if (minutesBilled === null) return 0;
  return minutesBilled * SYNTHETIC_CALL_COST_PER_MINUTE_USD;
}

/** Worst-case cost of a not-yet-placed call: the carrier's max allowed duration, billed in full. */
function worstCaseCallCostUsd(carrierId: CarrierId): number {
  const maxMinutes = maxCallDurationSeconds(carrierId) / 60;
  return maxMinutes * SYNTHETIC_CALL_COST_PER_MINUTE_USD;
}

/**
 * Sum estimated spend for a Rep Simulator test run and hard-block (throw)
 * if dispatching the next call could push the run over
 * TEST_CALL_COST_CEILING_USD.
 *
 * Must be called immediately before every synthetic-call dispatch — same
 * "check before proceeding" contract as checkCarrierBlock() in
 * ../../carriers/adapter.ts. On success, returns the cost summary so the
 * caller can log/report it; on failure, throws
 * TestCallCostCeilingExceededError and the caller must not dial.
 */
export async function assertUnderTestCallCostCeiling(
  prisma: PrismaClient,
  params: { testRunId: string; carrierId: CarrierId },
): Promise<TestCallCostSummary> {
  const { testRunId, carrierId } = params;

  const priorAttempts = await prisma.callAttempt.findMany({
    where: { testRunId, isSynthetic: true },
    select: { minutesBilled: true },
  });

  const existingCostUsd = priorAttempts.reduce(
    (sum, attempt) => sum + estimateAttemptCostUsd(attempt.minutesBilled),
    0,
  );
  const projectedNextCallCostUsd = worstCaseCallCostUsd(carrierId);
  const projectedTotalCostUsd = existingCostUsd + projectedNextCallCostUsd;

  const summary: TestCallCostSummary = {
    testRunId,
    existingCostUsd,
    projectedNextCallCostUsd,
    projectedTotalCostUsd,
    ceilingUsd: TEST_CALL_COST_CEILING_USD,
  };

  if (projectedTotalCostUsd > TEST_CALL_COST_CEILING_USD) {
    throw new TestCallCostCeilingExceededError(summary);
  }

  return summary;
}
