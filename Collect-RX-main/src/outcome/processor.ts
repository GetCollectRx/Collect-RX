// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Outcome Processor
//
// Classifies the result of a Vapi call completion event into a canonical
// CallOutcome enum. Also detects carrier block signals — the highest-risk
// operational event. If a block is detected, `carrierBlockDetected: true`
// is returned and the caller MUST fire the CARRIER_BLOCK suspension protocol.
//
// Block detection strategy: scan transcript + summary for carrier-side
// phrases that indicate automation detection. This list is carrier-specific
// and should be tuned over time as signals are observed in production.
// ─────────────────────────────────────────────────────────────────────────────

import type { CallOutcome } from '@prisma/client';
import type { VapiWebhookPayload } from '../vapi/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessedOutcome {
  outcome: CallOutcome;
  outcomeDetail: string;
  repName: string | null;
  referenceNumber: string | null;
  transcriptUrl: string | null;
  durationSeconds: number | null;
  /** True if this call should trigger the CARRIER_BLOCK suspension protocol */
  carrierBlockDetected: boolean;
}

// ---------------------------------------------------------------------------
// Block signal patterns
//
// These are phrases carriers use when they detect automated/bot behaviour.
// Add to this list as new signals are observed in production transcripts.
// Each pattern is tested case-insensitively against the call transcript.
// ---------------------------------------------------------------------------

const BLOCK_SIGNAL_PATTERNS: RegExp[] = [
  /automated\s+(call|system|bot)/i,
  /we('re|\sare)\s+unable\s+to\s+process\s+automated/i,
  /robocall\s+detected/i,
  /third.party\s+(calling|system)\s+not\s+(allowed|permitted)/i,
  /cannot\s+assist\s+with\s+automated\s+calls/i,
  /this\s+number\s+has\s+been\s+flagged/i,
  /call\s+appears\s+to\s+be\s+automated/i,
  /provider\s+(access|calling)\s+(blocked|suspended|restricted)/i,
  /system.generated\s+call/i,
  /bot\s+activity(\s+detected)?/i,
  /detected\s+bot\s+activity/i,
];

// Resolution indicator phrases
const RESOLUTION_PATTERNS: RegExp[] = [
  /claim\s+(has\s+been\s+)?(processed|paid|approved|adjudicated)/i,
  /payment\s+(was|has\s+been)\s+(issued|sent|processed|mailed)/i,
  /cheque\s+(was|has\s+been)\s+mailed/i,
  /eft\s+(was|has\s+been)\s+sent/i,
  /claim\s+(is\s+)?complete/i,
  /reference\s+number\s+is/i,
];

// Denial indicator phrases
const DENIAL_PATTERNS: RegExp[] = [
  /claim\s+(has\s+been\s+)?(denied|rejected)/i,
  /not\s+(covered|eligible)/i,
  /exceeds\s+(annual\s+max|benefit\s+maximum)/i,
  /waiting\s+period\s+(applies|not\s+met)/i,
  /missing\s+(information|documentation)/i,
];

// Pending / in-process phrases
const PENDING_PATTERNS: RegExp[] = [
  /still\s+(in\s+)?process/i,
  /currently\s+(being\s+)?(reviewed|adjudicated|processed)/i,
  /allow\s+\d+\s+(business\s+)?days/i,
  /not\s+(yet\s+)?received/i,
];

// Escalation triggers
const ESCALATION_PATTERNS: RegExp[] = [
  /speak\s+(with\s+)?a\s+supervisor/i,
  /dispute\s+(this\s+)?claim/i,
  /appeals\s+(department|process)/i,
  /formal\s+complaint/i,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify the outcome of a completed Vapi call.
 *
 * @param payload - The Vapi webhook payload for a `call.ended` event.
 * @returns A `ProcessedOutcome` with outcome classification and block flag.
 */
export function classifyOutcome(payload: VapiWebhookPayload): ProcessedOutcome {
  const transcript = payload.transcript ?? '';
  const summary = payload.analysis?.summary ?? '';
  const successEval = payload.analysis?.successEvaluation ?? '';
  /** Original casing — used for name extraction and pattern display */
  const rawText  = `${transcript} ${summary} ${successEval}`;
  /** Lowercased — used for all pattern matching */
  const fullText = rawText.toLowerCase();

  const durationSeconds = payload.call.durationSeconds ?? null;
  const transcriptUrl = payload.recordingUrl ?? null;

  // ── Carrier block detection (highest priority — check first) ──────────────
  const carrierBlockDetected = BLOCK_SIGNAL_PATTERNS.some((p) => p.test(fullText));
  if (carrierBlockDetected) {
    return {
      outcome: 'BLOCK_DETECTED',
      outcomeDetail: 'Carrier detected automation — CARRIER_BLOCK protocol must fire immediately',
      repName: null,
      referenceNumber: extractReferenceNumber(fullText),
      transcriptUrl,
      durationSeconds,
      carrierBlockDetected: true,
    };
  }

  // ── Failed / no connection ────────────────────────────────────────────────
  if (payload.call.status === 'failed' || !transcript || durationSeconds === 0) {
    return {
      outcome: 'FAILED',
      outcomeDetail: payload.call.status === 'failed' ? 'Call failed to connect' : 'No transcript produced',
      repName: null,
      referenceNumber: null,
      transcriptUrl,
      durationSeconds,
      carrierBlockDetected: false,
    };
  }

  // ── No answer / very short call ───────────────────────────────────────────
  if (durationSeconds !== null && durationSeconds < 30) {
    return {
      outcome: 'NO_ANSWER',
      outcomeDetail: `Call ended after ${durationSeconds}s — likely no answer or IVR disconnect`,
      repName: null,
      referenceNumber: null,
      transcriptUrl,
      durationSeconds,
      carrierBlockDetected: false,
    };
  }

  // ── Escalation ────────────────────────────────────────────────────────────
  if (ESCALATION_PATTERNS.some((p) => p.test(fullText))) {
    return {
      outcome: 'ESCALATED',
      outcomeDetail: 'Claim requires human escalation — dispute or appeal pathway identified',
      repName: extractRepName(rawText),
      referenceNumber: extractReferenceNumber(fullText),
      transcriptUrl,
      durationSeconds,
      carrierBlockDetected: false,
    };
  }

  // ── Resolved ─────────────────────────────────────────────────────────────
  if (RESOLUTION_PATTERNS.some((p) => p.test(fullText))) {
    return {
      outcome: 'RESOLVED',
      outcomeDetail: 'Claim confirmed resolved — payment issued or claim approved',
      repName: extractRepName(rawText),
      referenceNumber: extractReferenceNumber(fullText),
      transcriptUrl,
      durationSeconds,
      carrierBlockDetected: false,
    };
  }

  // ── Denied ────────────────────────────────────────────────────────────────
  if (DENIAL_PATTERNS.some((p) => p.test(fullText))) {
    return {
      outcome: 'DENIED',
      outcomeDetail: 'Claim denied by carrier',
      repName: extractRepName(rawText),
      referenceNumber: extractReferenceNumber(fullText),
      transcriptUrl,
      durationSeconds,
      carrierBlockDetected: false,
    };
  }

  // ── Still pending ─────────────────────────────────────────────────────────
  if (PENDING_PATTERNS.some((p) => p.test(fullText))) {
    return {
      outcome: 'PENDING',
      outcomeDetail: 'Claim still in adjudication — follow up required',
      repName: extractRepName(rawText),
      referenceNumber: extractReferenceNumber(fullText),
      transcriptUrl,
      durationSeconds,
      carrierBlockDetected: false,
    };
  }

  // ── Hung up / unclear ────────────────────────────────────────────────────
  return {
    outcome: 'HUNG_UP',
    outcomeDetail: 'Call ended without clear resolution — manual review recommended',
    repName: extractRepName(rawText),
    referenceNumber: extractReferenceNumber(fullText),
    transcriptUrl,
    durationSeconds,
    carrierBlockDetected: false,
  };
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract a rep name from transcript text.
 * Looks for patterns like "my name is Jane", "this is John speaking".
 */
function extractRepName(text: string): string | null {
  const patterns = [
    /(?:my name is|this is|you(?:'re|\s+are) speaking with)\s+([A-Za-z]+)/i,
    /representative[:\s]+([A-Za-z]+)/i,
    /agent[:\s]+([A-Za-z]+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/**
 * Extract a reference / confirmation number from transcript text.
 */
function extractReferenceNumber(text: string): string | null {
  const patterns = [
    /(?:reference|confirmation|case|ticket)\s+(?:number\s+)?(?:is\s+)?([A-Z0-9]{5,15})/i,
    /\b([A-Z]{2,4}\d{6,12})\b/,  // e.g. SL20241234, REF2024ABC
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

export const outcomeProcessor = {
  classifyOutcome,
} as const;

export default outcomeProcessor;
