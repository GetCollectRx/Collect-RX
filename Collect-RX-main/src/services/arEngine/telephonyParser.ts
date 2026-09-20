// ─────────────────────────────────────────────────────────────────────────────
// CollectRx AR Engine — Telephony Transcript Parsing
//
// Carrier IVR transcripts are noisy: hold music cues, repeated "your call is
// important to us" loops, and disclaimers surround the handful of tokens that
// actually matter (claim numbers, member/client IDs, dollar amounts). This
// module extracts those tokens deterministically with regex, not an LLM —
// a carrier reading a reference number aloud must not be reinterpreted by a
// second model that can hallucinate a different number.
//
// Division of labour with the rest of the codebase (do not duplicate these):
//   - Outcome classification (RESOLVED/DENIED/PENDING/...), rep-name
//     extraction, and reference-number extraction already live in
//     `src/outcome/processor.ts` (`classifyOutcome`, `extractRepName`,
//     `extractReferenceNumber`). This module is for the fields that
//     processor.ts does not pull out: claim numbers, member/client IDs, and
//     itemized dollar amounts.
//   - Carrier-block phrase detection lives in
//     `src/server/frontDesk/carrierBlockPhrases.ts`.
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Noise stripping
// ---------------------------------------------------------------------------

/** Bracketed audio-event tags Vapi/Twilio transcripts commonly emit. */
const NOISE_TAG_PATTERN = /\[(?:music|hold music|silence|background noise|inaudible|crosstalk|dtmf|beep)\]/gi;

/** Stock IVR hold phrases that add no information and often repeat in loops. */
const HOLD_FILLER_PATTERNS: RegExp[] = [
  /your call is important to us\.?/gi,
  /please (?:continue to )?hold(?: the line)?\.?/gi,
  /(?:all|our) (?:representatives|agents) are (?:currently )?(?:busy|assisting other callers)\.?/gi,
  /your (?:estimated |approximate )?wait time is [^.]*\./gi,
  /thank you for your patience\.?/gi,
];

/**
 * Remove hold-music cues and stock IVR filler, then collapse the repeated
 * consecutive lines that a hold loop produces (the same disclaimer read
 * every 30 seconds is one fact, not N facts) and normalize whitespace.
 */
export function stripNoiseSegments(rawText: string): string {
  let text = rawText.replace(NOISE_TAG_PATTERN, ' ');
  for (const pattern of HOLD_FILLER_PATTERNS) {
    text = text.replace(pattern, ' ');
  }

  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);

  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] !== line) {
      deduped.push(line);
    }
  }

  return deduped.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Claim number extraction
// ---------------------------------------------------------------------------

const CLAIM_NUMBER_PATTERNS: RegExp[] = [
  /claim\s*(?:number|#|no\.?)\s*(?:is\s*)?:?\s*([A-Z]{0,4}[- ]?\d{5,15})/gi,
  /\b([A-Z]{2,4}-?\d{6,12})\b/gi,
];

export function extractClaimNumbers(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of CLAIM_NUMBER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value) found.add(value.replace(/\s+/g, '').toUpperCase());
    }
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Member / client / subscriber ID extraction
// ---------------------------------------------------------------------------

const MEMBER_ID_PATTERNS: RegExp[] = [
  /(?:member|client|subscriber|certificate)\s*(?:id|number|no\.?)\s*(?:is\s*)?:?\s*([A-Z0-9]{5,20})/gi,
  /(?:group|policy)\s*(?:number|no\.?)\s*(?:is\s*)?:?\s*([A-Z0-9]{3,15})/gi,
];

export function extractMemberOrClientIds(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of MEMBER_ID_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value) found.add(value.toUpperCase());
    }
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Financial totals
// ---------------------------------------------------------------------------

export type FinancialAmountLabel = 'billed' | 'covered' | 'patient_responsibility' | 'unknown';

export interface ExtractedFinancialAmount {
  raw: string;
  cents: number;
  label: FinancialAmountLabel;
}

const DOLLAR_AMOUNT_PATTERN = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/g;

const LABEL_KEYWORDS: Array<{ label: FinancialAmountLabel; pattern: RegExp }> = [
  { label: 'covered', pattern: /(?:covered|approved|paid|reimburs\w*)\s+amount/i },
  { label: 'billed', pattern: /(?:billed|total|claim)\s+amount/i },
  { label: 'patient_responsibility', pattern: /(?:patient|your)\s+(?:portion|responsibility|balance)/i },
];

/**
 * Look back up to `windowChars` before the match for a labelling keyword,
 * preferring whichever keyword sits closest to the amount — a transcript
 * commonly states several amounts in sequence ("billed amount $900, patient
 * portion $100"), and the nearest label is the correct one even when an
 * earlier, unrelated label also appears in the window.
 */
function labelForContext(text: string, matchIndex: number, windowChars = 60): FinancialAmountLabel {
  const start = Math.max(0, matchIndex - windowChars);
  const context = text.slice(start, matchIndex);

  let best: { label: FinancialAmountLabel; index: number } | null = null;
  for (const { label, pattern } of LABEL_KEYWORDS) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const globalPattern = new RegExp(pattern.source, flags);
    for (const match of context.matchAll(globalPattern)) {
      if (match.index !== undefined && (!best || match.index > best.index)) {
        best = { label, index: match.index };
      }
    }
  }
  return best?.label ?? 'unknown';
}

function dollarStringToCents(raw: string): number {
  const normalized = raw.replace(/,/g, '');
  return Math.round(Number(normalized) * 100);
}

/**
 * Extract itemized dollar amounts with a best-effort label inferred from
 * nearby wording. Deliberately regex-only (per file header) — spoken-number
 * parsing ("one thousand two hundred dollars") is out of scope because it
 * cannot be validated deterministically against what the carrier actually
 * said.
 */
export function extractFinancialTotals(text: string): ExtractedFinancialAmount[] {
  const results: ExtractedFinancialAmount[] = [];
  for (const match of text.matchAll(DOLLAR_AMOUNT_PATTERN)) {
    const raw = match[1];
    if (raw === undefined || match.index === undefined) continue;
    results.push({
      raw: `$${raw}`,
      cents: dollarStringToCents(raw),
      label: labelForContext(text, match.index),
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Top-level pipeline
// ---------------------------------------------------------------------------

export interface TelephonyExtraction {
  cleanedText: string;
  claimNumbers: string[];
  memberOrClientIds: string[];
  financialTotals: ExtractedFinancialAmount[];
}

export function parseTelephonyTranscript(rawText: string): TelephonyExtraction {
  const cleanedText = stripNoiseSegments(rawText);
  return {
    cleanedText,
    claimNumbers: extractClaimNumbers(cleanedText),
    memberOrClientIds: extractMemberOrClientIds(cleanedText),
    financialTotals: extractFinancialTotals(cleanedText),
  };
}

export const telephonyParser = {
  stripNoiseSegments,
  extractClaimNumbers,
  extractMemberOrClientIds,
  extractFinancialTotals,
  parseTelephonyTranscript,
} as const;

export default telephonyParser;
