// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Outcome Processor
//
// Classifies the result of a Vapi call completion event into a canonical
// CallOutcome enum. Also detects carrier block signals — the highest-risk
// operational event. If a block is detected, `carrierBlockDetected: true`
// is returned and the caller MUST fire the CARRIER_BLOCK suspension protocol.
//
// Transcript classification mirrors `processor.legacy.cjs` keyword ladder
// (same substring checks and order), then falls back to regex buckets for
// outcomes the legacy list does not cover.
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
// Block signal patterns (regex)
//
// These are phrases carriers use when they detect automated/bot behaviour.
// Add to this list as new signals are observed in production transcripts.
// ---------------------------------------------------------------------------

const BLOCK_SIGNAL_PATTERNS: RegExp[] = [
  /(?:automated|bot|robocall)\s+(?:calls?\s+)?(?:are\s+)?not\s+(?:allowed|permitted|accepted)/i,
  /we('re|\sare)\s+unable\s+to\s+process\s+automated\s+calls?/i,
  /robocall\s+detected/i,
  /third.party\s+(calling|system)\s+not\s+(allowed|permitted)/i,
  /cannot\s+assist\s+with\s+automated\s+calls/i,
  /this\s+number\s+has\s+been\s+flagged/i,
  /call\s+appears\s+to\s+be\s+automated/i,
  /provider\s+(access|calling)\s+(blocked|suspended|restricted)/i,
  /system.generated\s+call\s+(?:detected|blocked|rejected)/i,
  /bot\s+activity(\s+detected)?/i,
  /detected\s+bot\s+activity/i,
  /(?:end|stop)\s+this\s+call.*(?:automated|dialers|auto-dialer)/i,
  /(?:fraud|security)\s+team.*(?:before|before we)/i,
  /compliance\s+team.*(?:not\s+)?(?:speak|talk).*(?:auto-dialer|automated)/i,
  /(?:isn't|is\s+not)\s+a\s+real\s+person/i,
  /remove\s+this\s+line.*(?:calling|calling system).*(?:will\s+)?not\s+answer/i,
];

/** Literal phrases from `processor.legacy.cjs` (carrier_block branch). */
const LEGACY_CARRIER_BLOCK_INCLUDES = [
  'carrier_block',
  'your calls are being blocked',
  'automated calling is not permitted',
  'this number has been flagged',
  'call blocking',
  'number is blocked',
  'please do not call again',
  'calls from this number will not be accepted',
] as const;

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

// Escalation triggers (regex — supplements legacy `appeal_required` keywords)
const ESCALATION_PATTERNS: RegExp[] = [
  /speak\s+(with\s+)?a\s+supervisor/i,
  /dispute\s+(this\s+)?claim/i,
  /appeals\s+(department|process)/i,
  /formal\s+complaint/i,
];

// ---------------------------------------------------------------------------
// Legacy mirror — same order as `processor.legacy.cjs` classifyOutcome()
// ---------------------------------------------------------------------------

/**
 * Returns a legacy outcome code, or `null` when the legacy classifier would
 * return `"unknown"`.
 */
function matchLegacyTranscript(fullText: string): string | null {
  if (!fullText.trim()) return null;

  if (
    fullText.includes('payment issued') ||
    fullText.includes('cheque has been sent') ||
    fullText.includes('eft processed') ||
    fullText.includes('payment was processed') ||
    fullText.includes('payment sent')
  ) {
    return 'paid';
  }

  if (
    fullText.includes('still processing') ||
    fullText.includes('under review') ||
    fullText.includes('in adjudication') ||
    fullText.includes('being processed') ||
    fullText.includes('processing time') ||
    fullText.includes('5 to 10 business days') ||
    fullText.includes('7 to 10 business days')
  ) {
    return 'processing';
  }

  if (
    fullText.includes('not on file') ||
    fullText.includes('no claim found') ||
    fullText.includes('not received') ||
    fullText.includes('please resubmit') ||
    fullText.includes('not in our system')
  ) {
    return 'resubmit_required';
  }

  if (
    fullText.includes('x-ray') ||
    fullText.includes('xray') ||
    fullText.includes('radiograph') ||
    fullText.includes('imaging required') ||
    (fullText.includes('supporting documentation') && fullText.includes('radiograph'))
  ) {
    return 'xray_required';
  }

  if (
    fullText.includes('clinical notes') ||
    fullText.includes('chart notes') ||
    fullText.includes('treatment notes required') ||
    fullText.includes('documentation required') ||
    fullText.includes('predetermination required')
  ) {
    return 'docs_required';
  }

  if (
    fullText.includes('maximum benefit') ||
    fullText.includes('annual maximum') ||
    fullText.includes('benefit limit') ||
    fullText.includes('maximum has been reached') ||
    fullText.includes('no remaining benefit')
  ) {
    return 'coverage_maxed';
  }

  if (
    fullText.includes('not a covered') ||
    fullText.includes('not covered') ||
    fullText.includes('excluded procedure') ||
    fullText.includes('not eligible') ||
    fullText.includes('not a benefit')
  ) {
    return 'not_covered';
  }

  if (
    fullText.includes('appeal') ||
    fullText.includes('reconsideration') ||
    fullText.includes('dispute') ||
    fullText.includes('internal review')
  ) {
    return 'appeal_required';
  }

  if (
    fullText.includes('no answer') ||
    fullText.includes('busy signal') ||
    fullText.includes('hold timeout') ||
    fullText.includes('call dropped') ||
    fullText.includes('could not connect')
  ) {
    return 'no_answer';
  }

  for (const phrase of LEGACY_CARRIER_BLOCK_INCLUDES) {
    if (fullText.includes(phrase)) return 'carrier_block';
  }

  return null;
}

function legacyCodeToProcessedOutcome(
  code: string,
  rawText: string,
  fullText: string,
  transcriptUrl: string | null,
  durationSeconds: number | null,
): ProcessedOutcome {
  const base = {
    repName: extractRepName(rawText),
    referenceNumber: extractReferenceNumber(fullText),
    transcriptUrl,
    durationSeconds,
  };

  switch (code) {
    case 'paid':
      return {
        ...base,
        outcome: 'RESOLVED',
        outcomeDetail: 'Payment confirmed by carrier (legacy: paid)',
        carrierBlockDetected: false,
      };
    case 'processing':
      return {
        ...base,
        outcome: 'PENDING',
        outcomeDetail: 'Claim still processing (legacy: processing)',
        carrierBlockDetected: false,
      };
    case 'resubmit_required':
      return {
        ...base,
        outcome: 'ESCALATED',
        outcomeDetail:
          'Claim not on file or not received — resubmission required (legacy: resubmit_required)',
        carrierBlockDetected: false,
      };
    case 'xray_required':
      return {
        ...base,
        outcome: 'ESCALATED',
        outcomeDetail:
          'Carrier requires radiographic / imaging documentation — clinic staff action (legacy: xray_required)',
        carrierBlockDetected: false,
      };
    case 'docs_required':
      return {
        ...base,
        outcome: 'ESCALATED',
        outcomeDetail:
          'Carrier requires additional clinical documentation (legacy: docs_required)',
        carrierBlockDetected: false,
      };
    case 'coverage_maxed':
      return {
        ...base,
        outcome: 'DENIED',
        outcomeDetail: 'Annual maximum or benefit limit reached (legacy: coverage_maxed)',
        carrierBlockDetected: false,
      };
    case 'not_covered':
      return {
        ...base,
        outcome: 'DENIED',
        outcomeDetail: 'Procedure not covered or not eligible (legacy: not_covered)',
        carrierBlockDetected: false,
      };
    case 'appeal_required':
      return {
        ...base,
        outcome: 'ESCALATED',
        outcomeDetail: 'Appeal, dispute, or internal review path (legacy: appeal_required)',
        carrierBlockDetected: false,
      };
    case 'no_answer':
      return {
        ...base,
        outcome: 'NO_ANSWER',
        outcomeDetail: 'IVR / connection issue noted in transcript (legacy: no_answer)',
        carrierBlockDetected: false,
      };
    case 'carrier_block':
      return {
        ...base,
        outcome: 'BLOCK_DETECTED',
        outcomeDetail: 'Carrier blocking or rejecting calls (legacy: carrier_block)',
        carrierBlockDetected: true,
      };
    default:
      return {
        ...base,
        outcome: 'HUNG_UP',
        outcomeDetail: 'Call ended without clear resolution — manual review recommended',
        carrierBlockDetected: false,
      };
  }
}

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
  // Use transcript if available; fall back to summary only if transcript is empty.
  // This prevents LLM-generated summaries from hallucinating financial outcomes when we have a real transcript,
  // but allows fallback classification when no transcript exists.
  const rawText = transcript.trim() ? transcript : (payload.analysis?.summary ?? '');
  /** Lowercased — used for all pattern matching */
  const fullText = rawText.toLowerCase();

  const durationSeconds = payload.call.durationSeconds ?? null;
  const transcriptUrl = payload.recordingUrl ?? null;

  // ── Automation / bot block (regex only — not in legacy substring list) ───
  if (BLOCK_SIGNAL_PATTERNS.some((p) => p.test(fullText))) {
    return {
      outcome: 'BLOCK_DETECTED',
      outcomeDetail:
        'Carrier detected automation — CARRIER_BLOCK protocol must fire immediately',
      repName: null,
      referenceNumber: extractReferenceNumber(fullText),
      transcriptUrl,
      durationSeconds,
      carrierBlockDetected: true,
    };
  }

  // ── Failed / no connection ────────────────────────────────────────────────
  if (payload.call.status === 'failed' || durationSeconds === 0) {
    return {
      outcome: 'FAILED',
      outcomeDetail:
        payload.call.status === 'failed' ? 'Call failed to connect' : 'Zero-duration call',
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

  // ── Legacy keyword ladder (mirrors processor.legacy.cjs) ─────────────────
  const legacyCode = matchLegacyTranscript(fullText);
  if (legacyCode !== null) {
    return legacyCodeToProcessedOutcome(legacyCode, rawText, fullText, transcriptUrl, durationSeconds);
  }

  // ── Regex fallbacks (legacy: unknown) ─────────────────────────────────────
  if (!fullText.trim()) {
    return {
      outcome: 'HUNG_UP',
      outcomeDetail: 'No transcript or summary — manual review (legacy: unknown)',
      repName: null,
      referenceNumber: null,
      transcriptUrl,
      durationSeconds,
      carrierBlockDetected: false,
    };
  }

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
    /\b([A-Z]{2,4}\d{6,12})\b/, // e.g. SL20241234, REF2024ABC
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
