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
import { piiVault } from '../../pii-vault.js';
import { handlePostCallAudioDeletion } from '../../services/pii-vault.js';
import {
  triggerPostCallDebrief,
  triggerHallucinationDetector,
  triggerEscalationTriage,
} from '../agents/eventAgents.js';
import { appendAuditLog } from '../audit/auditLog.js';
import { processPreVisitCallEnded } from '../preVisit/preVisitWebhook.js';

// ── PHI SCRUBBER ─────────────────────────────────────────────────────────────
// Scrub PHI patterns from transcript text before storing in DB.
// Mirrors the field-level scrubbing in logger.js PHI_FIELD_NAMES/PHI_PATTERNS.
// This is defence-in-depth: even if PHI slips through, it is masked on persist.
const PHI_TRANSCRIPT_PATTERNS: Array<[RegExp, string]> = [
  // ISO dates — DOBs, treatment dates (collateral damage acceptable; dates are restorable from claim)
  [/\b\d{4}-\d{2}-\d{2}\b/g, '[DATE-REDACTED]'],
  // Spoken dates: "January 15, 1985" / "Jan 15 1985"
  [/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/gi, '[DATE-REDACTED]'],
  // Policy/group/member numbers: 6–15 digit strings (common in dental insurance)
  [/\b\d{6,15}\b/g, '[ID-REDACTED]'],
  // Labeled PHI fields if they somehow appear
  [/(?:policy[_ -]?number|policy[_ -]?no)[:\s]+[\w-]+/gi, 'policy_number: [REDACTED-PHI]'],
  [/(?:date[_ -]?of[_ -]?birth|dob)[:\s]+[\w/-]+/gi, 'date_of_birth: [REDACTED-PHI]'],
  [/(?:patient[_ -]?name|member[_ -]?name)[:\s]+[A-Za-z ,.-]+/gi, 'patient_name: [REDACTED-PHI]'],
];

/**
 * PHI may be purged from the vault only when the recovery decision means this
 * claim will not be dialed again. A retryable outcome requeues the claim for
 * another attempt and must keep its token; a terminal outcome (resolved,
 * denied, escalated, max attempts, or an explicit stop) releases it.
 */
export function shouldRevokePhiAfterCall(decision: {
  route: string;
  queueStatus: string;
  stopCalling: boolean;
}): boolean {
  const willBeCalledAgain =
    decision.route === 'CALL_CARRIER' &&
    decision.queueStatus === 'PENDING' &&
    !decision.stopCalling;
  return !willBeCalledAgain;
}

export function scrubTranscriptPhi(transcript: string): string {
  let scrubbed = transcript;
  for (const [pattern, replacement] of PHI_TRANSCRIPT_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, replacement);
  }
  return scrubbed;
}

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

  if (payload.metadata?.appointmentVerificationId) {
    await processPreVisitCallEnded(payload, prisma);
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
          billedAmount: true,
          daysOutstanding: true,
          status: true,
          patientToken: true,
          treatmentCodes: true,
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

  // ── TRANSCRIPT PHI SCRUB ─────────────────────────────────────────────────
  // Scrub PHI patterns from the transcript before it is used for outcome
  // classification, logging, or storage. The voice agent may have spoken
  // patient name, DOB, or policy number aloud — we must not persist those.
  // See logger.js PHI_FIELD_NAMES for field-level scrubbing on the log layer.
  if (payload.transcript) {
    payload.transcript = scrubTranscriptPhi(payload.transcript);
  }

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

  // ── PHI TOKEN REVOCATION ────────────────────────────────────────────────
  // Revoke the PHI token only when this claim will NOT be dialed again (see
  // shouldRevokePhiAfterCall). Revoking after a retryable outcome would leave
  // attempts 2/3 unable to detokenize, silently defeating the retry policy.
  if (claim.patientToken && shouldRevokePhiAfterCall(decision)) {
    piiVault.expireToken(claim.patientToken, 'post-call-revocation');
  }

  // ── ZERO-RETENTION: AUDIO + RECORDING DELETION ──────────────────────────
  // Delete recording from Vapi (and Twilio if applicable).
  // belt-and-suspenders: recordingEnabled:false was set at call initiation,
  // but we also explicitly delete in case Vapi stored anything.
  //
  // M-3: handlePostCallAudioDeletion never throws — it catches all errors and
  // returns them in result.errors. Awaiting and checking the result ensures
  // failed deletions are tracked in the audit log for compliance review.
  const recordingUrl = payload.recordingUrl ?? null;
  try {
    const deletionResult = await handlePostCallAudioDeletion(vapiCallId, recordingUrl);
    if (deletionResult.errors.length > 0) {
      console.error(
        '[vapi-webhook] post-call audio deletion incomplete — recording may persist at Vapi/Twilio:',
        { vapiCallId, errors: deletionResult.errors },
      );
      // Write to audit log so the compliance team can investigate and retry.
      await appendAuditLog(prisma, {
        practiceId: claim.practiceId,
        action: 'AUDIO_DELETION_FAILED',
        subjectType: 'CallAttempt',
        subjectId: attempt.id,
        details: { vapiCallId, errors: deletionResult.errors, recordingUrl },
      }).catch((auditErr: unknown) => {
        console.error('[vapi-webhook] failed to write AUDIO_DELETION_FAILED audit log:', auditErr);
      });
    }
  } catch (deletionErr: unknown) {
    console.error('[vapi-webhook] post-call audio deletion threw unexpectedly:', deletionErr);
  }

  // ── AUTONOMOUS AGENTS: post-call triggers ────────────────────────────────────
  // Fire-and-forget — never block the webhook response.
  // Activated only when AGENTS_ENABLED=true + GEMINI_API_KEY is set.
  if (process.env.AGENTS_ENABLED === 'true' || process.env.AGENTS_ENABLED === '1') {
    const callSummary = {
      vapiCallId,
      claimId: claim.id,
      carrierId: claim.carrierId ?? 'unknown',
      outcome: processed.outcome,
      durationSeconds: payload.call?.endedAt && payload.call?.startedAt
        ? Math.round((new Date(payload.call.endedAt).getTime() - new Date(payload.call.startedAt).getTime()) / 1000)
        : undefined,
      // Transcript already scrubbed by scrubTranscriptPhi() above
      transcript: payload.transcript ? payload.transcript.slice(0, 2000) : undefined,
    };

    triggerPostCallDebrief(prisma, callSummary);
    triggerHallucinationDetector(prisma, {
      ...callSummary,
      referenceNumber: processed.referenceNumber ?? undefined,
    });

    if (processed.outcome === 'ESCALATED') {
      triggerEscalationTriage(prisma, {
        claimId: claim.id,
        carrierId: claim.carrierId ?? 'unknown',
        reason: 'outcome: ESCALATION_REQUIRED',
        practiceId: claim.practiceId ?? 'unknown',
        billedAmount: claim.billedAmount != null ? Number(claim.billedAmount) : undefined,
      });
    }
  }

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

/**
 * @deprecated L-1: SUPERSEDED — never mounted, never called.
 *
 * The active webhook handler is `src/webhooks/vapi.ts` (HMAC-SHA256 auth,
 * atomic idempotency via markWebhookProcessed, processVapiDeskWebhook).
 * This function uses a different auth mechanism (shared-secret header check)
 * and routes directly to processCallEnded, bypassing the desk event pipeline.
 * Do NOT add new call sites. Remove this function when the codebase has
 * confirmed zero test references.
 */
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
