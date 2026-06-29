import type { PrismaClient } from '@prisma/client';
import { validateDispatch, CARRIER_CONFIGS, isWithinCallWindow } from '../../carriers/adapter.js'
import { initiateCall, endVapiCall, type VapiCallParams } from '../../vapi/client.js';
import { refreshDeskQueueBroadcast } from './deskQueueBroadcast.js';
import { broadcastDesk } from './deskWs.js';
import { mapActiveCall } from './deskMappers.js';
import { canMakeCall } from '../plans/planBridge.js';
import { getPracticeSettings } from '../services/practiceSettingsService.js';
import { piiVault } from '../../pii-vault.js';
import { checkPatientDataCompleteness } from './patientDataCompleteness.js';
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

async function runDeskQueueTick(prisma: PrismaClient): Promise<void> {
  if (!isWithinCallWindow()) return;

  const practices = await prisma.practice.findMany({ select: { id: true } });

  for (const { id: practiceId } of practices) {
    if (await isPracticeQueuePaused(prisma, practiceId)) continue;

    const inProgress = await prisma.callQueue.count({
      where: { practiceId, status: 'IN_PROGRESS' },
    });
    if (inProgress > 0) continue;

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
    if (activeAttempt) continue;

    const next = await prisma.callQueue.findFirst({
      where: {
        practiceId,
        status: 'PENDING',
        scheduledFor: { lte: new Date() },
      },
      orderBy: [{ priority: 'desc' }, { scheduledFor: 'asc' }],
      include: {
        claim: true,
      },
    });

    if (!next) continue;

    const planGate = await canMakeCall(practiceId);
    if (!planGate.allowed) {
      console.warn('[deskQueueEngine] plan gate blocked dispatch', {
        practiceId,
        reason: planGate.reason,
      });
      continue;
    }

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
      if (next.claim.daysOutstanding > 90) {
        await prisma.insuranceClaim.update({
          where: { id: next.claimId },
          data: { status: 'ESCALATED' },
        });
        await prisma.callQueue.update({
          where: { id: next.id },
          data: { status: 'ESCALATED' },
        });
      }
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
    // If the token has expired (e.g. server restart) we skip this claim and
    // log the error so a re-tokenization pass can recover it.
    const phiResult = piiVault.detokenize(
      next.claim.patientToken,
      'queue-engine',
    );
    if (!phiResult.success || !phiResult.phi) {
      logger.warn('[deskQueueEngine] PHI token expired or missing — skipping claim', {
        claimId: next.claimId,
        patientToken: next.claim.patientToken,
        error: phiResult.error,
      });
      continue;
    }
    (logger as any).audit?.('PHI_TOKEN_RESOLVED', {
      claimId: next.claimId,
      patientToken: next.claim.patientToken,
      callerContext: 'queue-engine',
      phiBoundary: 'PHI_IN_EPHEMERAL_CALL_VARIABLES_ONLY',
    });

    // ── PHI COMPLETENESS GUARD ─────────────────────────────────────────────────
    // Carriers require patientName, dateOfBirth, and subscriberId at minimum.
    // Missing any of these causes the agent to fail authentication immediately.
    // Skip the claim now; staff can correct the data and the next tick will retry.
    const completeness = checkPatientDataCompleteness(phiResult.phi);
    if (!completeness.ok) {
      logger.warn('[deskQueueEngine] patient PHI incomplete — skipping dispatch', {
        claimId: next.claimId,
        patientToken: next.claim.patientToken,
        missing: completeness.missing,
      });
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

    // Build IVR instructions from carrier adapter knowledge base.
    const carrierIvrInstructions = carrierConfig.ivrHints.join(' | ');

    const callParams: VapiCallParams = {
      claimId: next.claim.id,
      carrierId: next.claim.carrierId,
      patientToken: next.claim.patientToken,
      // ── PHI — resolved from piiVault.detokenize() above; ephemeral, never stored ──
      patientName:            phiResult.phi.patientName,
      patientDob:             phiResult.phi.dateOfBirth,
      policyNumber:           phiResult.phi.subscriberId,
      groupNumber:            phiResult.phi.groupPolicyNumber,
      subscriberName:         phiResult.phi.subscriberName,
      subscriberDob:          phiResult.phi.subscriberDateOfBirth,
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
    const vapiResult = await initiateCall(callParams);

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
  }
}
