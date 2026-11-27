export interface AttemptForReport {
  isHumanAssisted: boolean;
  staffHandoffAt: Date | null;
  durationSeconds: number | null;
  outcome: string | null;
  outcomeDetail: string | null;
  claimId: string;
}

export interface ValueReport {
  attempts: number;
  handoffs: number;
  holdMinutesSaved: number;
  claimsTouched: number;
  logsReceived: number;
  needsReview: number;
}

const NO_LOG_MARKER = 'no call log was received';

/**
 * Leading indicators a practice can see in week one while payments lag (B-16).
 * Hold minutes saved counts only calls that reached a live rep and were handed
 * to staff, because that is the wait staff did not sit through. Calls that
 * ended without a handoff saved nothing and are not counted.
 */
export function buildValueReport(attempts: AttemptForReport[]): ValueReport {
  const handed = attempts.filter((a) => a.isHumanAssisted && a.staffHandoffAt);
  const noLog = handed.filter((a) => (a.outcomeDetail ?? '').includes(NO_LOG_MARKER));
  const seconds = handed.reduce((s, a) => s + (a.durationSeconds ?? 0), 0);
  return {
    attempts: attempts.length,
    handoffs: handed.length,
    holdMinutesSaved: Math.round(seconds / 60),
    claimsTouched: new Set(attempts.map((a) => a.claimId)).size,
    logsReceived: handed.length - noLog.length,
    needsReview: noLog.length,
  };
}
