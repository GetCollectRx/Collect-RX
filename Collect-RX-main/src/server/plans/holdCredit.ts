/**
 * B-23: minutes a practice should not pay for because we lost the call, not
 * the carrier or the practice. Conservative: only calls that reached a rep
 * path and were dumped after a long hold count. Credits are proposed, not
 * applied; applying them is a billing decision.
 */
export function creditableMinutes(attempts: Array<{ heldThenDumped: boolean; minutesBilled: number | null }>): number {
  return attempts.reduce((s, a) => s + (a.heldThenDumped ? (a.minutesBilled ?? 0) : 0), 0);
}
