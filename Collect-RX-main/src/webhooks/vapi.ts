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
import { webhookGuardScanMetadata, webhookGuardScanPayload, persistFromVapiPayload, enqueueForAudit } from '../services/guardrails/index.js';
import type { VapiWebhookPayload } from '../vapi/client';
import { processVapiDeskWebhook } from '../server/frontDesk/vapiDeskEvents.js';
import {
  hashWebhookBody,
  markWebhookProcessed,
} from '../server/vapi/vapiWebhook.js';
import { validateWebhookMetadata, formatValidationError } from '../server/webhooks/metadata-validator.js';
import { normalizeVapiWebhook, shouldProposeLessons } from './vapiNormalizer.js';
import { runClaimsValidation, coerceExtractedFacts } from '../server/vapi/claimsValidatorWebhook.js';
import { runWithRlsBypass } from '../server/db/rlsContext.js';

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

  // ── 2. Parse + normalize payload ─────────────────────────────────────────
  // Vapi delivers {message: {type: 'end-of-call-report' | ...}} envelopes;
  // normalizeVapiWebhook maps them to the flat shape downstream code consumes.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const payload: VapiWebhookPayload | null = normalizeVapiWebhook(parsed);
  if (!payload) {
    // Authenticated but not a message type we consume — ACK so Vapi stops retrying.
    return res.status(200).json({ received: true, ignored: true });
  }

  // ── 3. METADATA TAMPERING VALIDATION ─────────────────────────────────────
  // Prevents cross-practice claim hijacking. If an attacker changes the
  // vapiCallId to reference a call from a different practice, or changes
  // the claimId to reference a claim from a different practice, this
  // validation will detect the mismatch and reject the request.
  // Vapi authenticates by HMAC, not a practice session, so no RLS practice
  // context is established for this request. Under enforced RLS every tenant
  // table then reads back zero rows — which silently (a) defeats the
  // cross-practice tampering check below (findUnique returns null, so the
  // mismatch guard never fires) and (b) no-ops the entire post-call recovery
  // pipeline. The webhook legitimately needs to read across practices to
  // resolve which practice a call belongs to, so all its DB work runs under
  // an explicit RLS bypass.
  const metadataValidation = await runWithRlsBypass(() =>
    validateWebhookMetadata(prisma, payload),
  );
  if (!metadataValidation.valid) {
    console.warn(
      '[vapi-webhook] METADATA TAMPERING DETECTED:',
      formatValidationError(metadataValidation),
      { vapiCallId: payload.call?.id, metadata: payload.metadata }
    );
    return res.status(403).json({
      error: 'Metadata validation failed',
      details: metadataValidation.details,
    });
  }

  // H-4: atomically claim this webhook delivery before processing.
  // markWebhookProcessed inserts a row with a unique bodyHash constraint.
  // The first concurrent request to INSERT wins; the second gets P2002 and
  // is dropped. This prevents two Vapi retries from both running recovery logic.
  const bodyHash = hashWebhookBody(rawBody);
  try {
    await runWithRlsBypass(() => markWebhookProcessed(prisma, bodyHash));
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
    await runWithRlsBypass(async () => {
      const { tryProcessProspectVapiWebhook } = await import('../server/marketing/vapiSalesCall.js');
      const handledAsProspect = await tryProcessProspectVapiWebhook(prisma, payload);
      if (!handledAsProspect) {
        await processVapiDeskWebhook(prisma, payload, { rawBody });
      }
    });
  } catch (err) {
    console.error('[vapi-webhook] Processing error:', err);
  }

  // ── Guardrails: scan metadata/payload for PHI, persist transcript, enqueue audit ──
  const vapiCallId = payload.call?.id;
  if (vapiCallId) {
    try {
      await runWithRlsBypass(async () => {
      const callAttempt = await prisma.callAttempt.findUnique({
        where: { vapiCallId },
        select: { id: true },
      });
      if (callAttempt) {
        const metadataResult = await webhookGuardScanMetadata(payload);
        if (metadataResult.hasPhi) {
          console.warn('[guardrails] Metadata contains PHI patterns:', metadataResult.findings);
        }

        const payloadResult = await webhookGuardScanPayload(payload);
        if (payloadResult.hasPhi) {
          console.warn('[guardrails] Payload contains PHI-like patterns:', payloadResult.findings);
        }

        const transcriptResult = await persistFromVapiPayload(payload);
        if (!transcriptResult.persisted) {
          console.warn('[guardrails] Failed to persist transcript:', transcriptResult.error);
        }

        const auditResult = await enqueueForAudit(callAttempt.id);
        if (!auditResult.enqueued) {
          console.warn('[guardrails] Failed to enqueue audit job:', auditResult.error);
        }

        // ── Async claims validation — runs off-call on end-of-call-report ──
        if (
          payload.type === 'call.ended' &&
          payload.transcript &&
          payload.analysis?.structuredData
        ) {
          const validation = await runClaimsValidation(prisma, {
            callAttemptId: callAttempt.id,
            transcript: payload.transcript,
            extractedFacts: coerceExtractedFacts(payload.analysis.structuredData),
          });
          if (validation.status === 'escalated') {
            console.warn('[vapi-webhook] Validation escalated:', validation.result.escalationReason);
          }
        }

        // ── Learning loop: propose carrier lessons from this transcript ──
        // Lessons land as PROPOSED for human review; nothing here changes
        // live behavior without approval.
        if (shouldProposeLessons(payload)) {
          try {
            const { extractLessonsFromCall } = await import('../server/learning/carrierLessons.js');
            const stored = await extractLessonsFromCall(prisma, callAttempt.id);
            if (stored > 0) {
              console.warn(`[vapi-webhook] learning loop proposed ${stored} carrier lesson(s)`);
            }
          } catch (lessonErr) {
            console.error('[vapi-webhook] lesson extraction failed (non-fatal):', lessonErr);
          }
        }
      }
      });
    } catch (guardrailsErr) {
      console.error('[vapi-webhook] Guardrails error (non-fatal):', guardrailsErr);
      // Continue processing — guardrails failures should not block the webhook
    }
  }
});

export default router;
