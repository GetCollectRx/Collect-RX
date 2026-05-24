import type { PrismaClient } from '@prisma/client';
import type { VapiWebhookPayload } from '../../vapi/client.js';
import { resolveOutcomeFromWebhookPayload } from '../../outcome/webhookOutcomeResolver.js';
import { recordVapiWebhook } from '../observability/metrics.js';
import { enqueueEmrClaimEvent } from '../emrSyncOutbox.js';
import { claimStatusFromCallOutcome } from '../claimStatusFromCallOutcome.js';
import type { CarrierId } from '@prisma/client';
import { broadcastDesk } from './deskWs.js';
import { mapActiveCall, mapTranscriptLine } from './deskMappers.js';
import {
  matchedCarrierBlockPhrase,
  transcriptSignalsCarrierBlock,
} from './carrierBlockPhrases.js';
import { applyCarrierBlock } from './carrierBlockService.js';
import { refreshDeskQueueBroadcast } from './deskQueueBroadcast.js';
import type { ActiveAgent, LiveCallState } from '../../types/frontDesk.js';
import { extractStructuredClaimStatus } from '../../outcome/webhookOutcomeResolver.js';

type PayloadWithTools = VapiWebhookPayload & {
  message?: { toolCalls?: Array<{ function?: { name?: string } }> };
  functionCall?: { name?: string };
};

function agentFromPayload(payload: VapiWebhookPayload): ActiveAgent | null {
  const p = payload as PayloadWithTools;
  const name = p.message?.toolCalls?.[0]?.function?.name ?? p.functionCall?.name;
  if (!name) return null;
  if (name.includes('IVR') || name.includes('Navigator')) return 'IVR_Navigator';
  if (name.includes('Claims')) return 'Claims_Agent';
  if (name.includes('Escalation')) return 'Escalation_Closer';
  if (name.includes('Resolution')) return 'Resolution_Closer';
  return null;
}

export async function processVapiDeskWebhook(
  prisma: PrismaClient,
  payload: VapiWebhookPayload,
): Promise<void> {
  const vapiCallId = payload.call?.id;
  if (!vapiCallId) return;

  const eventType = payload.type;

  if (eventType === 'call.started' || (eventType === 'status-update' && payload.call?.status === 'in-progress')) {
    const metadata = payload.metadata;
    if (!metadata?.claimId) return;

    const claim = await prisma.insuranceClaim.findUnique({
      where: { id: metadata.claimId },
    });
    if (!claim) return;

    const existing = await prisma.callAttempt.findUnique({ where: { vapiCallId } });
    const attempt =
      existing ??
      (await prisma.callAttempt.create({
        data: {
          claimId: claim.id,
          vapiCallId,
          initiatedAt: payload.call.startedAt ? new Date(payload.call.startedAt) : new Date(),
          liveState: 'dialing',
          activeAgent: 'IVR_Navigator',
        },
      }));

    if (!existing) {
      const queue = await prisma.callQueue.findUnique({ where: { claimId: claim.id } });
      broadcastDesk(claim.practiceId, {
        type: 'call.started',
        data: {
          call: mapActiveCall(attempt, claim, (queue?.attempts ?? 0) || 1),
        },
      });
    }
    return;
  }

  if (eventType === 'transcript' && payload.transcript) {
    const attempt = await prisma.callAttempt.findUnique({
      where: { vapiCallId },
      include: { claim: true },
    });
    if (!attempt) return;

    const line = await prisma.callTranscriptLine.create({
      data: {
        practiceId: attempt.claim.practiceId,
        vapiCallId,
        speaker: 'carrier',
        text: payload.transcript,
      },
    });

    broadcastDesk(attempt.claim.practiceId, {
      type: 'transcript.line',
      data: mapTranscriptLine(line, attempt.id),
    });

    if (transcriptSignalsCarrierBlock(payload.transcript)) {
      const phrase = matchedCarrierBlockPhrase(payload.transcript) ?? payload.transcript.slice(0, 120);
      await applyCarrierBlock(prisma, {
        practiceId: attempt.claim.practiceId,
        carrierId: attempt.claim.carrierId,
        vapiCallId,
        reason: `Transcript signal: "${phrase}"`,
      });
    }
    return;
  }

  if (eventType === 'status-update' || (payload as { type: string }).type === 'function-call') {
    const attempt = await prisma.callAttempt.findUnique({
      where: { vapiCallId },
      include: { claim: true },
    });
    if (!attempt || attempt.completedAt) return;

    const agent = agentFromPayload(payload);
    const liveState: LiveCallState =
      agent === 'IVR_Navigator'
        ? 'ivr_navigation'
        : agent === 'Claims_Agent'
          ? 'rep_connected'
          : agent === 'Escalation_Closer'
            ? 'escalating'
            : agent === 'Resolution_Closer'
              ? 'resolving'
              : (attempt.liveState as LiveCallState) ?? 'dialing';

    await prisma.callAttempt.update({
      where: { id: attempt.id },
      data: {
        activeAgent: agent ?? attempt.activeAgent,
        liveState,
      },
    });

    broadcastDesk(attempt.claim.practiceId, {
      type: 'call.state_changed',
      data: {
        callId: attempt.id,
        state: liveState,
        activeAgent: (agent ?? attempt.activeAgent) as ActiveAgent | null,
      },
    });
    return;
  }

  if (
    eventType === 'call.ended' ||
    eventType === 'call.failed' ||
    (payload as { type: string }).type === 'hang'
  ) {
    await processCallEnded(prisma, payload, vapiCallId);
  }
}

async function processCallEnded(
  prisma: PrismaClient,
  payload: VapiWebhookPayload,
  vapiCallId: string,
): Promise<void> {
  const existing = await prisma.callAttempt.findUnique({
    where: { vapiCallId },
    select: { id: true, completedAt: true },
  });

  if (existing?.completedAt) {
    recordVapiWebhook('duplicate');
    return;
  }

  const metadata = payload.metadata;
  if (!metadata?.claimId) {
    console.error(`[vapi-webhook] No claimId for call ${vapiCallId}`);
    return;
  }

  const claim = await prisma.insuranceClaim.findUnique({
    where: { id: metadata.claimId },
    select: {
      claimNumber: true,
      id: true,
      practiceId: true,
      carrierId: true,
      patientToken: true,
      status: true,
      outstandingAmount: true,
    },
  });

  if (!claim) return;

  recordVapiWebhook('call_ended');

  const processed = resolveOutcomeFromWebhookPayload(payload);
  const structuredClaimStatus = extractStructuredClaimStatus(payload);

  if (processed.carrierBlockDetected) {
    await applyCarrierBlock(prisma, {
      practiceId: claim.practiceId,
      carrierId: claim.carrierId as CarrierId,
      vapiCallId,
      reason: processed.outcomeDetail,
      hangVapi: false,
    });
    return;
  }

  try {
    if (existing) {
      await prisma.callAttempt.update({
        where: { vapiCallId },
        data: {
          completedAt: payload.call.endedAt ? new Date(payload.call.endedAt) : new Date(),
          durationSeconds: processed.durationSeconds,
          outcome: processed.outcome,
          outcomeDetail: processed.outcomeDetail,
          repName: processed.repName,
          referenceNumber: processed.referenceNumber,
          transcriptUrl: processed.transcriptUrl,
          carrierBlockDetected: false,
          liveState: 'completed',
        },
      });
    } else {
      await prisma.callAttempt.create({
        data: {
          claimId: claim.id,
          vapiCallId,
          initiatedAt: payload.call.startedAt ? new Date(payload.call.startedAt) : new Date(),
          completedAt: payload.call.endedAt ? new Date(payload.call.endedAt) : new Date(),
          durationSeconds: processed.durationSeconds,
          outcome: processed.outcome,
          outcomeDetail: processed.outcomeDetail,
          repName: processed.repName,
          referenceNumber: processed.referenceNumber,
          transcriptUrl: processed.transcriptUrl,
          carrierBlockDetected: false,
          liveState: 'completed',
        },
      });
    }
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') return;
    throw err;
  }

  const outstandingCents = Math.round(Number(claim.outstandingAmount) * 100);
  const newClaimStatus = claimStatusFromCallOutcome(
    processed.outcome,
    processed.outcomeDetail,
    outstandingCents,
    structuredClaimStatus,
  );

  const newQueueStatus =
    newClaimStatus === 'RESOLVED' ||
    newClaimStatus === 'DENIED' ||
    newClaimStatus === 'APPROVED_PENDING_PAYMENT'
      ? 'COMPLETED'
      : newClaimStatus === 'ESCALATED' || processed.outcome === 'ESCALATED'
        ? 'ESCALATED'
        : 'PENDING';

  await prisma.callQueue.updateMany({
    where: { claimId: claim.id },
    data: { status: newQueueStatus, lastAttemptAt: new Date() },
  });

  await prisma.insuranceClaim.update({
    where: { id: claim.id },
    data: { status: newClaimStatus },
  });

  if (processed.outcome) {
    const attemptCount = await prisma.callAttempt.count({ where: { claimId: claim.id } });
    const { shouldAutoEscalate } = await import('../services/outcomeClassifier.js');
    const { createEscalation } = await import('../services/escalationService.js');
    if (shouldAutoEscalate(processed.outcome, attemptCount)) {
      try {
        await createEscalation(prisma, {
          practiceId: claim.practiceId,
          claimId: claim.id,
          claimRef: claim.claimNumber,
          carrierId: claim.carrierId,
          amountClaimedCents: outstandingCents,
          reason: processed.outcomeDetail ?? `Auto-escalation after ${processed.outcome}`,
          callAttemptId: existing?.id,
          attemptNumber: attemptCount,
        });
      } catch (escErr) {
        console.error('[vapi-webhook] escalation create failed:', escErr);
      }
    }
  }

  broadcastDesk(claim.practiceId, {
    type: 'call.ended',
    data: {
      callId: existing?.id ?? vapiCallId,
      outcome: processed.outcome,
      notes: processed.outcomeDetail,
    },
  });

  await refreshDeskQueueBroadcast(prisma, claim.practiceId);

  if (newClaimStatus === 'RESOLVED') {
    try {
      await enqueueEmrClaimEvent(prisma, {
        practiceId: claim.practiceId,
        claimId: claim.id,
        eventType: 'CLAIM_RESOLVED',
        payload: {
          vapiCallId,
          resolvedAt: new Date().toISOString(),
          outcomeDetail: processed.outcomeDetail,
        },
      });
    } catch (emrErr) {
      console.error('[vapi-webhook] EMR outbox enqueue failed:', emrErr);
    }
  }
}
