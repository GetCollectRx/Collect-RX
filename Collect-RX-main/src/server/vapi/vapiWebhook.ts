/**
 * P4-05 — Vapi server URL webhook: shared secret (X-Vapi-Secret or Bearer) + idempotent body hash.
 *
 * CRITICAL: `call.ended` events drive the entire claims recovery loop via claim router +
 * recovery actions, sync verification, and CDCP branching.
 */

import { createHash } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import type { VapiWebhookPayload } from '../../vapi/client';
import { resolveOutcomeFromWebhookPayload, extractStructuredClaimStatus } from '../../outcome/webhookOutcomeResolver';
import {
  applyRecoveryAfterCall,
  emitRecoveryTerminalEmrEvent,
  resolveGatedClaimStatus,
} from '../recovery/recoveryLoopService.js';
import {
  linkRecoveryActionToCdcpCase,
  tryCdcpFromVapiPayload,
} from '../recovery/cdcpRecoveryBridge.js';

function hashBody(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function hashWebhookBody(buf: Buffer): string {
  return hashBody(buf);
}

export async function isWebhookDuplicate(
  prisma: PrismaClient,
  bodyHash: string,
): Promise<boolean> {
  const existing = await prisma.processedVapiWebhook.findUnique({ where: { bodyHash } });
  return Boolean(existing);
}

export async function markWebhookProcessed(prisma: PrismaClient, bodyHash: string): Promise<void> {
  await prisma.processedVapiWebhook.create({ data: { bodyHash } });
}

function verifyVapiAuth(req: Request): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }
  const x = req.get('x-vapi-secret') || req.get('X-Vapi-Secret');
  if (x && x === secret) return true;
  const auth = req.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m?.[1] && m[1] === secret) return true;
  return false;
}

function responseForVapiMessage(body: unknown): Record<string, unknown> {
  const b = body as { message?: { type?: string; toolWithToolCallList?: Array<{ name: string; toolCall?: { id?: string } }> } };
  const type = b?.message?.type;
  if (type === 'assistant-request' && process.env.VAPI_DEFAULT_ASSISTANT_ID) {
    return { assistantId: process.env.VAPI_DEFAULT_ASSISTANT_ID };
  }
  if (type === 'tool-calls' && b.message?.toolWithToolCallList?.length) {
    return {
      results: b.message.toolWithToolCallList.map((t) => ({
        name: t.name,
        toolCallId: t.toolCall?.id,
        result: JSON.stringify({ ok: false, error: 'No tool handlers configured.' }),
      })),
    };
  }
  return {};
}

async function fireCarrierBlockProtocol(
  prisma: PrismaClient,
  practiceId: string,
  carrierId: string,
): Promise<void> {
  console.error(
    `[CARRIER_BLOCK] 🚨 Block detected — carrier=${carrierId} practice=${practiceId} ` +
    `Suspending ALL calls to this carrier immediately.`,
  );

  await prisma.carrierBlockEvent.create({
    data: { practiceId, carrierId: carrierId as import('@prisma/client').CarrierId },
  });

  const affectedClaims = await prisma.insuranceClaim.findMany({
    where: { practiceId, carrierId: carrierId as import('@prisma/client').CarrierId, status: { in: ['CALLING', 'IN_QUEUE', 'PENDING'] } },
    select: { id: true },
  });

  if (affectedClaims.length > 0) {
    const claimIds = affectedClaims.map((c) => c.id);
    await prisma.$transaction([
      prisma.insuranceClaim.updateMany({
        where: { id: { in: claimIds } },
        data: { status: 'BLOCKED', recoveryRoute: 'STOP' },
      }),
      prisma.callQueue.updateMany({
        where: { claimId: { in: claimIds } },
        data: { status: 'BLOCKED' },
      }),
    ]);
    console.error(`[CARRIER_BLOCK] Blocked ${claimIds.length} claims/queue entries for carrier=${carrierId}`);
  }
}

async function processCallEnded(
  payload: VapiWebhookPayload,
  prisma: PrismaClient,
  rawBody?: unknown,
): Promise<void> {
  const vapiCallId = payload.call.id;
  if (!vapiCallId) {
    console.error('[vapi-webhook] call.ended missing call.id — cannot process outcome');
    return;
  }

  const attempt = await prisma.callAttempt.findUnique({
    where: { vapiCallId },
    include: {
      claim: {
        select: {
          id: true,
          practiceId: true,
          carrierId: true,
          claimNumber: true,
          outstandingAmount: true,
          daysOutstanding: true,
          status: true,
          patientToken: true,
        },
      },
    },
  });

  if (!attempt) {
    console.warn(`[vapi-webhook] No CallAttempt found for vapiCallId=${vapiCallId} — logging raw outcome`);
    return;
  }

  const recoveryApplied = await prisma.claimRecoveryEvent.findFirst({
    where: {
      claimId: attempt.claim.id,
      eventType: 'ROUTE_ASSIGNED',
      metadata: { path: ['callAttemptId'], equals: attempt.id },
    },
    select: { id: true },
  });

  if (attempt.completedAt && attempt.outcome && recoveryApplied) {
    console.log(
      `[vapi-webhook] call already processed: vapiCallId=${vapiCallId} outcome=${attempt.outcome}`,
    );
    return;
  }

  if (attempt.completedAt && attempt.outcome && !recoveryApplied) {
    console.warn(
      `[vapi-webhook] Re-running recovery for vapiCallId=${vapiCallId} — call marked complete but ROUTE_ASSIGNED missing`,
    );
  }

  const { claim } = attempt;
  const processed = resolveOutcomeFromWebhookPayload(payload);
  const structuredStatus = extractStructuredClaimStatus(payload);
  const outstandingCents = Math.round(Number(claim.outstandingAmount) * 100);
  const { proposedClaimStatus, gatedClaimStatus, paymentCorroborated } = resolveGatedClaimStatus(
    processed,
    structuredStatus,
    outstandingCents,
  );

  if (
    gatedClaimStatus === 'ESCALATED' &&
    proposedClaimStatus !== 'ESCALATED' &&
    ['RESOLVED', 'DENIED', 'APPROVED_PENDING_PAYMENT'].includes(proposedClaimStatus)
  ) {
    console.warn(
      `[vapi-webhook] Held unconfirmed financial outcome: claimId=${claim.id} ` +
      `proposed=${proposedClaimStatus} → ESCALATED`,
    );
    try {
      const { createEscalation } = await import('../services/escalationService.js');
      await createEscalation(prisma, {
        practiceId: claim.practiceId,
        claimId: claim.id,
        claimRef: claim.claimNumber,
        carrierId: claim.carrierId,
        amountClaimedCents: outstandingCents,
        reason:
          `Outcome "${proposedClaimStatus}" inferred without structured carrier confirmation and no reference number.`,
        callAttemptId: attempt.id,
      });
    } catch (escErr) {
      console.error('[vapi-webhook] escalation create failed (non-fatal):', escErr);
    }
  }

  if (processed.carrierBlockDetected) {
    await fireCarrierBlockProtocol(prisma, claim.practiceId, claim.carrierId);
  }

  const completedAt = payload.call.endedAt ? new Date(payload.call.endedAt) : new Date();

  if (!attempt.completedAt || !attempt.outcome) {
    await prisma.callAttempt.update({
      where: { id: attempt.id },
      data: {
        completedAt,
        durationSeconds: processed.durationSeconds,
        outcome: processed.outcome,
        outcomeDetail: processed.outcomeDetail,
        repName: processed.repName,
        referenceNumber: processed.referenceNumber,
        transcriptUrl: processed.transcriptUrl,
        carrierBlockDetected: processed.carrierBlockDetected,
      },
    });
  }

  const decision = await applyRecoveryAfterCall(prisma, {
    claim,
    attemptId: attempt.id,
    processed,
    structuredClaimStatus: structuredStatus,
    gatedClaimStatus,
    proposedClaimStatus,
    paymentCorroborated,
    completedAt,
  });

  try {
    const cdcpHit = await tryCdcpFromVapiPayload(prisma, rawBody ?? payload);
    if (cdcpHit) {
      await linkRecoveryActionToCdcpCase(prisma, claim.id, cdcpHit.caseId);
    }
  } catch (cdcpErr) {
    console.error('[vapi-webhook] CDCP structured signal (non-fatal):', cdcpErr);
  }

  await emitRecoveryTerminalEmrEvent(prisma, claim, decision.claimStatus, processed);

  console.log(
    `[vapi-webhook] call.ended processed: vapiCallId=${vapiCallId} ` +
    `claimId=${claim.id} outcome=${processed.outcome} route=${decision.route} ` +
    `claimStatus=${decision.claimStatus} recall=${decision.scheduledRecallAt?.toISOString() ?? 'none'}`,
  );
}

/** Recovery-aware call.ended handler — used by production webhook and tests. */
export async function processRecoveryCallEnded(
  payload: VapiWebhookPayload,
  prisma: PrismaClient,
  rawBody?: unknown,
): Promise<void> {
  return processCallEnded(payload, prisma, rawBody);
}

export async function handleVapiWebhook(
  req: Request & { vapiRawBody?: Buffer },
  res: Response,
  prisma: PrismaClient,
): Promise<void> {
  if (!verifyVapiAuth(req)) {
    res.status(401).json({ error: 'Invalid or missing Vapi authentication' });
    return;
  }

  const buf = req.vapiRawBody;
  if (!buf || !Buffer.isBuffer(buf)) {
    res.status(400).json({ error: 'Missing raw body' });
    return;
  }

  const bodyHash = hashBody(buf);
  const payload = req.body as VapiWebhookPayload;

  const existing = await prisma.processedVapiWebhook.findUnique({ where: { bodyHash } });
  if (existing) {
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  if (payload.type === 'call.ended' || payload.type === 'call.failed') {
    try {
      await processCallEnded(payload, prisma, req.body);
      await prisma.processedVapiWebhook.create({ data: { bodyHash } });
    } catch (err) {
      console.error('[vapi-webhook] processCallEnded failed:', err);
      res.status(500).json({ error: 'Call processing failed' });
      return;
    }
  } else {
    await prisma.processedVapiWebhook.create({ data: { bodyHash } });
  }

  const out = responseForVapiMessage(payload);
  res.status(200).json(out);
}
