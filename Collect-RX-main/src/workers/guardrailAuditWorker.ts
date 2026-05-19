import { prisma } from '../lib/prisma';
import { logger } from '../server/observability/logger';

const SIDECAR_URL = process.env.SIDECAR_URL || 'http://localhost:8000';
const SIDECAR_SHARED_SECRET = process.env.SIDECAR_SHARED_SECRET || 'dev-secret';

export interface GuardrailSignals {
  carrier_block: boolean;
  phi_leak: boolean;
  off_script: boolean;
  hallucination: boolean;
}

export interface GuardrailViolation {
  rule_id: string;
  severity: string;
  evidence: string;
}

export interface SidecarAuditResponse {
  rules_version: string;
  risk_score: number;
  violations: GuardrailViolation[];
  signals: GuardrailSignals;
  sidecar_latency_ms: number | null;
}

async function callSidecar(transcript: {
  callAttemptId: string;
  transcriptText: string;
  carrierId: string;
  outcome: string;
  rulesVersion: string;
}): Promise<SidecarAuditResponse> {
  const response = await fetch(`${SIDECAR_URL}/audit/transcript`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SIDECAR_SHARED_SECRET}`,
    },
    body: JSON.stringify({
      call_attempt_id: transcript.callAttemptId,
      transcript_text: transcript.transcriptText,
      carrier_id: transcript.carrierId,
      outcome: transcript.outcome,
      rules_version: transcript.rulesVersion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Sidecar returned ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function processOutboxRow(
  outboxId: string,
  callAttemptId: string
): Promise<boolean> {
  try {
    // Fetch the call attempt with all needed context
    const attempt = await prisma.callAttempt.findUnique({
      where: { id: callAttemptId },
      select: {
        id: true,
        transcript_text: true,
        carrier_block_detected: true,
        outcome: true,
        claim: {
          select: {
            carrierId: true,
          },
        },
      },
    });

    if (!attempt) {
      logger.warn(`[guardrail-worker] CallAttempt ${callAttemptId} not found`);
      await prisma.guardrail_audit_outbox.update({
        where: { id: outboxId },
        data: {
          processed_at: new Date(),
          last_error: 'CallAttempt not found',
        },
      });
      return true; // Considered "processed" even though failed
    }

    if (!attempt.transcript_text) {
      logger.warn(`[guardrail-worker] No transcript text for ${callAttemptId}`);
      await prisma.guardrail_audit_outbox.update({
        where: { id: outboxId },
        data: {
          processed_at: new Date(),
          last_error: 'No transcript text',
        },
      });
      return true;
    }

    // Call the sidecar
    const auditResult = await callSidecar({
      callAttemptId: attempt.id,
      transcriptText: attempt.transcript_text,
      carrierId: attempt.claim.carrierId,
      outcome: attempt.outcome || 'UNKNOWN',
      rulesVersion: '1.0.0',
    });

    // Write audit result to database
    await prisma.guardrail_audit.create({
      data: {
        call_attempt_id: attempt.id,
        rules_version: auditResult.rules_version,
        risk_score: auditResult.risk_score,
        violations_json: auditResult.violations,
        signals_json: auditResult.signals,
        sidecar_latency_ms: auditResult.sidecar_latency_ms,
      },
    });

    // If sidecar detected a carrier block that regex missed, fire CarrierBlockEvent
    if (auditResult.signals.carrier_block && !attempt.carrier_block_detected) {
      logger.info(
        `[guardrail-worker] Retroactive carrier block detected for call ${callAttemptId}`
      );

      const claimData = await prisma.insuranceClaim.findUnique({
        where: { id: attempt.claim.id || '' },
        select: { practiceId: true, id: true },
      });

      if (claimData) {
        await prisma.$transaction(async (tx) => {
          // Write the event
          await tx.carrier_block_event.create({
            data: {
              practice_id: claimData.practiceId,
              carrier_id: attempt.claim.carrierId,
              notes: `Detected by guardrails audit (post-call) for call ${callAttemptId}`,
            },
          });

          // Suspend all pending calls for this practice+carrier
          await tx.call_queue.updateMany({
            where: {
              status: 'PENDING',
              claim: {
                practiceId: claimData.practiceId,
                carrierId: attempt.claim.carrierId,
              },
            },
            data: { status: 'BLOCKED' },
          });

          // Block the triggering claim
          await tx.insurance_claim.update({
            where: { id: claimData.id },
            data: { status: 'BLOCKED' },
          });
        });
      }
    }

    // Mark outbox row as processed
    await prisma.guardrail_audit_outbox.update({
      where: { id: outboxId },
      data: { processed_at: new Date() },
    });

    return true;
  } catch (err) {
    logger.error(`[guardrail-worker] Error processing outbox row: ${err}`);

    // Increment attempts and record error
    const attempts = await prisma.guardrail_audit_outbox.findUnique({
      where: { id: outboxId },
      select: { attempts: true },
    });

    const nextAttempts = (attempts?.attempts || 0) + 1;
    const errorMsg = err instanceof Error ? err.message : String(err);

    await prisma.guardrail_audit_outbox.update({
      where: { id: outboxId },
      data: {
        attempts: nextAttempts,
        last_error: errorMsg,
      },
    });

    // Give up after 3 attempts
    if (nextAttempts >= 3) {
      logger.error(`[guardrail-worker] Max attempts reached for outbox ${outboxId}`);
      await prisma.guardrail_audit_outbox.update({
        where: { id: outboxId },
        data: { processed_at: new Date() },
      });
      return true;
    }

    return false; // Retry later
  }
}

export async function drainGuardrailAuditOutbox(): Promise<void> {
  logger.info('[guardrail-worker] Starting drain cycle...');

  try {
    // Grab the next unprocessed row
    const row = await prisma.guardrail_audit_outbox.findFirst({
      where: { processed_at: null },
      orderBy: { enqueued_at: 'asc' },
    });

    if (!row) {
      logger.debug('[guardrail-worker] No pending audit jobs');
      return;
    }

    const success = await processOutboxRow(row.id, row.call_attempt_id);

    if (success) {
      logger.info(`[guardrail-worker] Processed outbox row ${row.id}`);
    } else {
      logger.warn(`[guardrail-worker] Failed to process, will retry: ${row.id}`);
    }
  } catch (err) {
    logger.error(`[guardrail-worker] Drain error: ${err}`);
  }
}

export async function startGuardrailAuditWorker(): Promise<void> {
  logger.info('[guardrail-worker] Starting guardrail audit worker');

  // Drain once per minute
  const interval = setInterval(drainGuardrailAuditOutbox, 60_000);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('[guardrail-worker] Shutting down');
    clearInterval(interval);
  });
}
