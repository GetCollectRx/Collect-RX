// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Vapi Webhook Handler
// POST /api/webhooks/vapi
//
// Security: HMAC-SHA256 signature validated on every request using
// VAPI_WEBHOOK_SECRET before any processing occurs.
//
// Idempotency: vapiCallId is unique in call_attempts — duplicate webhook
// deliveries are silently dropped (returns 200 immediately).
//
// CARRIER_BLOCK protocol: if outcome processor returns carrierBlockDetected,
// this handler MUST write a CarrierBlockEvent AND suspend all calls to that
// carrier for the practice immediately. This is the highest-risk path.
//
// PHI boundary: patientToken is the only patient identifier in the DB.
// piiVault.detokenize() is called ONLY if downstream practice systems need
// the real patientId — the result is NEVER persisted back into call tables.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '../lib/prisma';
import { piiVault } from '../services/pii-vault';
import { classifyOutcome } from '../outcome/processor';
import { sendCarrierBlockAlert } from '../services/alerts';
import type { VapiWebhookPayload } from '../vapi/client';
import type { CarrierId } from '@prisma/client';

const router = Router();

// ---------------------------------------------------------------------------
// HMAC signature validation
// ---------------------------------------------------------------------------

/**
 * Validate the Vapi webhook HMAC-SHA256 signature.
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * Vapi sends the signature in the `x-vapi-signature` header as
 * `sha256=<hex-digest>`.
 */
function validateSignature(rawBody: Buffer, signature: string): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[vapi-webhook] VAPI_WEBHOOK_SECRET not set — rejecting all webhooks');
    return false;
  }

  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Webhook handler
// ---------------------------------------------------------------------------

router.post('/', async (req: Request, res: Response) => {
  // ── 1. Signature validation ──────────────────────────────────────────────
  const signature = req.headers['x-vapi-signature'] as string | undefined;
  if (!signature) {
    console.warn('[vapi-webhook] Missing x-vapi-signature header');
    return res.status(401).json({ error: 'Missing signature' });
  }

  const rawBody = req.body as Buffer;  // Raw body provided by express.raw()
  if (!Buffer.isBuffer(rawBody)) {
    console.error('[vapi-webhook] Expected raw Buffer body — check middleware order');
    return res.status(400).json({ error: 'Invalid body format' });
  }

  if (!validateSignature(rawBody, signature)) {
    console.warn('[vapi-webhook] HMAC signature mismatch — rejecting request');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // ── 2. Parse payload ─────────────────────────────────────────────────────
  let payload: VapiWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString('utf-8')) as VapiWebhookPayload;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  // Acknowledge immediately — Vapi expects a fast 200
  res.status(200).json({ received: true });

  // ── 3. Only process call.ended events ────────────────────────────────────
  if (payload.type !== 'call.ended') {
    // Silently accept other event types (call.started, transcript, etc.)
    return;
  }

  const vapiCallId = payload.call?.id;
  if (!vapiCallId) {
    console.error('[vapi-webhook] call.ended event missing call.id');
    return;
  }

  // ── 4. Idempotency check — deduplicate on vapiCallId ─────────────────────
  const existing = await prisma.callAttempt.findUnique({
    where: { vapiCallId },
    select: { id: true },
  });

  if (existing) {
    console.log(`[vapi-webhook] Duplicate event for vapiCallId=${vapiCallId} — ignoring`);
    return;
  }

  // ── 5. Resolve claim from metadata ───────────────────────────────────────
  const metadata = payload.metadata;
  if (!metadata?.claimId) {
    console.error(`[vapi-webhook] No claimId in metadata for call ${vapiCallId}`);
    return;
  }

  const claim = await prisma.insuranceClaim.findUnique({
    where: { id: metadata.claimId },
    select: {
      id: true,
      practiceId: true,
      carrierId: true,
      patientToken: true,
      status: true,
    },
  });

  if (!claim) {
    console.error(`[vapi-webhook] Claim ${metadata.claimId} not found for call ${vapiCallId}`);
    return;
  }

  // ── 6. Classify outcome ──────────────────────────────────────────────────
  const processed = classifyOutcome(payload);

  // ── 7. Persist CallAttempt (idempotent — unique on vapiCallId) ───────────
  try {
    await prisma.callAttempt.create({
      data: {
        claimId:              claim.id,
        vapiCallId,
        initiatedAt:          payload.call.startedAt
                                ? new Date(payload.call.startedAt)
                                : new Date(),
        completedAt:          payload.call.endedAt
                                ? new Date(payload.call.endedAt)
                                : new Date(),
        durationSeconds:      processed.durationSeconds,
        outcome:              processed.outcome,
        outcomeDetail:        processed.outcomeDetail,
        repName:              processed.repName,
        referenceNumber:      processed.referenceNumber,
        transcriptUrl:        processed.transcriptUrl,
        carrierBlockDetected: processed.carrierBlockDetected,
      },
    });
  } catch (err: unknown) {
    // Race condition: another process inserted same vapiCallId
    if ((err as { code?: string }).code === 'P2002') {
      console.log(`[vapi-webhook] Concurrent duplicate for vapiCallId=${vapiCallId} — skipping`);
      return;
    }
    throw err;
  }

  // ── 8. CARRIER_BLOCK protocol ────────────────────────────────────────────
  // This is the highest-risk path. Must execute completely before any other
  // state updates. One block detection suspends ALL calls to that carrier.
  if (processed.carrierBlockDetected) {
    console.error(
      `[vapi-webhook] CARRIER_BLOCK DETECTED — carrierId=${claim.carrierId} practiceId=${claim.practiceId}`,
    );

    await prisma.$transaction(async (tx) => {
      // a. Write CarrierBlockEvent
      await tx.carrierBlockEvent.create({
        data: {
          practiceId: claim.practiceId,
          carrierId:  claim.carrierId,
          notes:      `Auto-detected from call ${vapiCallId}. Outcome: ${processed.outcomeDetail}`,
        },
      });

      // b. Suspend all PENDING queue entries for this practice+carrier
      await tx.callQueue.updateMany({
        where: {
          status: 'PENDING',
          claim: {
            practiceId: claim.practiceId,
            carrierId:  claim.carrierId,
          },
        },
        data: { status: 'BLOCKED' },
      });

      // c. Mark the triggering claim as BLOCKED
      await tx.insuranceClaim.update({
        where: { id: claim.id },
        data:  { status: 'BLOCKED' },
      });
    });

    // d. Send alert (outside transaction — non-fatal if it fails)
    try {
      await sendCarrierBlockAlert({
        practiceId:   claim.practiceId,
        carrierId:    claim.carrierId as CarrierId,
        vapiCallId,
        outcomeDetail: processed.outcomeDetail,
      });
    } catch (alertErr) {
      console.error('[vapi-webhook] Failed to send carrier block alert:', alertErr);
    }

    return;  // Do not update claim status further — it's BLOCKED
  }

  // ── 9. Update CallQueue status ───────────────────────────────────────────
  const newQueueStatus = processed.outcome === 'RESOLVED' || processed.outcome === 'DENIED'
    ? 'COMPLETED'
    : processed.outcome === 'ESCALATED'
    ? 'ESCALATED'
    : 'PENDING';

  await prisma.callQueue.updateMany({
    where: { claimId: claim.id },
    data:  {
      status:        newQueueStatus,
      lastAttemptAt: new Date(),
    },
  });

  // ── 10. Update InsuranceClaim status ────────────────────────────────────
  const newClaimStatus = outcomeToClaimStatus(processed.outcome);
  await prisma.insuranceClaim.update({
    where: { id: claim.id },
    data:  { status: newClaimStatus },
  });

  // ── 11. Detokenize for practice record updates (if needed) ───────────────
  // Only called if downstream practice systems need the real patientId.
  // The resolved patientId is NEVER stored back into any call-related table.
  if (processed.outcome === 'RESOLVED' && metadata.patientToken) {
    try {
      const realPatientId = piiVault.detokenize(metadata.patientToken);
      // TODO: wire to practice EMR sync when Abeldent connector is ready
      // e.g. await practiceSync.markClaimResolved(realPatientId, claim.id);
      console.log(`[vapi-webhook] Claim ${claim.id} resolved for patient (internal ID: ${realPatientId})`);
    } catch (vaultErr) {
      // Token may have expired — log but don't fail the webhook
      console.warn('[vapi-webhook] PIIVault detokenize failed (token may have expired):', vaultErr);
    }
  }

  console.log(
    `[vapi-webhook] Processed call ${vapiCallId} — outcome: ${processed.outcome} — claim: ${claim.id}`,
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import type { CallOutcome, ClaimStatus } from '@prisma/client';

function outcomeToClaimStatus(outcome: CallOutcome): ClaimStatus {
  switch (outcome) {
    case 'RESOLVED':       return 'RESOLVED';
    case 'DENIED':         return 'DENIED';
    case 'ESCALATED':      return 'ESCALATED';
    case 'BLOCK_DETECTED': return 'BLOCKED';
    case 'PENDING':        return 'IN_QUEUE';
    default:               return 'IN_QUEUE';
  }
}

export default router;
