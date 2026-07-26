import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logLine } from '../server/observability/logger';
import { applyCarrierBlock } from '../server/frontDesk/carrierBlockService';

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
    const attempt = await prisma.callAttempt.findUnique({
      where: { id: callAttemptId },
      select: {
        id: true,
        vapiCallId: true,
        transcriptText: true,
        carrierBlockDetected: true,
        outcome: true,
        claim: {
          select: {
            id: true,
            practiceId: true,
            carrierId: true,
          },
        },
      },
    });

    if (!attempt) {
      logLine('warn', `[guardrail-worker] CallAttempt ${callAttemptId} not found`);
      await prisma.guardrailAuditOutbox.update({
        where: { id: outboxId },
        data: {
          processedAt: new Date(),
          lastError: 'CallAttempt not found',
        },
      });
      return true; // Considered "processed" even though failed
    }

    if (!attempt.transcriptText) {
      logLine('warn', `[guardrail-worker] No transcript text for ${callAttemptId}`);
      await prisma.guardrailAuditOutbox.update({
        where: { id: outboxId },
        data: {
          processedAt: new Date(),
          lastError: 'No transcript text',
        },
      });
      return true;
    }

    // Call the sidecar
    const auditResult = await callSidecar({
      callAttemptId: attempt.id,
      transcriptText: attempt.transcriptText,
      carrierId: attempt.claim.carrierId,
      outcome: attempt.outcome || 'UNKNOWN',
      rulesVersion: '1.0.0',
    });

    // Write audit result to database
    await prisma.guardrailAudit.create({
      data: {
        callAttemptId: attempt.id,
        rulesVersion: auditResult.rules_version,
        riskScore: auditResult.risk_score,
        violationsJson: auditResult.violations as unknown as Prisma.InputJsonValue,
        signalsJson: auditResult.signals as unknown as Prisma.InputJsonValue,
        sidecarLatencyMs: auditResult.sidecar_latency_ms,
      },
    });

    // If sidecar detected a carrier block that regex missed, fire CarrierBlockEvent
    if (auditResult.signals.carrier_block && !attempt.carrierBlockDetected) {
      logLine(
        'info',
        `[guardrail-worker] Retroactive carrier block detected for call ${callAttemptId}`
      );

      await applyCarrierBlock(prisma, {
        practiceId: attempt.claim.practiceId,
        carrierId: attempt.claim.carrierId,
        vapiCallId: attempt.vapiCallId,
        reason: `Detected by guardrails audit (post-call) for call ${callAttemptId}`,
        hangVapi: false,
      });
    }

    // Mark outbox row as processed
    await prisma.guardrailAuditOutbox.update({
      where: { id: outboxId },
      data: { processedAt: new Date() },
    });

    return true;
  } catch (err) {
    logLine('error', `[guardrail-worker] Error processing outbox row: ${err}`);

    // Increment attempts and record error
    const row = await prisma.guardrailAuditOutbox.findUnique({
      where: { id: outboxId },
      select: { attempts: true },
    });

    const nextAttempts = (row?.attempts || 0) + 1;
    const errorMsg = err instanceof Error ? err.message : String(err);

    await prisma.guardrailAuditOutbox.update({
      where: { id: outboxId },
      data: {
        attempts: nextAttempts,
        lastError: errorMsg,
      },
    });

    // Give up after 3 attempts
    if (nextAttempts >= 3) {
      logLine('error', `[guardrail-worker] Max attempts reached for outbox ${outboxId}`);
      await prisma.guardrailAuditOutbox.update({
        where: { id: outboxId },
        data: { processedAt: new Date() },
      });
      return true;
    }

    return false; // Retry later
  }
}

export async function drainGuardrailAuditOutbox(): Promise<void> {
  logLine('info', '[guardrail-worker] Starting drain cycle...');

  try {
    // Grab the next unprocessed row
    const row = await prisma.guardrailAuditOutbox.findFirst({
      where: { processedAt: null },
      orderBy: { enqueuedAt: 'asc' },
    });

    if (!row) {
      logLine('debug', '[guardrail-worker] No pending audit jobs');
      return;
    }

    const success = await processOutboxRow(row.id, row.callAttemptId);

    if (success) {
      logLine('info', `[guardrail-worker] Processed outbox row ${row.id}`);
    } else {
      logLine('warn', `[guardrail-worker] Failed to process, will retry: ${row.id}`);
    }
  } catch (err) {
    logLine('error', `[guardrail-worker] Drain error: ${err}`);
  }
}
