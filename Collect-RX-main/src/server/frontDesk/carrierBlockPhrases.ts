const CARRIER_BLOCK_PHRASES = [
  'automated',
  'bot',
  'system detected',
  'not a live agent',
  'cannot process automated',
  'fraud detection',
  'call flagged',
] as const;

export function transcriptSignalsCarrierBlock(text: string): boolean {
  const lower = text.toLowerCase();
  return CARRIER_BLOCK_PHRASES.some((p) => lower.includes(p));
}

export function matchedCarrierBlockPhrase(text: string): string | null {
  const lower = text.toLowerCase();
  for (const p of CARRIER_BLOCK_PHRASES) {
    if (lower.includes(p)) return p;
  }
  return null;
}
