// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Telephony Transcript Parser
//
// Carrier phone transcripts (Vapi's speech-to-text over 8kHz PSTN/VoIP audio)
// carry hold-music captions, IVR filler, and disfluencies alongside the two or
// three sentences that actually matter: the claim number the rep confirms,
// the member/subscriber ID they read back, and the dollar figures they quote.
// This module's job is structural extraction of those tokens from raw text —
// it does not classify call outcome or extract rep names/reference numbers,
// which already live in `../../outcome/processor.ts`. Feed its output into
// `schemas.ts`'s per-carrier parsers to build a validated adjudication
// payload; don't duplicate this logic there.
//
// Extraction is regex-based, not NLP — Canadian carrier reps read structured
// fields ("claim number is...", "the amount covered is...") in fairly
// consistent phrasing, so pattern matching is both cheaper and more
// auditable than an LLM re-parse of PHI-adjacent transcript text.
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Noise filtering
// ---------------------------------------------------------------------------

/** Vapi/Twilio caption artifacts for non-speech audio — hold music, silence, DTMF tones. */
const NOISE_ARTIFACT_PATTERNS: RegExp[] = [
  /\[(?:music|hold music|silence|inaudible|background noise|dtmf|beep|ringing)\]/gi,
  /\((?:music|hold music|silence|inaudible|background noise|dtmf|beep|ringing)\)/gi,
  /\b(?:um+|uh+|erm+)\b,?/gi,
];

/**
 * Strip hold-music captions, silence markers, and filler words so downstream
 * regexes match against the spoken content only. Idempotent — safe to call
 * on already-stripped text.
 */
export function stripNoiseArtifacts(rawText: string): string {
  let text = rawText;
  for (const pattern of NOISE_ARTIFACT_PATTERNS) {
    text = text.replace(pattern, ' ');
  }
  return text.replace(/\s{2,}/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Claim number extraction
//
// Practice-assigned claim numbers are already known before the call
// (`InsuranceClaim.claimNumber`) — this extracts what the *carrier* reads
// back, so a mismatch can be flagged instead of silently trusted.
// ---------------------------------------------------------------------------

const CLAIM_NUMBER_PATTERNS: RegExp[] = [
  /claim\s+(?:number|#|no\.?)\s*(?:is\s*)?:?\s*([A-Z0-9][A-Z0-9-]{4,19})/i,
  /(?:claim|file)\s+id\s*:?\s*([A-Z0-9][A-Z0-9-]{4,19})/i,
];

export function extractClaimNumber(text: string): string | null {
  const clean = stripNoiseArtifacts(text);
  for (const pattern of CLAIM_NUMBER_PATTERNS) {
    const match = clean.match(pattern);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Client / member / subscriber ID extraction
//
// This is PHI-adjacent (subscriber/certificate numbers) — the extracted
// value must flow straight into `tokenizer.ts`/PIIVault, never into a log
// line or a DB column outside `phi_vault_entries`.
// ---------------------------------------------------------------------------

const CLIENT_ID_PATTERNS: RegExp[] = [
  /(?:member|client|subscriber|certificate|policy)\s+(?:id|number|#)\s*(?:is\s*)?:?\s*([A-Z0-9][A-Z0-9-]{4,19})/i,
  /group\s+(?:number|#)\s*(?:is\s*)?:?\s*([A-Z0-9][A-Z0-9-]{2,19})/i,
];

export function extractClientId(text: string): string | null {
  const clean = stripNoiseArtifacts(text);
  for (const pattern of CLIENT_ID_PATTERNS) {
    const match = clean.match(pattern);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Financial totals
// ---------------------------------------------------------------------------

export interface FinancialMention {
  /** What the surrounding phrase suggests this figure represents. */
  label: 'covered' | 'billed' | 'patient_portion' | 'deductible' | 'unspecified';
  amountCents: number;
  /** The exact substring matched, for audit/debugging — not persisted as PHI. */
  rawMatch: string;
}

// Requires an explicit `$` prefix or a trailing "dollars" — a bare number is
// too easily a claim number, ID, or phone-number fragment to treat as money.
const DOLLAR_AMOUNT_RE =
  /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)|\b(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*dollars\b/gi;

const LABEL_WINDOW_PATTERNS: Array<{ label: FinancialMention['label']; pattern: RegExp }> = [
  { label: 'covered', pattern: /(?:amount\s+)?covered|insurance\s+(?:paid|pays)|we('| wi)ll\s+(?:cover|pay)/i },
  { label: 'billed', pattern: /billed|total\s+(?:charge|fee|cost)|amount\s+submitted/i },
  { label: 'patient_portion', pattern: /patient\s+(?:portion|responsibility|owes)|out.of.pocket/i },
  { label: 'deductible', pattern: /deductible/i },
];

function labelFor(context: string): FinancialMention['label'] {
  for (const { label, pattern } of LABEL_WINDOW_PATTERNS) {
    if (pattern.test(context)) return label;
  }
  return 'unspecified';
}

/**
 * Extract every dollar figure mentioned, with a best-effort label inferred
 * from the ~40 characters preceding the match (e.g. "the amount covered is
 * $340.00" -> label "covered"). Amounts are returned in cents to match the
 * `_cents` integer convention used across `InsuranceClaim`/`AdjudicationEvent`.
 */
export function extractFinancialTotals(text: string): FinancialMention[] {
  const clean = stripNoiseArtifacts(text);
  const mentions: FinancialMention[] = [];
  let match: RegExpExecArray | null;
  DOLLAR_AMOUNT_RE.lastIndex = 0;
  while ((match = DOLLAR_AMOUNT_RE.exec(clean)) !== null) {
    const numeric = match[1] ?? match[2];
    if (!numeric) continue;
    const amount = Number(numeric.replace(/,/g, ''));
    if (!Number.isFinite(amount)) continue;
    const contextStart = Math.max(0, match.index - 40);
    const context = clean.slice(contextStart, match.index);
    mentions.push({
      label: labelFor(context),
      amountCents: Math.round(amount * 100),
      rawMatch: match[0].trim(),
    });
  }
  return mentions;
}

// ---------------------------------------------------------------------------
// Combined extraction
// ---------------------------------------------------------------------------

export interface TelephonyExtraction {
  cleanedText: string;
  claimNumber: string | null;
  clientId: string | null;
  financialMentions: FinancialMention[];
}

export function parseTelephonyTranscript(rawText: string): TelephonyExtraction {
  const cleanedText = stripNoiseArtifacts(rawText);
  return {
    cleanedText,
    claimNumber: extractClaimNumber(cleanedText),
    clientId: extractClientId(cleanedText),
    financialMentions: extractFinancialTotals(cleanedText),
  };
}
