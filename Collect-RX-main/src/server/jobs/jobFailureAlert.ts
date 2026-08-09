import { randomUUID } from 'node:crypto';

/**
 * Reused from job.data if a future enqueue site chooses to propagate one
 * from the HTTP request that triggered it; generated fresh otherwise (the
 * common case — repeatable/scheduled jobs have no originating request).
 * Pulled out as a pure function for the same reason as the rest of this
 * file: unit-testable without booting the real BullMQ Worker.
 */
export function resolveJobCorrelationId(jobData: { correlationId?: string } | undefined): string {
  const existing = jobData?.correlationId;
  return existing && existing.trim() ? existing : randomUUID();
}

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
