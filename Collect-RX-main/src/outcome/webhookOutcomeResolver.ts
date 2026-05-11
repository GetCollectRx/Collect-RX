// ─────────────────────────────────────────────────────────────────────────────
// Vapi call.ended — prefer structured CollectRx fields when present; else regex classifier.
//
// Configure Vapi / assistant to attach `metadata.collectrx` or `analysis.collectrx`:
//   { "schemaVersion": 1, "callOutcome": "RESOLVED", "claimStatus": "APPROVED_PENDING_PAYMENT",
//     "outcomeDetail": "…", "carrierBlockDetected": false }
// ─────────────────────────────────────────────────────────────────────────────

import type { CallOutcome, ClaimStatus } from '@prisma/client';
import type { VapiWebhookPayload, CollectrxWebhookStructured } from '../vapi/client';
import { classifyOutcome } from './processor';
import type { ProcessedOutcome } from './processor';

const CALL_OUTCOMES = new Set<string>([
  'RESOLVED',
  'PENDING',
  'DENIED',
  'ESCALATED',
  'BLOCK_DETECTED',
  'FAILED',
  'NO_ANSWER',
  'HUNG_UP',
]);

/** Claim statuses a trusted structured payload may set (never BLOCKED — system only). */
const STRUCTURED_CLAIM_STATUS = new Set<ClaimStatus>([
  'PENDING',
  'IN_QUEUE',
  'CALLING',
  'APPROVED_PENDING_PAYMENT',
  'RESOLVED',
  'DENIED',
  'ESCALATED',
  'ON_HOLD',
]);

function extractCollectrxStructured(payload: VapiWebhookPayload): CollectrxWebhookStructured | null {
  const m = payload.metadata?.collectrx ?? payload.analysis?.collectrx;
  if (!m || typeof m !== 'object') return null;
  if ((m as CollectrxWebhookStructured).schemaVersion !== 1) return null;
  return m as CollectrxWebhookStructured;
}

function parseCallOutcome(raw: string | undefined): CallOutcome | null {
  if (!raw || !CALL_OUTCOMES.has(raw)) return null;
  return raw as CallOutcome;
}

export function extractStructuredClaimStatus(payload: VapiWebhookPayload): ClaimStatus | null {
  const st = extractCollectrxStructured(payload);
  const cs = st?.claimStatus;
  if (!cs) return null;
  if (!STRUCTURED_CLAIM_STATUS.has(cs as ClaimStatus)) return null;
  return cs as ClaimStatus;
}

/**
 * Full `ProcessedOutcome` for persistence — structured wins when `callOutcome` is valid.
 */
export function resolveOutcomeFromWebhookPayload(payload: VapiWebhookPayload): ProcessedOutcome {
  const st = extractCollectrxStructured(payload);
  const structuredOutcome = st?.callOutcome ? parseCallOutcome(st.callOutcome) : null;

  if (structuredOutcome) {
    return {
      outcome: structuredOutcome,
      outcomeDetail: st?.outcomeDetail?.trim() || '[collectrx structured outcome]',
      repName: null,
      referenceNumber: null,
      transcriptUrl: payload.recordingUrl ?? null,
      durationSeconds: payload.call.durationSeconds ?? null,
      carrierBlockDetected: Boolean(st?.carrierBlockDetected),
    };
  }

  return classifyOutcome(payload);
}
