import type { PrismaClient } from '@prisma/client';
import { validateDispatch, CARRIER_CONFIGS, isWithinCallWindow } from '../../carriers/adapter.js'
import { initiateCall, endVapiCall, type VapiCallParams } from '../../vapi/client.js';
import { refreshDeskQueueBroadcast } from './deskQueueBroadcast.js';
import { broadcastDesk } from './deskWs.js';
import { mapActiveCall } from './deskMappers.js';
import { canMakeCall } from '../plans/planBridge.js';
import { getPracticeSettings } from '../services/practiceSettingsService.js';
import { piiVault } from '../../pii-vault.js';
import { checkPatientDataCompleteness, raiseMissingPatientDataGate } from './patientDataCompleteness.js';
import { probeClaimStatus } from '../triage/claimStatusProbe.js';
import { getApprovedNavigationNotes } from '../learning/carrierLessons.js';
import { runWithPracticeRls, runWithRlsBypass } from '../db/rlsContext.js';
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
const DEFER_DISPATCH_FAILURE_MS = 15 * 60 * 1000; // Vapi error — retry after transient outage

// A call attempt whose end-of-call webhook never arrived would hold the M-7
// single-call lock forever, freezing the practice's entire queue. Anything
// older than the worst plausible call (multi-hour carrier hold) is dead.
const STALE_ATTEMPT_MS = 3 * 60 * 60 * 1000;

async function deferQueueEntry(
  prisma: PrismaClient,
  queueEntryId: string,
  deferMs: number,
): Promise<void> {
  await prisma.callQueue.update({
    where: { id: queueEntryId },
    data: { scheduledFor: new Date(Date.now() + deferMs) },
  });
}

type BlockedDisposition = 'skip' | 'stop';

// Settle a queue entry the dispatch guard rejected so it cannot sit PENDING at
// the head of the queue forever: terminal causes leave the PENDING pool,
// retryable causes are deferred, practice-wide causes stop this practice's tick.
async function settleBlockedCandidate(
  prisma: PrismaClient,
  entry: { id: string; claimId: string },
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
          data: { status: 'BLOCKED' },
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
      await deferQueueEntry(prisma, entry.id, DEFER_CLAIM_AGE_MS);
      return 'skip';
    default:
      // RECOVERY_GATE, CARRIER_NOT_AUTHORIZED, and any un-coded rejection:
      // state must change (staff action, route change) before retry makes sense.
      await deferQueueEntry(prisma, entry.id, DEFER_STAFF_ACTION_MS);
      return 'skip';
  }
}

export async function runDeskQueueTick(prisma: PrismaClient): Promise<void> {
  if (!isWithinCallWindow()) return;

  const practices = await runWithRlsBypass(async () =>
    prisma.practice.findMany({ select: { id: true } }),
  );

  for (const { id: practiceId } of practices) {
    // One practice's failure must never starve the practices after it in the
    // loop — isolate each practice's tick.
    try {
    await runWithPracticeRls(practiceId, async () => {
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
        claim: { practiceId },
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
        claim: { practiceId },
      },
    });
    if (activeAttempt) return;

    const candidates = await prisma.callQueue.findMany({
      where: {
        practiceId,
        status: 'PENDING',
        scheduledFor: { lte: new Date() },
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

    for (const next of candidates) {
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
      await prisma.callQueue.update({
        where: { id: next.id },
        data: { status: 'COMPLETED' },
      });
      await prisma.claimRecoveryEvent.create({
        data: {
          practiceId,
          claimId: next.claimId,
          eventType: `triage_closed_${triage.channel}`,
          metadata: { detail: triage.detail },
        },
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
    // Detokenize the UUID stored in DB to get the real patient PHI.
    // PHI lives in piiVault (in-memory, 4-hour TTL) only — never in the DB.
    // If the token has expired (e.g. server restart) we defer this claim and
    // log the error so a re-tokenization pass can recover it.
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
      await deferQueueEntry(prisma, next.id, DEFER_PHI_TOKEN_MS);
      continue;
    }
    const phi = phiResult.phi;
    logger.audit('PHI_TOKEN_RESOLVED', {
      claimId: next.claimId,
      patientToken: next.claim.patientToken,
      callerContext: 'queue-engine',
      phiBoundary: 'PHI_IN_EPHEMERAL_CALL_VARIABLES_ONLY',
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
      await deferQueueEntry(prisma, next.id, DEFER_STAFF_ACTION_MS);
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

    // Build IVR instructions from carrier adapter knowledge base, plus any
    // human-APPROVED lessons the learning loop has produced for this carrier.
    const learnedNotes = await getApprovedNavigationNotes(prisma, next.claim.carrierId);
    const carrierIvrInstructions = carrierConfig.ivrHints.join(' | ') + learnedNotes;

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
      await deferQueueEntry(prisma, next.id, DEFER_DISPATCH_FAILURE_MS);
      continue;
    }

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
