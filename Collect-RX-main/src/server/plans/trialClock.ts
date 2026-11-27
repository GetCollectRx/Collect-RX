/**
 * B-14: when the trial clock should run from. Today it starts at signup, while
 * carrier authorization can take longer than the trial. `trialEndOnReady`
 * returns the new end date the first time a practice becomes dial-ready, or
 * null when no change applies. Not wired in: enabling it is a billing decision.
 */
export function trialEndOnReady(input: {
  currentTrialEnd: Date | null;
  readyAt: Date;
  trialDays: number;
  alreadyStarted: boolean;
}): Date | null {
  if (input.alreadyStarted) return null;
  const proposed = new Date(input.readyAt.getTime() + input.trialDays * 24 * 3600 * 1000);
  if (input.currentTrialEnd && input.currentTrialEnd >= proposed) return null; // never shorten
  return proposed;
}
