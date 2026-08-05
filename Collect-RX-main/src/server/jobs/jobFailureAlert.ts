/**
 * Pure decision logic for worker.on('failed') in workerEntry.ts, pulled out
 * so it's unit-testable without booting the real BullMQ Worker (which opens
 * a live Redis connection at import time and isn't safe to exercise in CI).
 */
export function shouldAlertOnJobExhaustion(attemptsMade: number, attemptsAllowed: number): boolean {
  return attemptsMade >= attemptsAllowed;
}

export function buildJobFailureAlertDetail(
  jobName: string,
  jobId: string | undefined,
  attemptsMade: number,
  attemptsAllowed: number,
  errorMessage: string,
): string {
  return `job=${jobName} id=${jobId ?? 'unknown'} attempts=${attemptsMade}/${attemptsAllowed} error=${errorMessage}`;
}
