import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { validateDispatch, CARRIER_CONFIGS, isWithinCallWindow } from '../../carriers/adapter.js'
import { initiateCall, endVapiCall, type VapiCallParams } from '../../vapi/client.js';
import { vapiCircuitBreaker } from '../../vapi/circuitBreaker.js';
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
import logger from '../observability/logger.js';

let tickTimer: ReturnType<typeof setInterval> | null = null;
// C-2: prevent concurrent ticks from dual-dispatching the same claim.
// If a tick takes longer than 60 seconds (slow DB, slow Vapi), the next tick
// fires but immediately returns rather than running a parallel dispatch loop.
let isTickRunning = false;
// Tracked so a graceful shutdown can await the in-flight tick instead of
// exiting mid-dispatch (which would leave a claim in an ambiguous state).
let currentTick: Promise<void> | null = null;
let acceptingNewTicks = true;

export function startDeskQueueEngine(prisma: PrismaClient): void {
  if (tickTimer) return;
  acceptingNewTicks = true;
  const fire = () => {
    if (!acceptingNewTicks) return;
    if (isTickRunning) {
      logger.warn('[deskQueueEngine] previous tick still running — skipping to prevent dual-dispatch');
      return;
    }
    isTickRunning = true;
    currentTick = runDeskQueueTick(prisma)
      .catch((err) => { logger.error('[deskQueueEngine] tick error', { error: err }); })
      .finally(() => { isTickRunning = false; currentTick = null; });
  };
  tickTimer = setInterval(fire, 60_000);
  fire();
}

export function stopDeskQueueEngine(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

/**
 * Graceful-shutdown hook: stop scheduling new ticks and wait for any
 * in-flight tick to finish (up to timeoutMs) before the process exits, so a
 * claim mid-dispatch isn't abandoned by a hard exit. Does not throw on
 * timeout — shutdown must proceed either way, just logs so it's visible.
 */
export async function drainDeskQueueEngine(timeoutMs: number): Promise<void> {
  acceptingNewTicks = false;
  stopDeskQueueEngine();
  const inFlight = currentTick;
  if (!inFlight) return;

  let timedOut = false;
  const timeout = new Promise<void>((resolve) => {
    setTimeout(() => { timedOut = true; resolve(); }, timeoutMs);
  });
  await Promise.race([inFlight, timeout]);
  if (timedOut) {
    logger.error('[deskQueueEngine] shutdown: in-flight tick did not finish — proceeding anyway', { timeoutMs });
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
const DEFER_DISPATCH_FAILURE_MS = 15 * 60 * 1000; // Vapi error — retry after transient outage

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

// This process's identity for the QueueEngineLease row — diagnostic only,
// the claim itself is decided by the atomic UPDATE below, not by comparing IDs.
const ENGINE_INSTANCE_ID = `${process.pid}-${randomUUID()}`;
const LEASE_ID = 'global';
// Longer than the 60s tick interval so a live tick's lease survives to cover
// the next scheduled fire (no gap where a second replica could sneak in),
// but a crashed process's stale lease still clears within two ticks.
const LEASE_TTL_MS = 90_000;

/**
 * Atomically claim the fleet-wide dispatch lease. Only one replica's tick
 * body may run at a time — the in-process isTickRunning guard alone only
 * protects a single Node process, not a horizontally-scaled deployment.
 * Uses the same claim-row idiom as ProcessedVapiWebhook rather than a native
 * Postgres advisory lock: session-level advisory locks are tied to the
 * physical connection that acquired them, and a pooled connection can route
 * the matching unlock call through a different one, silently failing to
 * release — a DB row with a WHERE-guarded UPSERT has no such gotcha.
 *
 * The WHERE guard must also let this same instance renew its own still-live
 * lease — LEASE_TTL_MS (90s) is deliberately longer than the 60s tick
 * interval so a slow tick's lease survives to the next scheduled fire, but
 * without the locked_by clause below, that same margin means this process's
 * OWN next tick would see its own lease as still "held" and skip forever:
 * on a single-machine deployment (the only thing running today) every tick
 * after the first would silently never dispatch again. Caught by
 * tests/dsoLoadCapacity.test.ts running two real consecutive ticks — every
 * other lease test either reset the row between cases or mocked $executeRaw
 * outright, so this never showed up until something ran the real sequence.
 */
export async function claimTickLease(
  prisma: PrismaClient,
  instanceId: string = ENGINE_INSTANCE_ID,
): Promise<boolean> {
  const affected = await prisma.$executeRaw`
    INSERT INTO queue_engine_lease (id, locked_until, locked_by, updated_at)
    VALUES (${LEASE_ID}, now() + (${LEASE_TTL_MS}::int * interval '1 millisecond'), ${instanceId}, now())
    ON CONFLICT (id) DO UPDATE
    SET locked_until = now() + (${LEASE_TTL_MS}::int * interval '1 millisecond'),
        locked_by = ${instanceId},
        updated_at = now()
    WHERE queue_engine_lease.locked_until IS NULL
       OR queue_engine_lease.locked_until < now()
       OR queue_engine_lease.locked_by = ${instanceId}
  `;
  return affected > 0;
}

interface PracticeServeOrder {
  id: string;
}

/**
 * Practices ordered so the one that's gone longest without a turn (or never
 * had one) goes first. A practice only keeps its place in line if the loop
 * never reached it this tick (slot budget exhausted first) — see the
 * lastServedAt touch inside the loop below.
 */
export async function orderPracticesByFairness(prisma: PrismaClient): Promise<PracticeServeOrder[]> {
  return prisma.$queryRaw<PracticeServeOrder[]>`
    SELECT p.id
    FROM "Practice" p
    LEFT JOIN practice_desk_state pds ON pds.practice_id = p.id
    ORDER BY pds.last_served_at ASC NULLS FIRST, p.id ASC
  `;
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
      await prisma.$transaction([
        prisma.callQueue.update({
          where: { id: entry.id },
          data: {
            status: 'BLOCKED',
            dispatchDeferralCode: 'CARRIER_BLOCK',
            dispatchDeferralNextAction: 'Keep carrier calls suspended until an authorized staff member completes the carrier-block review.',
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

export async function runDeskQueueTick(prisma: PrismaClient): Promise<void> {
  if (!isWithinCallWindow()) return;

  // Fleet-wide lease: if another replica already holds it this cycle, skip —
  // it, not this process, is running the tick body right now.
  if (!(await runWithRlsBypass(() => claimTickLease(prisma)))) {
    logger.warn('[deskQueueEngine] another replica holds the dispatch lease — skipping this tick', {
      instanceId: ENGINE_INSTANCE_ID,
    });
    return;
  }

  const [practices, activeCallsGlobal] = await runWithRlsBypass(async () =>
    Promise.all([
      orderPracticesByFairness(prisma),
      prisma.callAttempt.count({ where: { completedAt: null } }),
    ]),
  );

  let slotsRemaining = vapiSlotBudget() - activeCallsGlobal;
  if (slotsRemaining <= 0) {
    logger.warn('[deskQueueEngine] Vapi concurrency budget exhausted — skipping dispatch this tick', {
      activeCallsGlobal,
      slotBudget: vapiSlotBudget(),
    });
    return;
  }

  // Additive to the guards above — does not replace the isTickRunning latch,
  // the lease, or the slot budget. Skipping the whole tick here (rather than
  // letting every candidate claim fail into its own per-claim deferral) is
  // deliberate: if Vapi is down, there is no point spending a claim's
  // dispatch attempt (and its 15-minute defer window) finding that out
  // again for every practice in the loop.
  if (vapiCircuitBreaker.getState() === 'OPEN') {
    logger.warn('[deskQueueEngine] Vapi circuit breaker OPEN — skipping dispatch this tick', {
      metrics: vapiCircuitBreaker.getMetrics(),
    });
    return;
  }

  for (const { id: practiceId } of practices) {
    if (slotsRemaining <= 0) return;
    // One practice's failure must never starve the practices after it in the
    // loop — isolate each practice's tick.
    try {
    await runWithPracticeRls(practiceId, async () => {
    // Reaching this point spends this practice's fairness turn for the tick —
    // it sorts to the back of orderPracticesByFairness next time, same as
    // every other practice the loop got to (paused or not). A practice the
    // loop never reaches (slot budget ran out first) keeps its older
    // timestamp and moves to the front instead.
    await prisma.practiceDeskState.upsert({
      where: { practiceId },
      create: { practiceId, lastServedAt: new Date() },
      update: { lastServedAt: new Date() },
    });
    if (await isPracticeQueuePaused(prisma, practiceId)) return;

    // ── STALE ATTEMPT WATCHDOG ─────────────────────────────────────────────────
    // If Vapi's end-of-call webhook was lost, the open attempt holds the M-7
    // lock forever and this practice never dials again. Close attempts older
    // than any plausible call and release their claims back to the queue —
    // the attempt was already counted at dispatch, so max-3 still holds.
    const staleBefore = new Date(Date.now() - STALE_ATTEMPT_MS);
    const staleAttempts = await prisma.callAttempt.findMany({
      where: {
        completedAt: null,
        initiatedAt: { lt: staleBefore },
        claim: { practiceId, deletedAt: null },
      },
      select: { id: true, claimId: true, vapiCallId: true, initiatedAt: true },
    });
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
        claim: { practiceId, deletedAt: null },
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

    for (const staleAttempt of staleAttempts) {
      logger.error('[deskQueueEngine] stale call attempt — closing (end-of-call webhook never arrived)', {
        callAttemptId: staleAttempt.id,
        claimId: staleAttempt.claimId,
        vapiCallId: staleAttempt.vapiCallId,
        initiatedAt: staleAttempt.initiatedAt.toISOString(),
      });
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
    }

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
      logger.warn('[deskQueueEngine] plan gate blocked dispatch', {
        practiceId,
        reason: planGate.reason,
      });
      return;
    }

    // COGS breaker throttle: spend the remaining budget on the claims worth
    // the most, not on whatever is next in line.
    const dispatchable = planGate.essentialOnly
      ? candidates.filter((c) => c.priority === 'HIGH' || c.priority === 'URGENT')
      : candidates;
    if (planGate.essentialOnly && dispatchable.length < candidates.length) {
      logger.warn('[deskQueueEngine] COGS throttle active — dispatching high-priority claims only', {
        practiceId,
        skipped: candidates.length - dispatchable.length,
      });
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
    });

    if (!guard.allowed) {
      logger.warn('[deskQueueEngine] dispatch guard rejected claim — settling queue entry', {
        claimId: next.claimId,
        code: guard.code,
        reason: guard.reason,
      });
      const disposition = await settleBlockedCandidate(prisma, next, guard.code);
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

    // C-3: Vapi call is dispatched first (we need the vapiCallId it returns).
    // All subsequent DB writes are wrapped so that if they fail, we immediately
    // cancel the live Vapi call rather than leaving an orphan call with no DB record.
    // A dispatch failure defers the entry: a payload-specific Vapi rejection must
    // not hot-loop the same claim at the head of the queue every tick.
    let vapiResult: Awaited<ReturnType<typeof initiateCall>>;
    try {
      vapiResult = await initiateCall(callParams);
    } catch (dispatchErr) {
      logger.error('[deskQueueEngine] Vapi dispatch failed — deferring claim', {
        claimId: next.claimId,
        carrierId: next.claim.carrierId,
        error: dispatchErr,
      });
      await deferQueueEntry(
        prisma,
        next.id,
        DEFER_DISPATCH_FAILURE_MS,
        'TRANSIENT_DISPATCH_FAILURE',
        'The system will retry during the next scheduled dispatch window.',
      );
      continue;
    }
    slotsRemaining -= 1;

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

      await prisma.$transaction([
        prisma.insuranceClaim.update({
          where: { id: next.claimId },
          data: { status: 'CALLING' },
        }),
        prisma.callQueue.update({
          where: { id: next.id },
          data: {
            status: 'IN_PROGRESS',
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
            dispatchDeferralCode: null,
            dispatchDeferralNextAction: null,
            dispatchDeferredAt: null,
          },
        }),
      ]);

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
