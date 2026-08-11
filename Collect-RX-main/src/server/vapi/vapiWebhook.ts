/**
 * P4-05 — Vapi call-ended processing pipeline: idempotent body-hashing,
 * recovery-loop dispatch, and the CARRIER_BLOCK protocol. Consumed by the
 * real webhook handler at `src/webhooks/vapi.ts` (HMAC-SHA256 auth).
 *
 * CRITICAL: `call.ended` events drive the entire claims recovery loop via claim router +
 * recovery actions, sync verification, and CDCP branching.
 */

import { createHash } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
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
import { isHeldThenDumped } from '../recovery/holdLedger.js';
import { parseMoneyToCents } from './claimsValidatorWebhook.js';
import { piiVault } from '../../pii-vault.js';
import { handlePostCallAudioDeletion } from '../../services/pii-vault.js';
import {
  triggerPostCallDebrief,
  triggerHallucinationDetector,
  triggerEscalationTriage,
} from '../agents/eventAgents.js';
import { appendAuditLog } from '../audit/auditLog.js';
import { processPreVisitCallEnded } from '../preVisit/preVisitWebhook.js';
import { logger } from '../observability/logger.js';

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
  await prisma.processedVapiWebhook.upsert({
    where: { bodyHash },
    create: {
      bodyHash,
      status: 'processed',
      attemptCount: 1,
      processedAt: new Date(),
    },
    update: {
      status: 'processed',
      processedAt: new Date(),
      failedAt: null,
    },
  });
}

const VAPI_WEBHOOK_PROCESSING_LEASE_MS = 5 * 60 * 1000;

export type VapiWebhookProcessingClaim =
  | { state: 'claimed' }
  | { state: 'processed' }
  | { state: 'processing' };

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Atomically claims a hashed delivery for synchronous processing. A stale lease
 * is reclaimable after a process crash; the payload itself is never persisted.
 */
export async function claimVapiWebhookForProcessing(
  prisma: PrismaClient,
  bodyHash: string,
  now = new Date(),
): Promise<VapiWebhookProcessingClaim> {
  try {
    await prisma.processedVapiWebhook.create({
      data: { bodyHash, status: 'received' },
    });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
  }

  const staleBefore = new Date(now.getTime() - VAPI_WEBHOOK_PROCESSING_LEASE_MS);
  const claimed = await prisma.processedVapiWebhook.updateMany({
    where: {
      bodyHash,
      OR: [
        { status: { in: ['received', 'failed'] } },
        { status: 'processing', processingStartedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: 'processing',
      attemptCount: { increment: 1 },
      processingStartedAt: now,
      failedAt: null,
    },
  });

  if (claimed.count === 1) return { state: 'claimed' };

  const existing = await prisma.processedVapiWebhook.findUnique({
    where: { bodyHash },
    select: { status: true },
  });
  return existing?.status === 'processed' ? { state: 'processed' } : { state: 'processing' };
}

export async function markVapiWebhookFailed(
  prisma: PrismaClient,
  bodyHash: string,
): Promise<void> {
  await prisma.processedVapiWebhook.update({
    where: { bodyHash },
    data: { status: 'failed', failedAt: new Date() },
  });
}

/**
 * Deterministic in-call payment comparison. The voice model reliably calls
 * tools (DTMF/transfer/endCall are 100% across sim rounds) but drops prose
 * arithmetic rules, so the comparison lives here: the model copies the two
 * amounts it has, the server does the math and hands back the exact next
 * move as a tool result — the one channel the model never ignores.
 * Mirrors the SHORTFALL_MISREPORTED post-call backstop ($50 tolerance).
 */
export function verifyPaymentToolResult(
  statedRaw: unknown,
  expectedRaw: unknown,
): string {
  const stated = parseMoneyToCents(typeof statedRaw === 'string' ? statedRaw : String(statedRaw ?? ''));
  const expected = parseMoneyToCents(typeof expectedRaw === 'string' ? expectedRaw : String(expectedRaw ?? ''));
  if (stated == null || expected == null) {
    return 'AMOUNT UNCLEAR — read the stated payment amount back to the representative and confirm it digit by digit, then call this tool again.';
  }
  if (stated >= expected - 50 * 100) {
    return (
      `AMOUNT OK — $${(stated / 100).toFixed(2)} covers the expected $${(expected / 100).toFixed(2)}. ` +
      'Proceed: capture the check number, payment date, mailing address or deposit details, and a reference number. Outcome CLAIM_PAID.'
    );
  }
  const shortfall = ((expected - stated) / 100).toFixed(2);
  return (
    `SHORTFALL DETECTED — the stated $${(stated / 100).toFixed(2)} is $${shortfall} below the expected ` +
    `$${(expected / 100).toFixed(2)}. Say now: 'That is less than the $${(expected / 100).toFixed(2)} we expected ` +
    `on this claim — can you explain the difference?' Then collect the reduction or remark codes for each procedure ` +
    'code, the fee guide year and province if cited, and whether the difference is patient-payable or appealable, ' +
    'plus a reference number. Report the outcome as PARTIAL_PAYMENT with the shortfall amount and reason.'
  );
}

async function fireCarrierBlockProtocol(
  prisma: PrismaClient,
  practiceId: string,
  carrierId: string,
): Promise<void> {
  logger.error('[CARRIER_BLOCK] Block detected — suspending ALL calls to this carrier immediately', {
    carrierId,
    practiceId,
  });

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
    logger.error('[CARRIER_BLOCK] Blocked claims/queue entries', { count: claimIds.length, carrierId });
  }
}

async function processCallEnded(
  payload: VapiWebhookPayload,
  prisma: PrismaClient,
  rawBody?: unknown,
): Promise<void> {
  const vapiCallId = payload.call.id;
  if (!vapiCallId) {
    logger.error('[vapi-webhook] call.ended missing call.id — cannot process outcome', {});
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
    logger.warn('[vapi-webhook] No CallAttempt found — logging raw outcome', { vapiCallId });
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
    logger.info('[vapi-webhook] call already processed', { vapiCallId, outcome: attempt.outcome });
    return;
  }

  if (attempt.completedAt && attempt.outcome && !recoveryApplied) {
    logger.warn('[vapi-webhook] Re-running recovery — call marked complete but ROUTE_ASSIGNED missing', {
      vapiCallId,
    });
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
    logger.warn('[vapi-webhook] Held unconfirmed financial outcome — escalated', {
      claimId: claim.id,
      proposed: proposedClaimStatus,
    });
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
      logger.error('[vapi-webhook] escalation create failed (non-fatal)', { error: escErr });
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
        heldThenDumped: isHeldThenDumped({
          outcome: processed.outcome,
          durationSeconds: processed.durationSeconds,
          repName: processed.repName,
          referenceNumber: processed.referenceNumber,
        }),
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
    const cdcpHit = await tryCdcpFromVapiPayload(prisma, rawBody ?? payload, {
      practiceId: claim.practiceId,
      patientToken: claim.patientToken,
    });
    if (cdcpHit) {
      await linkRecoveryActionToCdcpCase(prisma, claim.id, cdcpHit.caseId);
    }
  } catch (cdcpErr) {
    logger.error('[vapi-webhook] CDCP structured signal (non-fatal)', { error: cdcpErr });
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
      logger.error('[vapi-webhook] post-call audio deletion incomplete — recording may persist at Vapi/Twilio', {
        vapiCallId,
        errors: deletionResult.errors,
      });
      // Write to audit log so the compliance team can investigate and retry.
      await appendAuditLog(prisma, {
        practiceId: claim.practiceId,
        action: 'AUDIO_DELETION_FAILED',
        subjectType: 'CallAttempt',
        subjectId: attempt.id,
        details: { vapiCallId, errors: deletionResult.errors, recordingUrl },
      }).catch((auditErr: unknown) => {
        logger.error('[vapi-webhook] failed to write AUDIO_DELETION_FAILED audit log', { error: auditErr });
      });
    }
  } catch (deletionErr: unknown) {
    logger.error('[vapi-webhook] post-call audio deletion threw unexpectedly', { error: deletionErr });
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

  logger.info('[vapi-webhook] call.ended processed', {
    vapiCallId,
    claimId: claim.id,
    outcome: processed.outcome,
    route: decision.route,
    claimStatus: decision.claimStatus,
    recall: decision.scheduledRecallAt?.toISOString() ?? 'none',
  });
}

/** Recovery-aware call.ended handler — used by production webhook and tests. */
export async function processRecoveryCallEnded(
  payload: VapiWebhookPayload,
  prisma: PrismaClient,
  rawBody?: unknown,
): Promise<void> {
  return processCallEnded(payload, prisma, rawBody);
}

