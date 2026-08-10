import type { CarrierId, PrismaClient } from '@prisma/client';
import { validateDispatch, CARRIER_CONFIGS, isWithinCallWindow } from '../../carriers/adapter.js'
import { initiateCall, endVapiCall, type VapiCallParams } from '../../vapi/client.js';
import { refreshDeskQueueBroadcast } from './deskQueueBroadcast.js';
import { broadcastDesk } from './deskWs.js';
import { mapActiveCall } from './deskMappers.js';
import { canMakeCall } from '../plans/planBridge.js';
import { CALL_TIMEOUTS } from '../../billing/tiers.js';
import { getPracticeSettings } from '../services/practiceSettingsService.js';
import { piiVault } from '../../pii-vault.js';
import { checkPatientDataCompleteness, raiseMissingPatientDataGate } from './patientDataCompleteness.js';
import { probeClaimStatus } from '../triage/claimStatusProbe.js';
import { transitionClaimRecovery } from '../recovery/transitionClaimRecovery.js';
import { getApprovedNavigationNotes } from '../learning/carrierLessons.js';
import { getPublishedNavigationSteps } from '../discovery/carrierDiscoveryService.js';
import { runWithPracticeRls, runWithRlsBypass } from '../db/rlsContext.js';
import { createEscalation } from '../services/escalationService.js';
import { appendPhiAccessEvent } from '../audit/auditLog.js';
import logger from '../../logger.cjs';

let tickTimer: ReturnType<typeof setInterval> | null = null;
// C-2: prevent concurrent ticks from dual-dispatching the same claim.
// If a tick takes longer than 60 seconds (slow DB, slow Vapi), the next tick
// fires but immediately returns rather than running a parallel dispatch loop.
let isTickRunning = false;

export function startDeskQueueEngine(prisma: PrismaClient): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    if (isTickRunning) {
      logger.warn('[deskQueueEngine] previous tick still running — skipping to prevent dual-dispatch');
      return;
    }
    isTickRunning = true;
    void runDeskQueueTick(prisma)
      .catch((err) => { console.error('[deskQueueEngine] tick error:', err); })
      .finally(() => { isTickRunning = false; });
  }, 60_000);
  isTickRunning = true;
  void runDeskQueueTick(prisma)
    .catch((err) => { console.error('[deskQueueEngine] initial tick error:', err); })
    .finally(() => { isTickRunning = false; });
}

export function stopDeskQueueEngine(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

export async function isPracticeQueuePaused(
  prisma: PrismaClient,
  practiceId: string,
): Promise<boolean> {
  const row = await prisma.practiceDeskState.findUnique({ where: { practiceId } });
  return row?.queuePaused ?? false;
}

export async function setPracticeQueuePaused(
  prisma: PrismaClient,
  practiceId: string,
  paused: boolean,
): Promise<void> {
  await prisma.practiceDeskState.upsert({
    where: { practiceId },
    create: { practiceId, queuePaused: paused },
    update: { queuePaused: paused },
  });
  await refreshDeskQueueBroadcast(prisma, practiceId);
}

// How many queue entries to consider per practice per tick. A blocked or
// deferred head-of-queue claim must never starve dispatchable claims behind it.
const CANDIDATE_BATCH_SIZE = 10;

// Deferral windows for claims that cannot dispatch right now. Pushing
// scheduledFor forward takes the claim out of the candidate window so the
// rest of the queue keeps moving; it re-enters automatically when due.
const DEFER_PHI_TOKEN_MS = 30 * 60 * 1000;      // vault re-tokenization is automatic
const DEFER_STAFF_ACTION_MS = 4 * 60 * 60 * 1000; // staff must fix data or settings
const DEFER_CLAIM_AGE_MS = 24 * 60 * 60 * 1000;   // claim gains a day per day

// Retry-after-failure/congestion delays are jittered rather than fixed:
// every claim that failed around the same moment (a carrier line down, a
// carrier saturated at its concurrency ceiling) would otherwise re-dial in
// lockstep on the same clock — a synchronized retry burst reads as
// coordinated automation to carrier IVR security, not organic backoff.
const DEFER_DISPATCH_FAILURE_BASE_MS = 15 * 60 * 1000; // Vapi error — retry after transient outage
const DEFER_DISPATCH_FAILURE_JITTER_MS = 5 * 60 * 1000;
const DEFER_CARRIER_CONCURRENCY_BASE_MS = 3 * 60 * 1000; // just waiting on a fleet-wide slot, not a failure
const DEFER_CARRIER_CONCURRENCY_JITTER_MS = 2 * 60 * 1000;
// Shorter than the per-carrier ceiling's window: a single carrier line stays
// busy for one call's whole duration, but the fleet-wide slot pool is shared
// across every carrier and every practice — any one of many concurrent calls
// completing anywhere frees a slot, so it churns much faster and is worth
// rechecking sooner.
const DEFER_VAPI_CAPACITY_BASE_MS = 30 * 1000;
const DEFER_VAPI_CAPACITY_JITTER_MS = 30 * 1000;

function withJitter(baseMs: number, jitterMs: number): number {
  return baseMs + Math.floor(Math.random() * jitterMs);
}

// A practice skipped because the fleet-wide Vapi slot budget is exhausted
// this tick would otherwise sit PENDING with no dispatchDeferralCode — same
// failure mode as the per-carrier concurrency ceiling, but for the whole
// fleet. One bulk update per skipped practice (not a per-candidate guard
// pass) since we already know the outcome: there's no slot regardless of
// what the candidate is — EXCEPT a candidate whose carrier is already under
// an active CARRIER_BLOCK (this practice's own, or inherited from an org
// sibling): that one must still resolve to BLOCKED once actually evaluated,
// not get mislabeled as merely waiting on capacity, so those are excluded
// here and left for validateDispatch to catch on this practice's next turn.
async function deferForFleetCapacity(prisma: PrismaClient, practiceIds: string[]): Promise<void> {
  if (practiceIds.length === 0) return;

  const [ownBlocks, orgMemberships] = await Promise.all([
    prisma.carrierBlockEvent.findMany({
      where: { resumedAt: null },
      select: { practiceId: true, carrierId: true },
    }),
    prisma.organizationPractice.findMany({
      where: { practiceId: { in: practiceIds } },
      select: { practiceId: true, organizationId: true },
    }),
  ]);

  const blockedPairs = new Set(ownBlocks.map((b) => `${b.practiceId}:${b.carrierId}`));
  if (orgMemberships.length > 0) {
    const orgIds = [...new Set(orgMemberships.map((m) => m.organizationId))];
    const allOrgMemberships = await prisma.organizationPractice.findMany({
      where: { organizationId: { in: orgIds } },
      select: { practiceId: true, organizationId: true },
    });
    const orgOfPractice = new Map(orgMemberships.map((m) => [m.practiceId, m.organizationId]));
    const practicesByOrg = new Map<string, string[]>();
    for (const m of allOrgMemberships) {
      const list = practicesByOrg.get(m.organizationId) ?? [];
      list.push(m.practiceId);
      practicesByOrg.set(m.organizationId, list);
    }
    for (const practiceId of practiceIds) {
      const orgId = orgOfPractice.get(practiceId);
      if (!orgId) continue;
      const siblingIds = practicesByOrg.get(orgId) ?? [];
      for (const block of ownBlocks) {
        if (siblingIds.includes(block.practiceId)) {
          blockedPairs.add(`${practiceId}:${block.carrierId}`);
        }
      }
    }
  }

  const candidates = await prisma.callQueue.findMany({
    where: {
      practiceId: { in: practiceIds },
      status: 'PENDING',
      scheduledFor: { lte: new Date() },
      dispatchDeferralCode: null,
    },
    select: { id: true, practiceId: true, claim: { select: { carrierId: true } } },
  });
  const idsToDefer = candidates
    .filter((c) => !blockedPairs.has(`${c.practiceId}:${c.claim.carrierId}`))
    .map((c) => c.id);
  if (idsToDefer.length === 0) return;

  await prisma.callQueue.updateMany({
    where: { id: { in: idsToDefer } },
    data: {
      scheduledFor: new Date(Date.now() + withJitter(DEFER_VAPI_CAPACITY_BASE_MS, DEFER_VAPI_CAPACITY_JITTER_MS)),
      dispatchDeferralCode: 'VAPI_FLEET_CONCURRENCY_LIMIT',
      dispatchDeferralNextAction: 'Waiting for an open fleet-wide Vapi calling slot; retries automatically.',
      dispatchDeferredAt: new Date(),
    },
  });
}

// A call attempt whose end-of-call webhook never arrived would hold the M-7
// single-call lock forever, freezing the practice's entire queue. Anything
// older than the worst plausible call (multi-hour carrier hold) is dead.
const STALE_ATTEMPT_MS = 3 * 60 * 60 * 1000;

// Fleet-wide concurrency: the Vapi plan allows a fixed number of simultaneous
// calls. Long carrier holds occupy a slot for their full duration, so a few
// slots are always held back for staff-initiated and pre-visit calls — the
// queue must never consume the entire allowance.
function vapiSlotBudget(): number {
  const limit = parseInt(process.env.VAPI_MAX_CONCURRENT_CALLS ?? '10', 10);
  const reserve = parseInt(process.env.VAPI_CONCURRENCY_RESERVE ?? '2', 10);
  if (!Number.isFinite(limit) || !Number.isFinite(reserve)) return 8;
  return Math.max(0, limit - Math.max(0, reserve));
}

/** Puts a claimed entry back in the pool when this process must not dial it after all. */
async function releaseQueueEntryClaim(
  prisma: PrismaClient,
  queueEntryId: string,
  scheduledFor: Date,
  dispatchDeferralCode: string,
  dispatchDeferralNextAction: string,
): Promise<void> {
  // attempts is deliberately NOT decremented: the attempt was counted the
  // moment this process committed to dialling, and a crash between claim and
  // dial must not hand the claim a free retry.
  await prisma.callQueue.update({
    where: { id: queueEntryId },
    data: {
      status: 'PENDING',
      scheduledFor,
      dispatchDeferralCode,
      dispatchDeferralNextAction,
      dispatchDeferredAt: new Date(),
    },
  });
}

/**
 * Take ownership of a queue entry for dispatch.
 *
 * `updateMany` filtered on `status: 'PENDING'` is atomic at the row level —
 * Postgres serialises the two updates and only one sees a PENDING row — so two
 * app machines cannot both dial the same claim. This must go through a Prisma
 * model operation rather than `$executeRaw`: the RLS extension in
 * lib/prismaRls.ts wraps `$allModels` only, so a raw statement runs with no
 * `app.practice_id` set and, under enforced RLS, silently matches zero rows.
 *
 * The M-7 one-call-per-practice rule is then confirmed after the fact: if
 * another process claimed a different claim for this practice in the same
 * instant, the loser releases its row rather than dialling. Checking after
 * claiming (rather than before) is what makes it safe — both processes have
 * already committed their row, so exactly one sees itself as the extra.
 */
async function claimQueueEntryForDispatch(
  prisma: PrismaClient,
  queueEntryId: string,
  practiceId: string,
): Promise<boolean> {
  const claimed = await prisma.callQueue.updateMany({
    where: { id: queueEntryId, status: 'PENDING' },
    data: {
      status: 'IN_PROGRESS',
      attempts: { increment: 1 },
      lastAttemptAt: new Date(),
      dispatchDeferralCode: null,
      dispatchDeferralNextAction: null,
      dispatchDeferredAt: null,
    },
  });
  if (claimed.count === 0) return false;

  const otherInProgress = await prisma.callQueue.count({
    where: { practiceId, status: 'IN_PROGRESS', id: { not: queueEntryId } },
  });
  if (otherInProgress > 0) {
    logger.warn('[deskQueueEngine] lost the practice dispatch race — releasing claim', {
      queueEntryId,
      practiceId,
    });
    await releaseQueueEntryClaim(
      prisma,
      queueEntryId,
      new Date(Date.now() + withJitter(DEFER_CARRIER_CONCURRENCY_BASE_MS, DEFER_CARRIER_CONCURRENCY_JITTER_MS)),
      'PRACTICE_CALL_IN_PROGRESS',
      'Another call for this practice is already in progress; retries automatically.',
    );
    return false;
  }

  return true;
}

async function deferQueueEntry(
  prisma: PrismaClient,
  queueEntryId: string,
  deferMs: number,
  dispatchDeferralCode: string,
  dispatchDeferralNextAction: string,
): Promise<void> {
  await prisma.callQueue.update({
    where: { id: queueEntryId },
    data: {
      scheduledFor: new Date(Date.now() + deferMs),
      dispatchDeferralCode,
      dispatchDeferralNextAction,
      dispatchDeferredAt: new Date(),
    },
  });
}

type BlockedDisposition = 'skip' | 'stop';

// Settle a queue entry the dispatch guard rejected so it cannot sit PENDING at
// the head of the queue forever: terminal causes leave the PENDING pool,
// retryable causes are deferred, practice-wide causes stop this practice's tick.
async function settleBlockedCandidate(
  prisma: PrismaClient,
  entry: {
    id: string;
    practiceId: string;
    claimId: string;
    claim: {
      claimNumber: string;
      carrierId: keyof typeof CARRIER_CONFIGS;
      outstandingAmount: unknown;
    };
  },
  guardCode: string | undefined,
  guardReason: string | undefined,
): Promise<BlockedDisposition> {
  switch (guardCode) {
    case 'ESCALATE_OVER_90':
    case 'MAX_ATTEMPTS':
      await prisma.$transaction([
        prisma.insuranceClaim.update({
          where: { id: entry.claimId },
          data: { status: 'ESCALATED' },
        }),
        prisma.callQueue.update({
          where: { id: entry.id },
          data: { status: 'ESCALATED' },
        }),
      ]);
      if (guardCode === 'MAX_ATTEMPTS') {
        const existingEscalation = await prisma.callEscalation.findFirst({
          where: {
            practiceId: entry.practiceId,
            claimId: entry.claimId,
            status: 'open',
            reason: 'Maximum automated call attempts reached',
          },
          select: { id: true },
        });
        if (!existingEscalation) {
          await createEscalation(prisma, {
            practiceId: entry.practiceId,
            claimId: entry.claimId,
            claimRef: entry.claim.claimNumber,
            carrierId: entry.claim.carrierId,
            amountClaimedCents: Math.round(Number(entry.claim.outstandingAmount) * 100),
            reason: 'Maximum automated call attempts reached',
            attemptNumber: 3,
          });
        }
      }
      return 'skip';
    case 'APPROVED_PENDING_PAYMENT':
      // Payment follow-up happens in practice AR — this entry is done as a carrier call.
      await prisma.callQueue.update({
        where: { id: entry.id },
        data: { status: 'COMPLETED' },
      });
      return 'skip';
    case 'CARRIER_BLOCK':
      // Mirrors carrierBlockService for entries queued after the block landed.
      // guardReason carries the specific cause (this practice's own block, or
      // a sibling organization location's block) — surface it verbatim rather
      // than a generic message, since a practice that never tripped its own
      // block would otherwise see an unexplained pause.
      await prisma.$transaction([
        prisma.callQueue.update({
          where: { id: entry.id },
          data: {
            status: 'BLOCKED',
            dispatchDeferralCode: 'CARRIER_BLOCK',
            dispatchDeferralNextAction:
              guardReason ??
              'Keep carrier calls suspended until an authorized staff member completes the carrier-block review.',
            dispatchDeferredAt: new Date(),
          },
        }),
        prisma.insuranceClaim.updateMany({
          where: { id: entry.claimId, status: { in: ['PENDING', 'IN_QUEUE', 'CALLING'] } },
          data: { status: 'BLOCKED' },
        }),
      ]);
      return 'skip';
    case 'OUTSIDE_CALL_WINDOW':
    case 'SUBSCRIPTION_CLAIM_LIMIT_REACHED':
    case 'VOICE_AGENT_DISABLED':
      // Practice-wide (or global) condition — no candidate can dispatch this tick.
      return 'stop';
    case 'CLAIM_TOO_YOUNG':
      await deferQueueEntry(
        prisma,
        entry.id,
        DEFER_CLAIM_AGE_MS,
        'CLAIM_TOO_YOUNG',
        'Wait until the claim reaches the minimum carrier-call age before retrying.',
      );
      return 'skip';
    case 'CARRIER_CONCURRENCY_LIMIT':
      // Fleet-wide, not practice-wide — a different candidate in this same
      // batch may target a carrier with room, so skip this one claim rather
      // than stopping the practice's whole tick.
      await deferQueueEntry(
        prisma,
        entry.id,
        withJitter(DEFER_CARRIER_CONCURRENCY_BASE_MS, DEFER_CARRIER_CONCURRENCY_JITTER_MS),
        'CARRIER_CONCURRENCY_LIMIT',
        'Waiting for an open fleet-wide calling slot to this carrier; retries automatically.',
      );
      return 'skip';
    default:
      // RECOVERY_GATE, CARRIER_NOT_AUTHORIZED, and any un-coded rejection:
      // state must change (staff action, route change) before retry makes sense.
      await deferQueueEntry(
        prisma,
        entry.id,
        DEFER_STAFF_ACTION_MS,
        guardCode ?? 'DISPATCH_GUARD_REJECTED',
        'Resolve the required claim or carrier configuration action before retrying.',
      );
      return 'skip';
  }
}

/**
 * Close call attempts that can no longer complete on their own, and end live
 * calls that have outrun the plan's duration ceiling.
 *
 * Runs for every practice on every tick — before the fleet slot budget is
 * computed, and regardless of whether the practice is paused. Open CallAttempt
 * rows are exactly what the budget counts, so a watchdog gated behind "is there
 * a free slot?" cannot run in the situation it exists to fix: enough lost
 * end-of-call webhooks exhaust the budget, dispatch returns early, and the rows
 * that caused it are never reaped. A paused practice must likewise not
 * accumulate attempts that stay open until someone restarts the process.
 */
async function reapStuckCallAttempts(prisma: PrismaClient): Promise<void> {
  // ── OVER-CEILING LIVE CALL TERMINATOR ─────────────────────────────────────
  // Vapi is told maxDurationSeconds at dispatch, but squad calls have been
  // observed to outlive it. Any attempt still open past the absolute ceiling
  // (plus grace for webhook latency) gets its live call ended server-side —
  // the practice must never be billed for minutes the plan ceiling forbids.
  const ceilingBefore = new Date(Date.now() - (CALL_TIMEOUTS.absoluteMaxMinutes + 2) * 60 * 1000);
  const overCeiling = await prisma.callAttempt.findMany({
    where: {
      completedAt: null,
      initiatedAt: { lt: ceilingBefore },
      claim: { deletedAt: null },
    },
    select: { id: true, vapiCallId: true, initiatedAt: true },
  });
  for (const attempt of overCeiling) {
    if (!attempt.vapiCallId) continue;
    logger.error('[deskQueueEngine] call exceeded absolute duration ceiling — ending Vapi call', {
      callAttemptId: attempt.id,
      vapiCallId: attempt.vapiCallId,
      initiatedAt: attempt.initiatedAt.toISOString(),
      ceilingMinutes: CALL_TIMEOUTS.absoluteMaxMinutes,
    });
    try {
      await endVapiCall(attempt.vapiCallId);
    } catch (endErr) {
      logger.error('[deskQueueEngine] failed to end over-ceiling Vapi call', {
        vapiCallId: attempt.vapiCallId,
        error: endErr,
      });
    }
  }

  // ── STALE ATTEMPT WATCHDOG ────────────────────────────────────────────────
  // If Vapi's end-of-call webhook was lost, the open attempt holds the M-7
  // lock forever and that practice never dials again. Close attempts older
  // than any plausible call and release their claims back to the queue —
  // the attempt was already counted at dispatch, so max-3 still holds.
  const staleBefore = new Date(Date.now() - STALE_ATTEMPT_MS);
  const staleAttempts = await prisma.callAttempt.findMany({
    where: {
      completedAt: null,
      initiatedAt: { lt: staleBefore },
      claim: { deletedAt: null },
    },
    select: { id: true, claimId: true, vapiCallId: true, initiatedAt: true },
  });

  for (const staleAttempt of staleAttempts) {
    logger.error('[deskQueueEngine] stale call attempt — closing (end-of-call webhook never arrived)', {
      callAttemptId: staleAttempt.id,
      claimId: staleAttempt.claimId,
      vapiCallId: staleAttempt.vapiCallId,
      initiatedAt: staleAttempt.initiatedAt.toISOString(),
    });
    // Isolated per attempt: one practice's bad row must not abort the sweep
    // for everyone else, which would leave the fleet-wide budget occupied.
    try {
      await prisma.$transaction([
        prisma.callAttempt.update({
          where: { id: staleAttempt.id },
          data: { completedAt: new Date(), liveState: 'expired_no_webhook' },
        }),
        prisma.callQueue.updateMany({
          where: { claimId: staleAttempt.claimId, status: 'IN_PROGRESS' },
          data: { status: 'PENDING', scheduledFor: new Date(Date.now() + 5 * 60 * 1000) },
        }),
        prisma.insuranceClaim.updateMany({
          where: { id: staleAttempt.claimId, status: 'CALLING' },
          data: { status: 'IN_QUEUE' },
        }),
      ]);
    } catch (reapErr) {
      logger.error('[deskQueueEngine] failed to close stale attempt — continuing sweep', {
        callAttemptId: staleAttempt.id,
        error: reapErr,
      });
    }
  }
}

export async function runDeskQueueTick(prisma: PrismaClient): Promise<void> {
  if (!isWithinCallWindow()) return;

  // Reap before counting. The budget below counts open CallAttempt rows, and
  // abandoned rows are both the cause of exhaustion and what this clears —
  // running it after the budget check would make a fleet-wide freeze
  // self-sustaining until the process restarts.
  //
  // Swept fleet-wide in a fixed number of queries rather than per practice:
  // this runs every 60s, so a per-practice sweep would grow the tick's query
  // count linearly with the customer base. Like the snapshot below it is a
  // platform-level job that legitimately spans tenants, so it runs under an
  // RLS bypass — a practice-scoped context would hide exactly the rows it
  // exists to find.
  try {
    await runWithRlsBypass(() => reapStuckCallAttempts(prisma));
  } catch (reapErr) {
    logger.error('[deskQueueEngine] stale-attempt sweep failed — continuing to dispatch', {
      error: reapErr,
    });
  }

  const [practices, activeCallsGlobal, activeAttemptCarriers] = await runWithRlsBypass(async () =>
    Promise.all([
      prisma.practice.findMany({ select: { id: true } }),
      prisma.callAttempt.count({ where: { completedAt: null } }),
      // Fleet-wide per-carrier snapshot for the concurrency guard below. Must
      // be gathered here, outside any single practice's RLS scope — a query
      // run inside runWithPracticeRls would silently narrow to that one
      // practice's calls under enforced RLS, defeating a fleet-wide ceiling.
      prisma.callAttempt.findMany({
        where: { completedAt: null },
        select: { claim: { select: { carrierId: true } } },
      }),
    ]),
  );

  // Mutated in-memory as calls dispatch through this tick so two practices
  // targeting the same carrier in the same pass don't both slip under the
  // ceiling before either write lands.
  const carrierActiveCounts = new Map<CarrierId, number>();
  for (const attempt of activeAttemptCarriers) {
    const carrierId = attempt.claim?.carrierId;
    if (!carrierId) continue;
    carrierActiveCounts.set(carrierId, (carrierActiveCounts.get(carrierId) ?? 0) + 1);
  }

  let slotsRemaining = vapiSlotBudget() - activeCallsGlobal;
  if (slotsRemaining <= 0) {
    logger.warn('[deskQueueEngine] Vapi concurrency budget exhausted — skipping dispatch this tick', {
      activeCallsGlobal,
      slotBudget: vapiSlotBudget(),
    });
    await runWithRlsBypass(() => deferForFleetCapacity(prisma, practices.map((p) => p.id)));
    return;
  }

  // Postgres returns findMany rows in a stable order absent an ORDER BY —
  // without shuffling, the same practices early in that order would win the
  // fleet-wide Vapi slot budget every single tick, starving everyone after
  // them whenever the fleet is at or above budget. Shuffling rotates who
  // gets first crack at scarce slots tick over tick.
  const shuffledPractices = [...practices];
  for (let i = shuffledPractices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledPractices[i], shuffledPractices[j]] = [shuffledPractices[j], shuffledPractices[i]];
  }

  for (let i = 0; i < shuffledPractices.length; i++) {
    const { id: practiceId } = shuffledPractices[i];
    if (slotsRemaining <= 0) {
      await runWithRlsBypass(() =>
        deferForFleetCapacity(prisma, shuffledPractices.slice(i).map((p) => p.id)),
      );
      return;
    }
    // One practice's failure must never starve the practices after it in the
    // loop — isolate each practice's tick.
    try {
    await runWithPracticeRls(practiceId, async () => {
    if (await isPracticeQueuePaused(prisma, practiceId)) return;

    const inProgress = await prisma.callQueue.count({
      where: { practiceId, status: 'IN_PROGRESS' },
    });
    if (inProgress > 0) return;

    // M-7: architectural constraint — one simultaneous call per practice at a time.
    // Any in-progress call attempt (completedAt = null) blocks dispatch of all other
    // claims for this practice until the call ends and the webhook closes the attempt.
    // This is intentional to avoid concurrent calls sharing the same carrier rep's
    // attention and to simplify carrier block detection scope.
    const activeAttempt = await prisma.callAttempt.findFirst({
      where: {
        completedAt: null,
        claim: { practiceId, deletedAt: null },
      },
    });
    if (activeAttempt) return;

    const candidates = await prisma.callQueue.findMany({
      where: {
        practiceId,
        status: 'PENDING',
        scheduledFor: { lte: new Date() },
        claim: { deletedAt: null },
      },
      orderBy: [{ priority: 'desc' }, { scheduledFor: 'asc' }],
      take: CANDIDATE_BATCH_SIZE,
      include: {
        claim: true,
      },
    });

    if (candidates.length === 0) return;

    const planGate = await canMakeCall(practiceId);
    if (!planGate.allowed) {
      console.warn('[deskQueueEngine] plan gate blocked dispatch', {
        practiceId,
        reason: planGate.reason,
      });
      return;
    }

    // COGS breaker throttle: spend the remaining budget on the claims worth
    // the most, not on whatever is next in line. The claims filtered out here
    // still need a recorded reason — otherwise they sit PENDING with no
    // dispatchDeferralCode indefinitely (as long as the practice stays
    // throttled), indistinguishable from the engine never having reached them.
    const dispatchable = planGate.essentialOnly
      ? candidates.filter((c) => c.priority === 'HIGH' || c.priority === 'URGENT')
      : candidates;
    if (planGate.essentialOnly && dispatchable.length < candidates.length) {
      const throttledOut = candidates.filter((c) => c.priority !== 'HIGH' && c.priority !== 'URGENT');
      logger.warn('[deskQueueEngine] COGS throttle active — dispatching high-priority claims only', {
        practiceId,
        skipped: throttledOut.length,
      });
      for (const entry of throttledOut) {
        await deferQueueEntry(
          prisma,
          entry.id,
          DEFER_STAFF_ACTION_MS,
          'COGS_THROTTLE_LOW_PRIORITY',
          'Delivery cost is elevated this billing period — only HIGH/URGENT claims dispatch until it eases or the period resets.',
        );
      }
    }

    for (const next of dispatchable) {
    const attemptsSoFar = next.attempts;
    const guard = await validateDispatch(prisma, {
      practiceId,
      claimId: next.claimId,
      carrierId: next.claim.carrierId,
      daysOutstanding: next.claim.daysOutstanding,
      attemptsSoFar,
      claimStatus: next.claim.status,
      scheduledFor: new Date(),
      carrierActiveCounts,
    });

    if (!guard.allowed) {
      logger.warn('[deskQueueEngine] dispatch guard rejected claim — settling queue entry', {
        claimId: next.claimId,
        code: guard.code,
        reason: guard.reason,
      });
      const disposition = await settleBlockedCandidate(prisma, next, guard.code, guard.reason);
      if (disposition === 'stop') return;
      continue;
    }

    // ── PRE-CALL TRIAGE ────────────────────────────────────────────────────────
    // Cheapest channel first: if any non-phone channel can already answer this
    // claim (PMS sync shows it paid; later: carrier portal / CDAnet), close it
    // here — before PHI is detokenized and before a call is paid for.
    const triage = await probeClaimStatus(prisma, {
      id: next.claimId,
      practiceId,
    });
    if (triage) {
      logger.warn('[deskQueueEngine] triage resolved claim without a call', {
        claimId: next.claimId,
        channel: triage.channel,
        detail: triage.detail,
      });
      await transitionClaimRecovery(prisma, {
        practiceId,
        claimId: next.claimId,
        kind: 'TRIAGE_RESOLVED',
        triageChannel: triage.channel,
        triageDetail: triage.detail,
      });
      continue;
    }

    const carrierConfig = CARRIER_CONFIGS[next.claim.carrierId];

    const practice = await prisma.practice.findUnique({
      where: { id: practiceId },
      select: { name: true, billingPhone: true, npi: true, taxId: true, practiceAddress: true },
    });
    const practiceSettings = await getPracticeSettings(prisma, practiceId);
    const practiceCarrierConfig = practiceSettings.carrierConfigs.find(
      (c) => c.carrierId === next.claim.carrierId,
    );

    // ── PHI RESOLUTION ─────────────────────────────────────────────────────────
    // Detokenize the UUID stored in DB to get the real patient PHI. Plaintext
    // PHI lives in piiVault only (claim-lifecycle TTL, encrypted at rest in
    // PhiVaultEntry, rehydrated on boot). If the token expired we defer this
    // claim; re-import or PMS re-sync re-tokenizes it.
    const phiResult = piiVault.detokenize(
      next.claim.patientToken,
      'queue-engine',
      { practiceId },
    );
    if (!phiResult.success || !phiResult.phi) {
      logger.warn('[deskQueueEngine] PHI token expired or missing — deferring claim', {
        claimId: next.claimId,
        patientToken: next.claim.patientToken,
        error: phiResult.error,
      });
      await deferQueueEntry(
        prisma,
        next.id,
        DEFER_PHI_TOKEN_MS,
        'CLAIM_DATA_UNAVAILABLE',
        'Re-import or synchronize the claim data before retrying.',
      );
      continue;
    }
    const phi = phiResult.phi;
    logger.audit('PHI_TOKEN_RESOLVED', {
      claimId: next.claimId,
      patientToken: next.claim.patientToken,
      callerContext: 'queue-engine',
      phiBoundary: 'PHI_IN_EPHEMERAL_CALL_VARIABLES_ONLY',
    });
    await appendPhiAccessEvent(prisma, {
      practiceId,
      operation: 'detokenize_for_carrier_call',
      recordType: 'InsuranceClaim',
      recordId: next.claimId,
      purpose: 'queued_carrier_dispatch',
      correlationId: next.id,
    });

    // ── PHI COMPLETENESS GUARD ─────────────────────────────────────────────────
    // Carriers require patientName, dateOfBirth, and subscriberId at minimum.
    // Missing any of these causes the agent to fail authentication immediately.
    // Raise a practice-facing gate (dashboard action item with the blocked
    // dollar amount) and defer the claim; staff add the data, clear the gate,
    // and GATE_CLEARED requeues the claim.
    const completeness = checkPatientDataCompleteness(phi);
    if (!completeness.ok) {
      logger.warn('[deskQueueEngine] patient PHI incomplete — raising gate and deferring dispatch', {
        claimId: next.claimId,
        patientToken: next.claim.patientToken,
        missing: completeness.missing,
      });
      await raiseMissingPatientDataGate(prisma, {
        practiceId,
        claimId: next.claimId,
        claimNumber: next.claim.claimNumber,
        outstandingAmount: Number(next.claim.outstandingAmount),
        missing: completeness.missing,
      });
      await deferQueueEntry(
        prisma,
        next.id,
        DEFER_STAFF_ACTION_MS,
        'MISSING_REQUIRED_CLAIM_DATA',
        'Complete the required claim data in the PMS, then clear the recovery gate.',
      );
      continue;
    }
    if (completeness.warnings.length > 0) {
      logger.warn('[deskQueueEngine] patient PHI has optional fields absent — proceeding with caution', {
        claimId: next.claimId,
        patientToken: next.claim.patientToken,
        warnings: completeness.warnings,
      });
    }

    // billingPhone is the CRTC disclosure / carrier callback number.
    // escalationPhoneNumber is for staff takeover — do not use for disclosure.
    const practicePhone =
      practiceSettings.billingPhone?.trim() ||
      practiceSettings.escalationPhoneNumber;

    // Only published, human-approved snapshots may augment the static adapter
    // hints. Proposed discovery output is never exposed to a live call.
    const learnedNotes = await getApprovedNavigationNotes(prisma, next.claim.carrierId);
    const publishedNavigation = await getPublishedNavigationSteps(prisma, next.claim.carrierId);
    const carrierIvrInstructions = [
      ...carrierConfig.ivrHints,
      ...publishedNavigation,
      ...(learnedNotes ? [learnedNotes] : []),
    ].join(' | ');

    const callParams: VapiCallParams = {
      claimId: next.claim.id,
      carrierId: next.claim.carrierId,
      patientToken: next.claim.patientToken,
      // ── PHI — resolved from piiVault.detokenize() above; ephemeral, never stored ──
      patientName:            phi.patientName,
      patientDob:             phi.dateOfBirth,
      policyNumber:           phi.subscriberId,
      groupNumber:            phi.groupPolicyNumber,
      subscriberName:         phi.subscriberName,
      subscriberDob:          phi.subscriberDateOfBirth,
      // ── Claim fields ──────────────────────────────────────────────────────────
      carrierPhone:           carrierConfig.phone,
      claimNumber:            next.claim.claimNumber,
      billedAmount:           Number(next.claim.billedAmount),
      outstandingAmount:      Number(next.claim.outstandingAmount),
      amountExpected:         next.claim.expectedAmount ? Number(next.claim.expectedAmount) : undefined,
      daysOutstanding:        next.claim.daysOutstanding,
      treatmentDate:          next.claim.servicedAt?.toISOString().split('T')[0],
      claimSubmittedDate:     next.claim.submittedAt?.toISOString().split('T')[0],
      treatmentCodes:         next.claim.treatmentCodes ?? undefined,
      // ── Practice identity ─────────────────────────────────────────────────────
      practiceId,
      practiceName:           practice?.name ?? '',
      practiceNpi:            practice?.npi ?? undefined,
      practiceTaxId:          practice?.taxId ?? undefined,
      practiceAddress:        practice?.practiceAddress ?? undefined,
      providerNumber:         practiceCarrierConfig?.providerNumber ?? '',
      practicePhone,
      languagePreference:     practiceCarrierConfig?.languagePreference ?? 'en',
      carrierIvrInstructions,
    };

    // Claim the row before dialling. Production runs multiple app machines and
    // isTickRunning is per process, so without an atomic claim two machines can
    // read the same PENDING row and both call the carrier about one claim.
    // Conditioning on this practice having no other IN_PROGRESS row keeps the
    // M-7 one-call-per-practice rule true across processes as well — both
    // conditions are evaluated inside a single statement, so there is no window
    // between checking and taking.
    const claimed = await claimQueueEntryForDispatch(prisma, next.id, practiceId);
    if (!claimed) {
      logger.warn('[deskQueueEngine] queue entry already claimed elsewhere — skipping', {
        claimId: next.claimId,
        queueEntryId: next.id,
      });
      continue;
    }

    // C-3: Vapi call is dispatched after the claim (we still need the vapiCallId
    // it returns for the attempt row). If anything below fails, the live call is
    // cancelled rather than left as an orphan with no DB record. A dispatch
    // failure releases the claim back to PENDING with a deferral so a
    // payload-specific Vapi rejection cannot hot-loop at the head of the queue.
    let vapiResult: Awaited<ReturnType<typeof initiateCall>>;
    try {
      vapiResult = await initiateCall(callParams);
    } catch (dispatchErr) {
      logger.error('[deskQueueEngine] Vapi dispatch failed — deferring claim', {
        claimId: next.claimId,
        carrierId: next.claim.carrierId,
        error: dispatchErr,
      });
      await releaseQueueEntryClaim(
        prisma,
        next.id,
        new Date(Date.now() + withJitter(DEFER_DISPATCH_FAILURE_BASE_MS, DEFER_DISPATCH_FAILURE_JITTER_MS)),
        'TRANSIENT_DISPATCH_FAILURE',
        'The system will retry during the next scheduled dispatch window.',
      );
      continue;
    }
    slotsRemaining -= 1;
    carrierActiveCounts.set(next.claim.carrierId, (carrierActiveCounts.get(next.claim.carrierId) ?? 0) + 1);

    try {
      const attempt = await prisma.callAttempt.create({
        data: {
          claimId: next.claimId,
          vapiCallId: vapiResult.vapiCallId,
          initiatedAt: new Date(),
          liveState: 'dialing',
          activeAgent: 'IVR_Navigator',
        },
      });

      // Status, attempt count, and lastAttemptAt were already written by the
      // pre-dispatch claim; only the claim-side status remains.
      await prisma.insuranceClaim.update({
        where: { id: next.claimId },
        data: { status: 'CALLING' },
      });

      const call = mapActiveCall(attempt, next.claim, next.attempts + 1);
      broadcastDesk(practiceId, { type: 'call.started', data: { call } });
    } catch (postDispatchErr) {
      // DB write failed after Vapi call was already live — cancel the call
      // immediately to prevent an orphan call whose webhooks would be silently
      // dropped (no callAttempt row to look up).
      logger.error('[deskQueueEngine] post-dispatch DB write failed — cancelling Vapi call', {
        vapiCallId: vapiResult.vapiCallId,
        claimId: next.claimId,
        error: postDispatchErr,
      });
      try {
        await endVapiCall(vapiResult.vapiCallId);
      } catch (cancelErr) {
        logger.error('[deskQueueEngine] CRITICAL: orphan Vapi call — cancel also failed', {
          vapiCallId: vapiResult.vapiCallId,
          cancelError: cancelErr,
        });
      }
      // The row was claimed IN_PROGRESS before dialling, and no CallAttempt
      // now exists to close it — leaving it would strand this practice's queue
      // behind a call that no webhook will ever complete.
      try {
        await releaseQueueEntryClaim(
          prisma,
          next.id,
          new Date(Date.now() + withJitter(DEFER_DISPATCH_FAILURE_BASE_MS, DEFER_DISPATCH_FAILURE_JITTER_MS)),
          'TRANSIENT_DISPATCH_FAILURE',
          'The system will retry during the next scheduled dispatch window.',
        );
      } catch (releaseErr) {
        logger.error('[deskQueueEngine] CRITICAL: could not release claimed queue entry', {
          queueEntryId: next.id,
          error: releaseErr,
        });
      }
    }

    // One call per practice per tick — a call was dispatched (or attempted),
    // so stop scanning candidates for this practice.
    return;
    } // candidate loop
    }); // runWithPracticeRls
    } catch (practiceErr) {
      logger.error('[deskQueueEngine] practice tick failed — continuing with next practice', {
        practiceId,
        error: practiceErr,
      });
    }
  }
}
