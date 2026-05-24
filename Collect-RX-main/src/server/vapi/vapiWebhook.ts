/**
 * P4-05 — Vapi server URL webhook: shared secret (X-Vapi-Secret or Bearer) + idempotent body hash.
 *
 * CRITICAL: `call.ended` events drive the entire claims outcome loop. This handler:
 *   1. Classifies the call outcome (RESOLVED / ESCALATED / DENIED / BLOCK_DETECTED / etc.)
 *   2. Updates CallAttempt with outcome, duration, rep name, reference, transcript URL
 *   3. Updates InsuranceClaim.status based on outcome
 *   4. Updates CallQueue.status
 *   5. If BLOCK_DETECTED → fires CARRIER_BLOCK protocol (suspends ALL calls to that carrier)
 *
 * Without this handler processing outcomes, all claims stay `CALLING` indefinitely.
 */

import { createHash } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import type { VapiWebhookPayload } from '../../vapi/client';
import { resolveOutcomeFromWebhookPayload, extractStructuredClaimStatus } from '../../outcome/webhookOutcomeResolver';
import { enqueueEmrClaimEvent } from '../emrSyncOutbox.js';

function hashBody(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
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

/**
 * Fire the CARRIER_BLOCK protocol:
 *  1. Create a CarrierBlockEvent record
 *  2. Mark all PENDING/IN_PROGRESS queue entries for that carrier as BLOCKED
 *  3. Mark all CALLING claims for that carrier as BLOCKED
 *
 * This is intentionally aggressive — it is safer to over-block than to keep calling.
 */
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

  // Block all pending/in-progress queue entries for this carrier's claims
  const affectedClaims = await prisma.insuranceClaim.findMany({
    where: { practiceId, carrierId: carrierId as import('@prisma/client').CarrierId, status: { in: ['CALLING', 'IN_QUEUE', 'PENDING'] } },
    select: { id: true },
  });

  if (affectedClaims.length > 0) {
    const claimIds = affectedClaims.map((c) => c.id);
    await prisma.$transaction([
      prisma.insuranceClaim.updateMany({
        where: { id: { in: claimIds } },
        data: { status: 'BLOCKED' },
      }),
      prisma.callQueue.updateMany({
        where: { claimId: { in: claimIds } },
        data: { status: 'BLOCKED' },
      }),
    ]);
    console.error(`[CARRIER_BLOCK] Blocked ${claimIds.length} claims/queue entries for carrier=${carrierId}`);
  }
}

/**
 * Map call outcome to the appropriate InsuranceClaim status.
 */
function outcomeToClaimStatus(outcome: string): import('@prisma/client').ClaimStatus {
  switch (outcome) {
    case 'RESOLVED':                return 'RESOLVED';
    case 'APPROVED_PENDING_PAYMENT': return 'APPROVED_PENDING_PAYMENT';
    case 'DENIED':                  return 'DENIED';
    case 'ESCALATED':               return 'ESCALATED';
    case 'BLOCK_DETECTED':          return 'BLOCKED';
    case 'FAILED':
    case 'NO_ANSWER':
    case 'HUNG_UP':
    case 'PENDING':
    default:
      return 'IN_QUEUE'; // Back to queue for retry
  }
}

/**
 * Map call outcome to the appropriate CallQueue status.
 */
function outcomeToQueueStatus(outcome: string): import('@prisma/client').QueueStatus {
  switch (outcome) {
    case 'RESOLVED':
    case 'APPROVED_PENDING_PAYMENT':
    case 'DENIED':
      return 'COMPLETED';
    case 'ESCALATED':               return 'ESCALATED';
    case 'BLOCK_DETECTED':          return 'BLOCKED';
    default:
      return 'PENDING'; // Retry
  }
}

async function processCallEnded(
  payload: VapiWebhookPayload,
  prisma: PrismaClient,
): Promise<void> {
  const vapiCallId = payload.call.id;
  if (!vapiCallId) {
    console.error('[vapi-webhook] call.ended missing call.id — cannot process outcome');
    return;
  }

  // Find the CallAttempt by vapiCallId
  const attempt = await prisma.callAttempt.findUnique({
    where: { vapiCallId },
    include: { claim: { select: { id: true, practiceId: true, carrierId: true } } },
  });

  if (!attempt) {
    console.warn(`[vapi-webhook] No CallAttempt found for vapiCallId=${vapiCallId} — logging raw outcome`);
    return;
  }

  const { claim } = attempt;
  const processed = resolveOutcomeFromWebhookPayload(payload);
  const structuredStatus = extractStructuredClaimStatus(payload);

  const newClaimStatus = structuredStatus ?? outcomeToClaimStatus(processed.outcome);
  const newQueueStatus = outcomeToQueueStatus(processed.outcome);

  // CARRIER_BLOCK — fire protocol FIRST before any other DB writes
  if (processed.carrierBlockDetected) {
    await fireCarrierBlockProtocol(prisma, claim.practiceId, claim.carrierId);
    // CallAttempt and claim updates still proceed below (already blocked above)
  }

  // Update the CallAttempt with full outcome data
  await prisma.callAttempt.update({
    where: { id: attempt.id },
    data: {
      completedAt:     payload.call.endedAt ? new Date(payload.call.endedAt) : new Date(),
      durationSeconds: processed.durationSeconds,
      outcome:         processed.outcome,
      outcomeDetail:   processed.outcomeDetail,
      repName:         processed.repName,
      referenceNumber: processed.referenceNumber,
      transcriptUrl:   processed.transcriptUrl,
      carrierBlockDetected: processed.carrierBlockDetected,
    },
  });

  // Update InsuranceClaim + CallQueue atomically
  await prisma.$transaction([
    prisma.insuranceClaim.update({
      where: { id: claim.id },
      data: { status: newClaimStatus },
    }),
    prisma.callQueue.updateMany({
      where: { claimId: claim.id },
      data: {
        status: newQueueStatus,
        lastAttemptAt: new Date(),
      },
    }),
  ]);

  // Emit EMR outbox event for terminal outcomes
  if (['RESOLVED', 'DENIED', 'ESCALATED'].includes(processed.outcome)) {
    try {
      await enqueueEmrClaimEvent(prisma, {
        practiceId: claim.practiceId,
        claimId: claim.id,
        eventType: processed.outcome === 'RESOLVED'
          ? 'PAYMENT_CONFIRMED'
          : 'CLAIM_STATUS_UPDATED',
        payload: {
          outcome: processed.outcome,
          outcomeDetail: processed.outcomeDetail,
          repName: processed.repName,
          referenceNumber: processed.referenceNumber,
          resolvedAt: new Date().toISOString(),
        },
      });
    } catch (e) {
      console.error('[vapi-webhook] EMR outbox enqueue failed (non-fatal):', e);
    }
  }

  console.log(
    `[vapi-webhook] call.ended processed: vapiCallId=${vapiCallId} ` +
    `claimId=${claim.id} outcome=${processed.outcome} claimStatus=${newClaimStatus}`,
  );
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

  // Idempotency — reject duplicate webhooks
  const bodyHash = hashBody(buf);
  try {
    await prisma.processedVapiWebhook.create({ data: { bodyHash } });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'P2002') {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
    throw e;
  }

  const payload = req.body as VapiWebhookPayload;

  // Process call outcomes asynchronously — respond immediately so Vapi doesn't timeout
  if (payload.type === 'call.ended' || payload.type === 'call.failed') {
    processCallEnded(payload, prisma).catch((err) => {
      console.error('[vapi-webhook] processCallEnded failed:', err);
    });
  }

  const out = responseForVapiMessage(payload);
  res.status(200).json(out);
}
