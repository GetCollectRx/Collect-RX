// ─────────────────────────────────────────────────────────────────────────────
// Vapi call.ended — prefer structured CollectRx fields when present; else regex classifier.
//
// Configure Vapi / assistant to attach `metadata.collectrx` or `analysis.collectrx`:
//   { "schemaVersion": 1, "callOutcome": "RESOLVED", "claimStatus": "APPROVED_PENDING_PAYMENT",
//     "outcomeDetail": "…", "carrierBlockDetected": false }
// ─────────────────────────────────────────────────────────────────────────────

import type { CallOutcome, ClaimStatus } from '@prisma/client';
import type { VapiWebhookPayload, CollectrxWebhookStructured } from '../vapi/client';
import { classifyOutcome, type ProcessedOutcome } from './processor'

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

/** Extract structured data from analysis.structuredData (deployed squad shape). */
function extractStructuredData(payload: VapiWebhookPayload): { claimNumber?: string; outcome?: string; referenceNumber?: string } | null {
  const data = payload.analysis?.structuredData;
  if (!data || typeof data !== 'object') return null;
  return data as Record<string, unknown>;
}

function parseCallOutcome(raw: string | undefined): CallOutcome | null {
  if (!raw || !CALL_OUTCOMES.has(raw)) return null;
  return raw as CallOutcome;
}

/** Map squad outcome enums to CallOutcome values. */
function mapSquadOutcomeToCallOutcome(squadOutcome: string): CallOutcome | null {
  switch (squadOutcome?.toUpperCase()) {
    case 'CLAIM_PAID':
      return 'RESOLVED';
    case 'CLAIM_DENIED':
      return 'DENIED';
    case 'PARTIAL_PAYMENT':
      return 'ESCALATED'; // Per spec: partial payments require human verification
    default:
      return null;
  }
}

export function extractStructuredClaimStatus(payload: VapiWebhookPayload): ClaimStatus | null {
  // First check for new squad structuredData shape
  const data = extractStructuredData(payload);
  if (data?.outcome) {
    const mapped = mapSquadOutcomeToCallOutcome(data.outcome);
    if (mapped) return mapped as ClaimStatus;
  }

  // Fall back to legacy collectrx shape
  const st = extractCollectrxStructured(payload);
  const cs = st?.claimStatus;
  if (!cs) return null;
  if (!STRUCTURED_CLAIM_STATUS.has(cs as ClaimStatus)) return null;
  return cs as ClaimStatus;
}

/**
 * Full `ProcessedOutcome` for persistence — structured wins when outcome is valid.
 * Checks both legacy collectrx and new squad structuredData formats.
 */
export function resolveOutcomeFromWebhookPayload(payload: VapiWebhookPayload): ProcessedOutcome {
  // Try new squad structuredData format first (analysis.structuredData)
  const data = extractStructuredData(payload);
  if (data?.claimNumber && data?.outcome) {
    const mappedOutcome = mapSquadOutcomeToCallOutcome(data.outcome);
    if (mappedOutcome) {
      return {
        outcome: mappedOutcome,
        outcomeDetail: `[squad structured: ${data.outcome}]`,
        repName: null,
        referenceNumber: data.referenceNumber ?? null,
        transcriptUrl: payload.recordingUrl ?? null,
        durationSeconds: payload.call.durationSeconds ?? null,
        carrierBlockDetected: false,
      };
    }
  }

  // Fall back to legacy collectrx format (metadata.collectrx or analysis.collectrx)
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
