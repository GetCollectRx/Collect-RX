/**
 * Automated identifier and tenant-fingerprint scan for lesson text. It runs on
 * every extracted lesson before the lesson can be stored as PROPOSED (policy
 * research PS section 4, synthesis F12). The model is instructed not to emit
 * identifiers, and this scan is the enforcement that does not depend on the
 * model complying.
 *
 * A failed scan returns a reason code only. The matched text is never returned
 * or logged, because that text is exactly what must not be stored.
 *
 * Name detection is pattern based and will over-reject: two capitalized words
 * in a row are treated as a probable personal name unless they appear in the
 * allowlist below. Over-rejection costs a lesson. Under-rejection stores a
 * name, so the bias is deliberate.
 */

export type LessonScanReasonCode =
  | 'PRACTICE_FINGERPRINT'
  | 'DIGIT_RUN'
  | 'DATE'
  | 'PHONE'
  | 'EMAIL'
  | 'PERSON_NAME_PATTERN';

export type LessonScanResult = { ok: true } | { ok: false; reasonCode: LessonScanReasonCode };

/** Capitalized pairs that are carrier, product or process names, not people. */
const ALLOWED_CAPITALIZED_PAIRS: ReadonlySet<string> = new Set([
  'sun life',
  'canada life',
  'green shield',
  'royal bank',
  'telus adjudicare',
  'claim status',
  'claims department',
  'provider line',
  'fax number',
  'reference number',
  'hold music',
  'voice mail',
  'customer service',
]);

const DIGIT_RUN = /\d{6,}/;
const DATE = /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b/;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const CAPITALIZED_PAIR = /\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g;
const HONORIFIC_NAME = /\b(?:Mr|Mrs|Ms|Dr)\.?\s+[A-Z][a-z]{2,}\b/;

function normalizeSpaces(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * @param fingerprintTerms Normalized practice identifiers (see learningPolicy.ts).
 */
export function scanLessonText(text: string, fingerprintTerms: readonly string[]): LessonScanResult {
  const normalized = normalizeSpaces(text);
  const digitsOnly = text.replace(/\D/g, '');
  for (const term of fingerprintTerms) {
    if (/^\d+$/.test(term)) {
      if (digitsOnly.includes(term)) return { ok: false, reasonCode: 'PRACTICE_FINGERPRINT' };
    } else if (normalized.includes(term)) {
      return { ok: false, reasonCode: 'PRACTICE_FINGERPRINT' };
    }
  }

  if (DIGIT_RUN.test(text)) return { ok: false, reasonCode: 'DIGIT_RUN' };
  if (DATE.test(text)) return { ok: false, reasonCode: 'DATE' };
  if (PHONE.test(text)) return { ok: false, reasonCode: 'PHONE' };
  if (EMAIL.test(text)) return { ok: false, reasonCode: 'EMAIL' };
  if (HONORIFIC_NAME.test(text)) return { ok: false, reasonCode: 'PERSON_NAME_PATTERN' };

  for (const match of text.matchAll(CAPITALIZED_PAIR)) {
    const pair = normalizeSpaces(`${match[1] ?? ''} ${match[2] ?? ''}`);
    if (!ALLOWED_CAPITALIZED_PAIRS.has(pair)) return { ok: false, reasonCode: 'PERSON_NAME_PATTERN' };
  }

  return { ok: true };
}
