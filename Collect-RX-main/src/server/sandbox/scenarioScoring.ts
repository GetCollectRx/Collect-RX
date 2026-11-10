/**
 * Scores every finished sandbox call against its registry scenario.
 *
 * Each call's outcome class (from the scenario's expected-outcome text, or its
 * carrier persona when the text is not specific) says what the product should
 * have done. The verdict compares that with the claim status, the attempt
 * outcome and CARRIER_BLOCK state the product actually produced, plus checks
 * every call must pass: the stored transcript must not contain the patient's
 * name, and a Hold Sentinel call that reached a rep must have been transferred.
 *
 * Results are written to the audit log (action sandbox.scenario_result) with
 * no patient details, so they survive restarts and the results page can read
 * them back.
 */
import type { ClaimStatus, PrismaClient } from '@prisma/client';
import { appendAuditLog } from '../audit/auditLog.js';
import { runWithRlsBypass } from '../db/rlsContext.js';
import { logger } from '../observability/logger.js';
import type { CallPhi } from './callPlan.js';
import type { SimCallSummary } from './carrierSimulator.js';
import { findCallScenario, type OutcomeClass } from './scenarioRegistry.js';

export const SCENARIO_RESULT_ACTION = 'sandbox.scenario_result';
/** Time the product gets to process the end-of-call report before it is scored. */
export const SCORE_DELAY_MS = 20_000;

export type Verdict = 'PASS' | 'FAIL';

export interface CheckResult {
  id: string;
  passed: boolean;
  detail: string;
}

export interface ObservedState {
  claimStatus: ClaimStatus | null;
  attemptOutcome: string | null;
  carrierBlocked: boolean;
  transcriptText: string | null;
}

const OPEN_STATUSES: ReadonlySet<string> = new Set(['PENDING', 'IN_QUEUE', 'CALLING', 'APPROVED_PENDING_PAYMENT', 'ON_HOLD']);

export function expectedFor(cls: OutcomeClass): { describe: string; check: (o: ObservedState) => boolean } {
  switch (cls) {
    case 'PAID':
      return { describe: 'claim RESOLVED', check: (o) => o.claimStatus === 'RESOLVED' };
    case 'PARTIAL':
    case 'NOT_RECEIVED':
    case 'NEED_INFO':
    case 'UNCLEAR':
      return { describe: 'claim ESCALATED to staff', check: (o) => o.claimStatus === 'ESCALATED' };
    case 'DENIED':
    case 'DENIED_MAX':
    case 'DENIED_NOT_COVERED':
      return { describe: 'claim DENIED', check: (o) => o.claimStatus === 'DENIED' };
    case 'PROCESSING':
      return { describe: 'claim left open for follow-up', check: (o) => o.claimStatus !== null && OPEN_STATUSES.has(o.claimStatus) };
    case 'REFUSAL':
      return { describe: 'CARRIER_BLOCK applied to the carrier', check: (o) => o.carrierBlocked };
    case 'CALLBACK':
      return { describe: 'claim not closed (no resolution on a callback)', check: (o) => o.claimStatus !== 'RESOLVED' && o.claimStatus !== 'DENIED' };
    case 'TECH_FAIL':
      return {
        describe: 'failed attempt recorded, claim not closed',
        check: (o) => ['NO_ANSWER', 'FAILED', 'HUNG_UP'].includes(o.attemptOutcome ?? '') && o.claimStatus !== 'RESOLVED' && o.claimStatus !== 'DENIED',
      };
  }
}

export function scoreCall(call: SimCallSummary, observed: ObservedState, phi: CallPhi | null): { verdict: Verdict; checks: CheckResult[] } {
  const expected = expectedFor(call.outcomeClass);
  const checks: CheckResult[] = [
    {
      id: 'expected-outcome',
      passed: expected.check(observed),
      detail: `expected ${expected.describe}; observed claim ${observed.claimStatus ?? 'missing'}, attempt ${observed.attemptOutcome ?? 'none'}, carrier blocked ${observed.carrierBlocked}`,
    },
  ];
  if (phi?.patientName) {
    const leaked = (observed.transcriptText ?? '').includes(phi.patientName);
    checks.push({ id: 'no-patient-name-in-stored-transcript', passed: !leaked, detail: leaked ? 'stored transcript contains the patient name' : 'patient name not in stored transcript' });
  }
  if (call.mode === 'hold_sentinel' && call.outcomeClass !== 'TECH_FAIL') {
    checks.push({
      id: 'staff-transfer',
      passed: Boolean(call.transferredAt),
      detail: call.transferredAt ? `transferred to staff at ${call.transferredAt}` : `handoff requested at ${call.handoffRequestedAt ?? 'never'}, never transferred`,
    });
  }
  return { verdict: checks.every((c) => c.passed) ? 'PASS' : 'FAIL', checks };
}

export async function observe(prisma: PrismaClient, call: SimCallSummary): Promise<ObservedState & { attemptId: string | null }> {
  return runWithRlsBypass(async () => {
    const attempt = await prisma.callAttempt.findFirst({
      where: { vapiCallId: call.vapiCallId },
      select: { id: true, outcome: true, transcriptText: true, claim: { select: { status: true, carrierId: true, practiceId: true } } },
    });
    const blocked = attempt
      ? await prisma.carrierBlockEvent.count({
          where: { practiceId: attempt.claim.practiceId, carrierId: attempt.claim.carrierId, resumedAt: null },
        })
      : 0;
    return {
      attemptId: attempt?.id ?? null,
      claimStatus: attempt?.claim.status ?? null,
      attemptOutcome: attempt?.outcome ?? null,
      carrierBlocked: blocked > 0,
      transcriptText: attempt?.transcriptText ?? null,
    };
  });
}

export function registerScenarioScoring(prisma: PrismaClient, sim: { onCallEnded: (l: (c: SimCallSummary, ctx: { phi: CallPhi | null }) => void) => void }): void {
  sim.onCallEnded((call, { phi }) => {
    const heldPhi = phi ? { ...phi } : null;
    setTimeout(() => {
      void (async () => {
        const observed = await observe(prisma, call);
        const { verdict, checks } = scoreCall(call, observed, heldPhi);
        const scenario = findCallScenario(call.scenarioId);
        await appendAuditLog(prisma, {
          practiceId: call.practiceId,
          action: SCENARIO_RESULT_ACTION,
          subjectType: 'CallAttempt',
          subjectId: observed.attemptId ?? undefined,
          details: {
            scenarioId: call.scenarioId,
            scenarioName: scenario?.name ?? null,
            tier: scenario?.tier ?? null,
            layer: scenario?.layer ?? null,
            expectedOutcomeText: scenario?.expectedOutcomeText ?? null,
            outcomeClass: call.outcomeClass,
            mode: call.mode,
            carrierId: call.carrierId,
            claimNumber: call.claimNumber,
            verdict,
            checks: checks.map((c) => ({ id: c.id, passed: c.passed, detail: c.detail })),
            endedReason: call.endedReason,
            startedAt: call.startedAt,
            endedAt: call.endedAt,
          },
        });
      })().catch((err: unknown) => {
        logger.warn('[sandbox] scoring failed', { vapiCallId: call.vapiCallId, error: err instanceof Error ? err.message : 'unknown' });
      });
    }, SCORE_DELAY_MS).unref();
  });
}
