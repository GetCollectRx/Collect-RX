/**
 * B-29 (proposal, not yet a decision): how many logged calls per carrier
 * before a playbook is trusted, and the bar for a carrier to graduate to the
 * autonomous squad. The numbers are placeholders for the founder to confirm.
 */
export const PLAYBOOK_THRESHOLDS = {
  minLoggedCalls: 30,
  minDistinctPractices: 3,
  maxUnclearShare: 0.15,
  maxSuspicionFlagShare: 0.02,
} as const;

export interface CarrierLogStats {
  loggedCalls: number;
  distinctPractices: number;
  unclearCount: number;
  suspicionFlagCount: number;
}

export function playbookReadiness(
  s: CarrierLogStats,
  t: typeof PLAYBOOK_THRESHOLDS = PLAYBOOK_THRESHOLDS,
): { trusted: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (s.loggedCalls < t.minLoggedCalls) reasons.push(`Only ${s.loggedCalls} logged calls (need ${t.minLoggedCalls})`);
  if (s.distinctPractices < t.minDistinctPractices) reasons.push(`Only ${s.distinctPractices} practices (need ${t.minDistinctPractices})`);
  const n = Math.max(1, s.loggedCalls);
  if (s.unclearCount / n > t.maxUnclearShare) reasons.push('Too many unclear outcomes');
  if (s.suspicionFlagCount / n > t.maxSuspicionFlagShare) reasons.push('Too many automation-suspicion flags');
  return { trusted: reasons.length === 0, reasons };
}
