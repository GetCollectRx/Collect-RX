// ─────────────────────────────────────────────────────────────────────────────
// Vapi call.ended — prefer structured fields when present; else regex classifier.
//
// Two structured sources, checked in order:
//  1. `metadata.collectrx` / `analysis.collectrx` (forward-compat namespaced shape):
//     { "schemaVersion": 1, "callOutcome": "RESOLVED", "claimStatus": "APPROVED_PENDING_PAYMENT",
//       "outcomeDetail": "…", "carrierBlockDetected": false }
//  2. `analysis.structuredData` — what the DEPLOYED squad (vapi-squad-config.json
//     analysisPlan.structuredDataPlan) actually sends: { claimNumber, outcome:
//     "CLAIM_PAID" | "PARTIAL_PAYMENT" | …, referenceNumber, repName, … }. Source (1)
//     is a nicer namespaced shape nothing currently produces; source (2) is what
//     production traffic really looks like — both are treated as high-trust
//     corroboration for the anti-hallucination gate (src/server/outcomeConfidence.ts),
//     since both are Vapi's own schema-constrained extraction, not free-text summary.
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

function parseCallOutcome(raw: string | undefined): CallOutcome | null {
  if (!raw || !CALL_OUTCOMES.has(raw)) return null;
  return raw as CallOutcome;
}

/** The `outcome` enum from vapi-squad-config.json's analysisPlan.structuredDataPlan.schema. */
type SquadOutcome =
  | 'CLAIM_NOT_RECEIVED'
  | 'CLAIM_PAID'
  | 'PARTIAL_PAYMENT'
  | 'CLAIM_DENIED'
  | 'NOT_COVERED'
  | 'MAX_BENEFITS_REACHED'
  | 'PROCESSING'
  | 'NEED_INFORMATION'
  | 'UNCLEAR';

interface SquadStructuredMapping {
  callOutcome: CallOutcome;
  claimStatus: ClaimStatus;
}

/**
 * Maps the squad's real `outcome` enum to internal statuses. PARTIAL_PAYMENT is
 * deliberately never RESOLVED — the Claims_Agent prompt itself says a short payment
 * is "Pending reconciliation, never Resolved or Paid," so it routes to ESCALATED for
 * a human to reconcile the shortfall rather than closing the claim automatically.
 */
const SQUAD_OUTCOME_MAP: Record<SquadOutcome, SquadStructuredMapping> = {
  CLAIM_PAID: { callOutcome: 'RESOLVED', claimStatus: 'RESOLVED' },
  PARTIAL_PAYMENT: { callOutcome: 'ESCALATED', claimStatus: 'ESCALATED' },
  CLAIM_DENIED: { callOutcome: 'DENIED', claimStatus: 'DENIED' },
  NOT_COVERED: { callOutcome: 'DENIED', claimStatus: 'DENIED' },
  MAX_BENEFITS_REACHED: { callOutcome: 'DENIED', claimStatus: 'DENIED' },
  PROCESSING: { callOutcome: 'PENDING', claimStatus: 'PENDING' },
  CLAIM_NOT_RECEIVED: { callOutcome: 'ESCALATED', claimStatus: 'ESCALATED' },
  NEED_INFORMATION: { callOutcome: 'ESCALATED', claimStatus: 'ESCALATED' },
  UNCLEAR: { callOutcome: 'ESCALATED', claimStatus: 'ESCALATED' },
};

interface SquadStructuredData {
  claimNumber: string;
  outcome: SquadOutcome;
  referenceNumber?: string;
  repName?: string;
  summary?: string;
}

function extractSquadStructuredData(payload: VapiWebhookPayload): SquadStructuredData | null {
  const raw = payload.analysis?.structuredData;
  if (!raw || typeof raw !== 'object') return null;
  const claimNumber = (raw as Record<string, unknown>).claimNumber;
  const outcome = (raw as Record<string, unknown>).outcome;
  if (typeof claimNumber !== 'string' || !claimNumber.trim()) return null;
  if (typeof outcome !== 'string' || !(outcome in SQUAD_OUTCOME_MAP)) return null;
  const referenceNumber = (raw as Record<string, unknown>).referenceNumber;
  const repName = (raw as Record<string, unknown>).repName;
  const summary = (raw as Record<string, unknown>).summary;
  return {
    claimNumber,
    outcome: outcome as SquadOutcome,
    referenceNumber: typeof referenceNumber === 'string' ? referenceNumber : undefined,
    repName: typeof repName === 'string' ? repName : undefined,
    summary: typeof summary === 'string' ? summary : undefined,
  };
}

export function extractStructuredClaimStatus(payload: VapiWebhookPayload): ClaimStatus | null {
  const st = extractCollectrxStructured(payload);
  const cs = st?.claimStatus;
  if (cs && STRUCTURED_CLAIM_STATUS.has(cs as ClaimStatus)) return cs as ClaimStatus;

  const squad = extractSquadStructuredData(payload);
  if (squad) return SQUAD_OUTCOME_MAP[squad.outcome].claimStatus;

  return null;
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

  const squad = extractSquadStructuredData(payload);
  if (squad) {
    const mapped = SQUAD_OUTCOME_MAP[squad.outcome];
    return {
      outcome: mapped.callOutcome,
      outcomeDetail: squad.summary?.trim() || `[squad structured outcome: ${squad.outcome}]`,
      repName: squad.repName ?? null,
      referenceNumber: squad.referenceNumber ?? null,
      transcriptUrl: payload.recordingUrl ?? null,
      durationSeconds: payload.call.durationSeconds ?? null,
      carrierBlockDetected: false,
    };
  }

  return classifyOutcome(payload);
}
