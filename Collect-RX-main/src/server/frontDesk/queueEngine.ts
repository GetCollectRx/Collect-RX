import type { PrismaClient } from '@prisma/client';
import { validateDispatch, CARRIER_CONFIGS, isWithinCallWindow } from '../../carriers/adapter.js'
import { initiateCall } from '../../vapi/client.js';
import { refreshDeskQueueBroadcast } from './deskQueueBroadcast.js';
import { broadcastDesk } from './deskWs.js';
import { mapActiveCall } from './deskMappers.js';
import { canMakeCall } from '../plans/planBridge.js';
import { getPracticeSettings } from '../services/practiceSettingsService.js';
import { piiVault } from '../../pii-vault.js';
import logger from '../../logger.js';

let tickTimer: ReturnType<typeof setInterval> | null = null;

export function startDeskQueueEngine(prisma: PrismaClient): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    void runDeskQueueTick(prisma).catch((err) => {
      console.error('[deskQueueEngine] tick error:', err);
    });
  }, 60_000);
  void runDeskQueueTick(prisma).catch((err) => {
    console.error('[deskQueueEngine] initial tick error:', err);
  });
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
      select: { name: true },
    });
    const practiceSettings = await getPracticeSettings(prisma, practiceId);
    const practiceCarrierConfig = practiceSettings.carrierConfigs.find(
      (c) => c.carrierId === next.claim.carrierId,
    );
    if (!practiceCarrierConfig?.authorizationSubmitted) {
      console.warn('[deskQueueEngine] dispatching without carrier authorization on file', {
        practiceId,
        carrierId: next.claim.carrierId,
        claimId: next.claimId,
      });
    }

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
    logger.audit?.('PHI_TOKEN_RESOLVED', {
      claimId: next.claimId,
      patientToken: next.claim.patientToken,
      callerContext: 'queue-engine',
      phiBoundary: 'PHI_IN_EPHEMERAL_CALL_VARIABLES_ONLY',
    });

    const vapiResult = await initiateCall({
      claimId: next.claim.id,
      carrierId: next.claim.carrierId,
      patientToken: next.claim.patientToken,
      // PHI — resolved from piiVault.detokenize() above; ephemeral, never stored
      patientName:  phiResult.phi.patientName,
      patientDob:   phiResult.phi.dateOfBirth,
      policyNumber: phiResult.phi.subscriberId,     // member/certificate ID
      groupNumber:  phiResult.phi.groupPolicyNumber, // group/plan ID
      carrierPhone: carrierConfig.phone,
      claimNumber: next.claim.claimNumber,
      billedAmount: Number(next.claim.billedAmount),
      outstandingAmount: Number(next.claim.outstandingAmount),
      daysOutstanding: next.claim.daysOutstanding,
      treatmentDate: next.claim.servicedAt?.toISOString().split('T')[0],
      practiceId,
      practiceName: practice?.name ?? '',
      providerNumber: practiceCarrierConfig?.providerNumber ?? '',
      practicePhone: practiceSettings.escalationPhoneNumber,
      // TODO: add Practice.npi, Practice.taxId to schema
      // TODO: add InsuranceClaim.treatmentCodes, InsuranceClaim.submittedAt to schema
    });

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
  }
}
