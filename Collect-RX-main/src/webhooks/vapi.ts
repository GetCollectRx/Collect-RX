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
import { webhookGuardScanMetadata, webhookGuardScanPayload, persistFromVapiPayload, enqueueForAudit } from '../services/guardrails/index.js';
import type { VapiWebhookPayload } from '../vapi/client';
import { processVapiDeskWebhook } from '../server/frontDesk/vapiDeskEvents.js';
import {
  claimVapiWebhookForProcessing,
  hashWebhookBody,
  markWebhookProcessed,
  markVapiWebhookFailed,
  type VapiWebhookProcessingClaim,
  verifyPaymentToolResult,
} from '../server/vapi/vapiWebhook.js';
import { validateWebhookMetadata, formatValidationError } from '../server/webhooks/metadata-validator.js';
import { normalizeVapiWebhook, shouldProposeLessons } from './vapiNormalizer.js';
import { runClaimsValidation, coerceExtractedFacts } from '../server/vapi/claimsValidatorWebhook.js';
import { runWithRlsBypass } from '../server/db/rlsContext.js';
import { appendAuditLog } from '../server/audit/auditLog.js';
import { resolveOutcomeFromWebhookPayload } from '../outcome/webhookOutcomeResolver.js';
import { recordIvrFailureRelearningObservation } from '../server/discovery/carrierDiscoveryService.js';

const router = Router();

type VapiWebhookAuditAction =
  | 'VAPI_WEBHOOK_RECEIVED'
  | 'VAPI_WEBHOOK_REJECTED'
  | 'VAPI_WEBHOOK_DUPLICATE'
  | 'VAPI_WEBHOOK_PROCESSED';

/**
 * Resolves the tenant only from an existing claim/call record. Webhook metadata
 * is not trusted enough to choose an audit-log tenant on its own.
 */
export async function appendVapiWebhookAudit(
  action: VapiWebhookAuditAction,
  payload: VapiWebhookPayload,
): Promise<void> {
  const vapiCallId = payload.call?.id;
  const subject = await runWithRlsBypass(async () => {
    if (vapiCallId) {
      const attempt = await prisma.callAttempt.findUnique({
        where: { vapiCallId },
        select: { id: true, claim: { select: { practiceId: true } } },
      });
      if (attempt) {
        return {
          practiceId: attempt.claim.practiceId,
          subjectType: 'CallAttempt',
          subjectId: attempt.id,
        };
      }
    }
    return null;
  });
  if (!subject) return;

  await runWithRlsBypass(() =>
    appendAuditLog(prisma, {
      ...subject,
      action,
      // Event type is operational metadata. Never store the webhook body,
      // transcript, metadata, signature, or identifiers.
      details: { eventType: payload.type },
    }),
  );
}

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
  // Two auth paths: HMAC x-vapi-signature (assistant-level server credential)
  // or x-vapi-secret (per-tool server config, which cannot carry the HMAC
  // credential). Either must match before anything is processed.
  const signature = req.headers['x-vapi-signature'] as string | undefined;
  const toolSecret = req.headers['x-vapi-secret'] as string | undefined;

  const rawBody = req.body as Buffer;  // Raw body provided by express.raw()
  if (!Buffer.isBuffer(rawBody)) {
    console.error('[vapi-webhook] Expected raw Buffer body — check middleware order');
    return res.status(400).json({ error: 'Invalid body format' });
  }

  const secretOk =
    !!toolSecret &&
    !!process.env.VAPI_WEBHOOK_SECRET &&
    toolSecret === process.env.VAPI_WEBHOOK_SECRET;

  if (!signature && !secretOk) {
    console.warn('[vapi-webhook] Missing x-vapi-signature header');
    return res.status(401).json({ error: 'Missing signature' });
  }

  if (signature && !validateSignature(rawBody, signature)) {
    console.warn('[vapi-webhook] HMAC signature mismatch — rejecting request');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // ── 1b. In-call tool calls — answered synchronously, nothing persisted ───
  // verify_payment_amount: the model copies amounts, the server owns the
  // math. Production calls carry metadata.claimId, so the expected amount is
  // read from the claim itself (the model-passed value is only a fallback
  // for sim/test calls with no claim behind them — round 6 proved the model
  // can mis-copy an amount that is plainly in its prompt).
  try {
    const peek = JSON.parse(rawBody.toString('utf-8')) as {
      message?: {
        type?: string;
        call?: { assistantOverrides?: { metadata?: { claimId?: string } } };
        toolWithToolCallList?: Array<{
          name?: string;
          toolCall?: { id?: string; function?: { name?: string; arguments?: unknown } };
        }>;
      };
    };
    if (peek?.message?.type === 'tool-calls' && peek.message.toolWithToolCallList?.length) {
      const claimId = peek.message.call?.assistantOverrides?.metadata?.claimId;
      let dbExpected: string | null = null;
      if (claimId) {
        const claim = await runWithRlsBypass(async () =>
          prisma.insuranceClaim.findUnique({
            where: { id: claimId },
            select: { outstandingAmount: true, billedAmount: true },
          }),
        );
        const amt = Number(claim?.outstandingAmount ?? claim?.billedAmount);
        if (Number.isFinite(amt) && amt > 0) dbExpected = amt.toFixed(2);
      }
      const results = peek.message.toolWithToolCallList.map((t) => {
        const fnName = t.name || t.toolCall?.function?.name;
        if (fnName === 'verify_payment_amount') {
          let args: Record<string, unknown> = {};
          try {
            const rawArgs = t.toolCall?.function?.arguments;
            args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs as Record<string, unknown>) ?? {};
          } catch { /* fall through with empty args */ }
          return {
            name: 'verify_payment_amount',
            toolCallId: t.toolCall?.id,
            result: verifyPaymentToolResult(args.statedAmount, dbExpected ?? args.expectedAmount),
          };
        }
        return {
          name: fnName,
          toolCallId: t.toolCall?.id,
          result: 'No handler for this tool.',
        };
      });
      return res.status(200).json({ results });
    }
  } catch {
    // Not JSON or not a tool-call envelope — continue to normal processing.
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
      { vapiCallId: payload.call?.id }
    );
    await appendVapiWebhookAudit('VAPI_WEBHOOK_REJECTED', payload);
    return res.status(403).json({
      error: 'Metadata validation failed',
      details: metadataValidation.details,
    });
  }
  await appendVapiWebhookAudit('VAPI_WEBHOOK_RECEIVED', payload);

  // Create a payload-free delivery ledger entry before processing. The entry is
  // marked processed only after the recovery path succeeds, so a 5xx delivery
  // can be retried instead of being permanently suppressed as a duplicate.
  const bodyHash = hashWebhookBody(rawBody);
  let claim: VapiWebhookProcessingClaim;
  try {
    claim = await runWithRlsBypass(() => claimVapiWebhookForProcessing(prisma, bodyHash));
  } catch (claimErr) {
    console.error('[vapi-webhook] Failed to claim webhook delivery:', claimErr);
    return res.status(500).json({ error: 'Internal error' });
  }

  if (claim.state === 'processed') {
    await appendVapiWebhookAudit('VAPI_WEBHOOK_DUPLICATE', payload);
    return res.status(200).json({ received: true, duplicate: true });
  }
  if (claim.state === 'processing') {
    // A concurrent delivery owns the lease. Ask Vapi to retry rather than
    // acknowledging an event whose outcome is still unknown.
    return res.status(503).json({ error: 'Webhook processing in progress' });
  }

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
    try {
      await runWithRlsBypass(() => markVapiWebhookFailed(prisma, bodyHash));
    } catch (markFailedErr) {
      console.error('[vapi-webhook] Failed to record webhook processing failure:', markFailedErr);
    }
    await appendVapiWebhookAudit('VAPI_WEBHOOK_REJECTED', payload).catch((auditErr: unknown) => {
      console.error('[vapi-webhook] Failed to write rejection audit event:', auditErr);
    });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  // ── Guardrails: scan metadata/payload for PHI, persist transcript, enqueue audit ──
  const vapiCallId = payload.call?.id;
  if (vapiCallId) {
    try {
      await runWithRlsBypass(async () => {
      const callAttempt = await prisma.callAttempt.findUnique({
        where: { vapiCallId },
        select: { id: true, claim: { select: { carrierId: true } } },
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

        // A deterministic IVR failure can contribute only PHI-safe menu steps.
        // Carrier blocks are deliberately excluded and remain under the existing
        // suspension-and-human-review protocol.
        if (payload.type === 'call.ended' && payload.transcript) {
          try {
            const outcome = resolveOutcomeFromWebhookPayload(payload);
            await recordIvrFailureRelearningObservation(
              prisma,
              callAttempt.claim.carrierId,
              payload.transcript,
              outcome.carrierBlockDetected,
            );
          } catch (relearningErr) {
            console.error('[vapi-webhook] IVR failure relearning failed (non-fatal):', relearningErr);
          }
        }
      }
      });
    } catch (guardrailsErr) {
      console.error('[vapi-webhook] Guardrails error (non-fatal):', guardrailsErr);
      // Continue processing — guardrails failures should not block the webhook
    }
  }

  try {
    await runWithRlsBypass(() => markWebhookProcessed(prisma, bodyHash));
  } catch (markProcessedErr) {
    console.error('[vapi-webhook] Failed to mark webhook processed:', markProcessedErr);
    try {
      await runWithRlsBypass(() => markVapiWebhookFailed(prisma, bodyHash));
    } catch (markFailedErr) {
      console.error('[vapi-webhook] Failed to record webhook processing failure:', markFailedErr);
    }
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
  await appendVapiWebhookAudit('VAPI_WEBHOOK_PROCESSED', payload).catch((auditErr: unknown) => {
    console.error('[vapi-webhook] Failed to write processed audit event:', auditErr);
  });
  return res.status(200).json({ received: true });
});

export default router;
