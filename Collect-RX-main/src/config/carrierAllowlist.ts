/**
 * Per-tenant, per-payer allowlist for automated dialing of non-dental claims.
 *
 * Default is deny. A non-dental claim (carrierId 'other') is only eligible for
 * automated dialing when an admin has enabled that exact payer for that exact
 * practice AND enough shadow calls have passed review. This module only answers
 * the policy question. Dialing additionally needs a verified payer phone number
 * and IVR config, which live in the Vapi client allowlist, so enabling a flag
 * here never dials anything by itself.
 *
 * Source: NON_DENTAL_DIAL_ALLOWLIST, a JSON array. Malformed input fails closed
 * (nothing allowed) and the parse errors are returned for the caller to log.
 */

export const NON_DENTAL_PAYER_KEYS = [
  'intact',
  'aviva',
  'sun_life',
  'canada_life',
  'desjardins',
  'icbc',
] as const;
export type NonDentalPayerKey = (typeof NON_DENTAL_PAYER_KEYS)[number];

/** Shadow calls (listen-only or staff-supervised) that must pass before enabling. */
export const MIN_SHADOW_CALLS_PASSED = 5;

export interface DialAllowlistEntry {
  practiceId: string;
  payer: NonDentalPayerKey;
  enabled: boolean;
  shadowCallsPassed: number;
  enabledBy: string;
}

export interface DialDecision {
  allowed: boolean;
  reason: 'allowed' | 'payer_unrecognised' | 'no_entry' | 'disabled' | 'insufficient_shadow_calls';
}

const PAYER_PATTERNS: ReadonlyArray<readonly [NonDentalPayerKey, RegExp]> = [
  ['intact', /\bintact\b/],
  ['aviva', /\baviva\b/],
  ['sun_life', /\bsun\s*life\b/],
  ['canada_life', /\bcanada\s*life\b/],
  ['desjardins', /\bdesjardins\b/],
  ['icbc', /\bicbc\b|insurance corporation of british columbia/],
];

/** Maps a free-text payer name from a CSV to an allowlist key, or null when unknown. */
export function payerKeyFromName(payerName: string): NonDentalPayerKey | null {
  const normalised = payerName.toLowerCase();
  for (const [key, pattern] of PAYER_PATTERNS) {
    if (pattern.test(normalised)) return key;
  }
  return null;
}

function isPayerKey(value: unknown): value is NonDentalPayerKey {
  return typeof value === 'string' && (NON_DENTAL_PAYER_KEYS as readonly string[]).includes(value);
}

function toEntry(raw: unknown): DialAllowlistEntry | string {
  if (typeof raw !== 'object' || raw === null) return 'entry is not an object';
  const rec = raw as Record<string, unknown>;
  const { practiceId, payer, enabled, shadowCallsPassed, enabledBy } = rec;
  if (typeof practiceId !== 'string' || practiceId.length === 0) return 'practiceId missing';
  if (!isPayerKey(payer)) return `payer must be one of ${NON_DENTAL_PAYER_KEYS.join(', ')}`;
  if (typeof enabled !== 'boolean') return 'enabled must be boolean';
  if (typeof shadowCallsPassed !== 'number' || !Number.isInteger(shadowCallsPassed) || shadowCallsPassed < 0) {
    return 'shadowCallsPassed must be a non-negative integer';
  }
  if (typeof enabledBy !== 'string' || enabledBy.length === 0) return 'enabledBy missing';
  return { practiceId, payer, enabled, shadowCallsPassed, enabledBy };
}

export function parseDialAllowlist(raw: string | undefined): { entries: DialAllowlistEntry[]; errors: string[] } {
  if (!raw || raw.trim() === '') return { entries: [], errors: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { entries: [], errors: ['NON_DENTAL_DIAL_ALLOWLIST is not valid JSON'] };
  }
  if (!Array.isArray(parsed)) return { entries: [], errors: ['NON_DENTAL_DIAL_ALLOWLIST must be a JSON array'] };
  const entries: DialAllowlistEntry[] = [];
  const errors: string[] = [];
  parsed.forEach((item: unknown, idx) => {
    const result = toEntry(item);
    if (typeof result === 'string') errors.push(`entry ${idx}: ${result}`);
    else entries.push(result);
  });
  // A single bad entry fails the whole list closed so a typo cannot half-apply.
  return errors.length > 0 ? { entries: [], errors } : { entries, errors };
}

export function decideNonDentalDial(
  entries: readonly DialAllowlistEntry[],
  practiceId: string,
  payerName: string,
): DialDecision {
  const payer = payerKeyFromName(payerName);
  if (!payer) return { allowed: false, reason: 'payer_unrecognised' };
  const entry = entries.find((e) => e.practiceId === practiceId && e.payer === payer);
  if (!entry) return { allowed: false, reason: 'no_entry' };
  if (!entry.enabled) return { allowed: false, reason: 'disabled' };
  if (entry.shadowCallsPassed < MIN_SHADOW_CALLS_PASSED) {
    return { allowed: false, reason: 'insufficient_shadow_calls' };
  }
  return { allowed: true, reason: 'allowed' };
}
