/**
 * Payer name normalization for non-dental claims.
 *
 * Non-dental exports carry the payer as free text (InsuranceClaim.payerName),
 * so the same insurer arrives as "INTACT INS.", "Intact Insurance Inc." and
 * "Intact". Grouping by a normalized key lets the worklist and the AR summary
 * show one row per payer.
 *
 * The rules are deliberately conservative: only trailing legal suffixes and
 * the generic word "insurance" (and its abbreviations) are dropped, plus a
 * leading "the". Words that can distinguish two different payers (life,
 * general, mutual, a place name in the middle) are kept. A wrong merge would
 * hide a payer's balance inside another's, which is worse than a missed one.
 *
 * No payer contact data lives here. Dialling a non-dental payer needs a
 * verified number per payer, which does not exist yet.
 */

const UNKNOWN_PAYER_KEY = 'unknown';

/** Trailing tokens removed repeatedly. Order does not matter. */
const TRAILING_DROP = new Set([
  'inc',
  'incorporated',
  'ltd',
  'limited',
  'ltee',
  'corp',
  'corporation',
  'co',
  'company',
  'llc',
  'lp',
  'llp',
  'insurance',
  'ins',
  'insur',
  'assurance',
  'assurances',
  'insurer',
]);

/** "of canada" / "canada" only as a trailing phrase: "Canada Life" must stay intact. */
const TRAILING_PHRASES: ReadonlyArray<readonly string[]> = [['of', 'canada'], ['canada']];

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/gu, '');
}

function tokens(raw: string): string[] {
  return stripAccents(raw)
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 0);
}

function endsWith(words: string[], phrase: readonly string[]): boolean {
  if (phrase.length >= words.length) return false;
  return phrase.every((p, i) => words[words.length - phrase.length + i] === p);
}

/**
 * Stable grouping key for a payer name. Empty or unusable input maps to
 * "unknown" so those claims still group together instead of disappearing.
 */
export function normalizePayerKey(raw: string | null | undefined): string {
  if (!raw) return UNKNOWN_PAYER_KEY;
  let words = tokens(raw);
  if (words[0] === 'the' && words.length > 1) words = words.slice(1);

  let changed = true;
  while (changed && words.length > 1) {
    changed = false;
    const last = words[words.length - 1];
    if (last !== undefined && TRAILING_DROP.has(last)) {
      words = words.slice(0, -1);
      changed = true;
      continue;
    }
    for (const phrase of TRAILING_PHRASES) {
      if (endsWith(words, phrase)) {
        words = words.slice(0, words.length - phrase.length);
        changed = true;
        break;
      }
    }
  }
  const key = words.join(' ');
  return key.length > 0 ? key : UNKNOWN_PAYER_KEY;
}

/**
 * The display name for a group: the raw spelling seen most often, ties broken
 * by the longest (usually the most complete) spelling, then alphabetically so
 * the result never depends on row order.
 */
export function pickPayerDisplayName(spellings: ReadonlyArray<string>): string {
  const counts = new Map<string, number>();
  for (const s of spellings) {
    const trimmed = s.trim();
    if (trimmed) counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]),
  );
  return ranked[0]?.[0] ?? 'Unknown payer';
}

export { UNKNOWN_PAYER_KEY };
