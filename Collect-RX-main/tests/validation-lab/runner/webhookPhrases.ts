/** Synthetic carrier phrases for the webhook bindings. In memory only; the runner test proves none reaches an artifact. */
export const PHRASES = {
  paidWithRef: 'The payment was processed yesterday. The reference number is SL20260001.',
  paidNoRef: 'The payment was processed yesterday.',
  pending: 'The claim is still in process. Please allow 10 business days.',
  deniedWithRef: 'The claim has been denied by the carrier. The reference number is SL20260017.',
  pastFilingLimit: 'The claim is past the 90 day filing limit and cannot be paid.',
  blockAutomated: 'We are unable to process automated calls on this line.',
} as const;

export function claimStatusPhrasesForLeakCheck(): readonly string[] {
  return Object.values(PHRASES);
}
