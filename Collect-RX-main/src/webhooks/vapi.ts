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
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { VapiWebhookPayload } from '../vapi/client';
import { processVapiDeskWebhook } from '../server/frontDesk/vapiDeskEvents.js';
import {
  hashWebhookBody,
  markWebhookProcessed,
} from '../server/vapi/vapiWebhook.js';

// H-4: detect Prisma unique constraint violations (P2002) for atomic webhook claiming.
function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

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

  // H-4: atomically claim this webhook delivery before processing.
  // markWebhookProcessed inserts a row with a unique bodyHash constraint.
  // The first concurrent request to INSERT wins; the second gets P2002 and
  // is dropped. This prevents two Vapi retries from both running recovery logic.
  const bodyHash = hashWebhookBody(rawBody);
  try {
    await markWebhookProcessed(prisma, bodyHash);
  } catch (claimErr) {
    if (isUniqueConstraintError(claimErr)) {
      return res.status(200).json({ received: true, duplicate: true });
    }
    console.error('[vapi-webhook] Failed to claim webhook delivery:', claimErr);
    return res.status(500).json({ error: 'Internal error' });
  }

  // Acknowledge immediately — Vapi expects a fast 200
  res.status(200).json({ received: true });

  try {
    const { tryProcessProspectVapiWebhook } = await import('../server/marketing/vapiSalesCall.js');
    const handledAsProspect = await tryProcessProspectVapiWebhook(prisma, payload);
    if (!handledAsProspect) {
      await processVapiDeskWebhook(prisma, payload, { rawBody });
    }
  } catch (err) {
    console.error('[vapi-webhook] Processing error:', err);
  }
});

export default router;
