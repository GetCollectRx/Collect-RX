import type { PrismaClient, CarrierId } from '@prisma/client'
import type { VapiWebhookPayload } from '../../vapi/client.js';
import { resolveOutcomeFromWebhookPayload } from '../../outcome/webhookOutcomeResolver.js';
import { recordVapiWebhook } from '../observability/metrics.js';
import { broadcastDesk } from './deskWs.js';
import { mapActiveCall, mapTranscriptLine } from './deskMappers.js';
import {
  matchedCarrierBlockPhrase,
  transcriptSignalsCarrierBlock,
} from './carrierBlockPhrases.js';
import { applyCarrierBlock } from './carrierBlockService.js';
import { refreshDeskQueueBroadcast } from './deskQueueBroadcast.js';
import type { ActiveAgent, LiveCallState } from '../../types/frontDesk.js';
import { recordCallUsage } from '../plans/planBridge.js';
import { maybeSendPlanUsageAlertEmails } from '../plans/planUsageAlertService.js';
import { processRecoveryCallEnded, scrubTranscriptPhi } from '../vapi/vapiWebhook.js';
import { processPreVisitCallEnded } from '../preVisit/preVisitWebhook.js';
import { appendAuditLog } from '../audit/auditLog.js';
import { logger } from '../observability/logger.js';

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
  ctx?: { rawBody?: unknown },
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
      await appendAuditLog(prisma, {
        practiceId: claim.practiceId,
        action: 'ADAD_DISCLOSURE_SCHEDULED',
        subjectType: 'CallAttempt',
        subjectId: attempt.id,
        details: { vapiCallId },
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

    // PHI SCRUB: apply before persisting — live utterances may contain policy
    // numbers, DOBs, or patient names spoken aloud by the carrier IVR or rep.
    // scrubTranscriptPhi mirrors the same patterns used on the end-of-call
    // consolidated transcript in processCallEnded (vapiWebhook.ts).
    const scrubbedText = scrubTranscriptPhi(payload.transcript);
    const line = await prisma.callTranscriptLine.create({
      data: {
        practiceId: attempt.claim.practiceId,
        vapiCallId,
        speaker: 'carrier',
        text: scrubbedText,
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
    await processCallEndedDesk(prisma, payload, vapiCallId, ctx);
  }
}

async function processCallEndedDesk(
  prisma: PrismaClient,
  payload: VapiWebhookPayload,
  vapiCallId: string,
  ctx?: { rawBody?: unknown },
): Promise<void> {
  const existing = await prisma.callAttempt.findUnique({
    where: { vapiCallId },
    select: { id: true, completedAt: true, claimId: true },
  });

  if (existing?.completedAt) {
    recordVapiWebhook('duplicate');
    return;
  }

  const metadata = payload.metadata;
  if (metadata?.appointmentVerificationId) {
    recordVapiWebhook('call_ended');
    await processPreVisitCallEnded(payload, prisma);
    return;
  }

  if (!metadata?.claimId) {
    logger.error('[vapi-webhook] No claimId for call', { vapiCallId });
    return;
  }

  const claim = await prisma.insuranceClaim.findUnique({
    where: { id: metadata.claimId },
    select: { practiceId: true, id: true, carrierId: true },
  });
  if (!claim) return;

  recordVapiWebhook('call_ended');

  const processed = resolveOutcomeFromWebhookPayload(payload);

  if (processed.carrierBlockDetected) {
    // H-3: complete the callAttempt row BEFORE applying the carrier block.
    // Without this, the attempt is left with completedAt = null, which causes
    // the queue engine's activeAttempt check to block ALL dispatch for this
    // practice forever — even after the carrier block is cleared.
    if (existing?.id) {
      await prisma.callAttempt.update({
        where: { id: existing.id },
        data: {
          completedAt: new Date(),
          outcome: 'BLOCK_DETECTED',
          outcomeDetail: processed.outcomeDetail ?? 'Carrier block detected at call end',
          carrierBlockDetected: true,
        },
      }).catch((err: unknown) => {
        logger.error('[vapi-webhook] failed to complete callAttempt on carrier block', { error: err });
      });
    }
    await applyCarrierBlock(prisma, {
      practiceId: claim.practiceId,
      carrierId: claim.carrierId as CarrierId,
      vapiCallId,
      reason: processed.outcomeDetail,
      hangVapi: false,
    });
    return;
  }

  await processRecoveryCallEnded(payload, prisma, ctx?.rawBody ?? payload);

  const attemptAfter = await prisma.callAttempt.findUnique({
    where: { vapiCallId },
    select: { id: true, outcome: true },
  });

  // H-5a: CRTC ADAD — always write a resolution log entry, even when there is
  // no transcript. ADAD_DISCLOSURE_SCHEDULED was written at call.started;
  // leaving it unresolved gives a false picture in compliance audits.
  {
    const subjectId = attemptAfter?.id ?? existing?.id ?? vapiCallId;
    if (payload.transcript) {
      // Check the opening utterance (first ~300 chars ≈ 20 seconds of speech).
      // Match the actual disclosure message phrases from client.ts
      // disclosure_message — use multi-phrase match to avoid false positives
      // (e.g. carrier saying "this call appears to be automated" should NOT verify).
      // Require 'automated calling' or 'automated calling system' — the canonical phrase.
      const opening = payload.transcript.slice(0, 300).toLowerCase();
      const disclosureVerified =
        opening.includes('automated calling system') ||
        opening.includes('automated calling') ||
        opening.includes('computer-generated system');
      await appendAuditLog(prisma, {
        practiceId: claim.practiceId,
        action: disclosureVerified ? 'ADAD_DISCLOSURE_VERIFIED' : 'ADAD_DISCLOSURE_UNVERIFIED',
        subjectType: 'CallAttempt',
        subjectId,
        details: { vapiCallId, verified: disclosureVerified },
      });
    } else {
      // No transcript — call was too short or transcript not available.
      // Log as unverified so the compliance record is complete.
      await appendAuditLog(prisma, {
        practiceId: claim.practiceId,
        action: 'ADAD_DISCLOSURE_UNVERIFIED',
        subjectType: 'CallAttempt',
        subjectId,
        details: { vapiCallId, verified: false, reason: 'no_transcript' },
      });
    }
  }

  broadcastDesk(claim.practiceId, {
    type: 'call.ended',
    data: {
      callId: attemptAfter?.id ?? existing?.id ?? vapiCallId,
      outcome: processed.outcome,
      notes: processed.outcomeDetail,
    },
  });

  try {
    const usageResult = await recordCallUsage({ practiceId: claim.practiceId, vapiCallId });
    if (usageResult.recorded) {
      await maybeSendPlanUsageAlertEmails(prisma, claim.practiceId);
    }
  } catch (usageErr) {
    logger.error('[vapi-webhook] usage recording failed (non-fatal)', { error: usageErr });
  }

  await refreshDeskQueueBroadcast(prisma, claim.practiceId);
}
