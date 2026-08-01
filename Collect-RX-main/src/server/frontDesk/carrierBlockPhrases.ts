// Baseline phrases require a carrier action or detection statement. Generic
// IVR language such as "automated system" or "bot menu" is not a block signal.
// The self-tuner may add new phrases to the learned-rules/block-phrases.json
// overlay; those are merged in at startup via getActiveBlockPhrases().
const CARRIER_BLOCK_PHRASES_BASELINE = [
  'automated calling is not permitted',
  'cannot process automated calls',
  'this sounds like a bot call',
  'bot activity detected',
  'system detected automation',
  'not a live agent',
  'fraud detection',
  'call flagged',
  // Claims_Agent's own CARRIER REFUSAL PROTOCOL (vapi-squad-config.json) names these
  // as its primary refusal trigger, but the baseline never covered the exact wording —
  // the deterministic scanner couldn't catch the case the squad prompt itself anticipates.
  "we don't work with robots",
  "i'm ending this call",
  // Merged from outcome/processor.ts's now-retired LEGACY_CARRIER_BLOCK_INCLUDES
  // (AA-17) — this is the shared source both the live-transcript scanner and the
  // end-of-call outcome classifier check, so a phrase only needs to be added once.
  'your calls are being blocked',
  'this number has been flagged',
  'call blocking',
  'number is blocked',
  'please do not call again',
  'calls from this number will not be accepted',
] as const;

const GENERIC_IVR_TERMS = new Set(['automated', 'bot', 'ivr', 'menu', 'system']);

// Runtime-merged phrase list (baseline + self-tuner learned phrases)
let _activeBlockPhrases: readonly string[] = CARRIER_BLOCK_PHRASES_BASELINE;

/**
 * Load learned block phrases from the self-tuner overlay and merge with baseline.
 * Called once at server startup. Safe to call multiple times (idempotent after first load).
 */
export function loadLearnedBlockPhrasesIntoRuntime(learnedPhrases: string[]): void {
  const safeLearnedPhrases = learnedPhrases.filter((phrase) => {
    const normalized = phrase.trim().toLowerCase();
    return normalized.length > 5 && !GENERIC_IVR_TERMS.has(normalized);
  });
  const merged = Array.from(new Set([...CARRIER_BLOCK_PHRASES_BASELINE, ...safeLearnedPhrases]));
  _activeBlockPhrases = merged;
  if (safeLearnedPhrases.length > 0) {
    console.log(`[carrierBlockPhrases] Loaded ${safeLearnedPhrases.length} learned phrase(s) from self-tuner`);
  }
}

/**
 * Returns the currently active block phrase list (baseline + learned).
 * Exported for testing and introspection.
 */
export function getActiveBlockPhrases(): readonly string[] {
  return _activeBlockPhrases;
}

/**
 * Reset to baseline only (used in tests to prevent cross-test contamination).
 */
export function resetToBaseline(): void {
  _activeBlockPhrases = CARRIER_BLOCK_PHRASES_BASELINE;
}

export function transcriptSignalsCarrierBlock(text: string): boolean {
  const lower = text.toLowerCase();
  return _activeBlockPhrases.some((p) => lower.includes(p));
}

export function matchedCarrierBlockPhrase(text: string): string | null {
  const lower = text.toLowerCase();
  for (const p of _activeBlockPhrases) {
    if (lower.includes(p)) return p;
  }
  return null;
}
