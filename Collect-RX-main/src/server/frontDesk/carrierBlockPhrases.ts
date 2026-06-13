// Baseline phrases — validated, tested, hardcoded. Never remove from here.
// The self-tuner may add new phrases to the learned-rules/block-phrases.json
// overlay; those are merged in at startup via getActiveBlockPhrases().
const CARRIER_BLOCK_PHRASES_BASELINE = [
  'automated',
  'bot',
  'system detected',
  'not a live agent',
  'cannot process automated',
  'fraud detection',
  'call flagged',
] as const;

// Runtime-merged phrase list (baseline + self-tuner learned phrases)
let _activeBlockPhrases: readonly string[] = CARRIER_BLOCK_PHRASES_BASELINE;
let _learnedLoaded = false;

/**
 * Load learned block phrases from the self-tuner overlay and merge with baseline.
 * Called once at server startup. Safe to call multiple times (idempotent after first load).
 */
export function loadLearnedBlockPhrasesIntoRuntime(learnedPhrases: string[]): void {
  const merged = Array.from(new Set([...CARRIER_BLOCK_PHRASES_BASELINE, ...learnedPhrases]));
  _activeBlockPhrases = merged;
  _learnedLoaded = true;
  if (learnedPhrases.length > 0) {
    console.log(`[carrierBlockPhrases] Loaded ${learnedPhrases.length} learned phrase(s) from self-tuner`);
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
  _learnedLoaded = false;
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
