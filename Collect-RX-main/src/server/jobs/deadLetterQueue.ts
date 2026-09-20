/**
 * Dead-letter handling for the collectrx-ar BullMQ queue. BullMQ has no
 * built-in DLQ concept — once a job's attempts are exhausted, it just sits
 * in the 'failed' state (subject to removeOnFail eviction). This writes a
 * durable record with full error history before that happens, and provides
 * the retry path an admin uses to re-enqueue it.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';

export interface DeadLetterAttemptError {
  attempt: number;
  error: string;
  /**
   * BullMQ does not retain a timestamp per attempt (only stack traces), so
   * every entry is stamped at DLQ-insertion time rather than its actual
   * attempt time — see the schema comment on WorkerDeadLetter.errorHistory.
   */
  failedAt: string;
}

/**
 * job.stacktrace holds one entry per failed attempt (oldest first). Falls
 * back to a single synthetic entry from the final error if BullMQ didn't
 * retain any stack traces (e.g. attempts: 1, or an already-truncated job).
 */
export function buildErrorHistory(
  stacktrace: string[] | undefined,
  finalErrorMessage: string,
  attemptsMade: number,
): DeadLetterAttemptError[] {
  const now = new Date().toISOString();
  if (stacktrace && stacktrace.length > 0) {
    return stacktrace.map((trace, i) => ({
      attempt: i + 1,
      error: trace.split('\n')[0]?.trim() || trace,
      failedAt: now,
    }));
  }
  return [{ attempt: Math.max(1, attemptsMade), error: finalErrorMessage, failedAt: now }];
}

export interface InsertDeadLetterParams {
  queueName: string;
  jobName: string;
  bullJobId: string | undefined;
  payload: Prisma.InputJsonValue;
  stacktrace: string[] | undefined;
  finalErrorMessage: string;
  attemptsMade: number;
}

export async function insertDeadLetter(
  prisma: PrismaClient,
  params: InsertDeadLetterParams,
): Promise<{ id: string; correlationId: string }> {
  const correlationId = randomUUID();
  const errorHistory = buildErrorHistory(params.stacktrace, params.finalErrorMessage, params.attemptsMade);
  return prisma.workerDeadLetter.create({
    data: {
      queueName: params.queueName,
      jobName: params.jobName,
      bullJobId: params.bullJobId,
      payload: params.payload,
      errorHistory: errorHistory as unknown as Prisma.InputJsonValue,
      attemptsMade: params.attemptsMade,
      correlationId,
    },
    select: { id: true, correlationId: true },
  });
}

export function defaultDlqRetentionDays(): number {
  const raw = Number(process.env.DLQ_RETENTION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

/** Deletes DLQ rows older than the retention window. Retried rows are not exempt. */
export async function pruneOldDeadLetters(
  prisma: PrismaClient,
  retentionDays: number = defaultDlqRetentionDays(),
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.workerDeadLetter.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}

/**
 * Re-enqueues a dead-lettered job with a fresh attempts budget, and marks
 * the DLQ row retried. Does not delete the DLQ row — it stays as history;
 * retriedAt/retriedBy show it was actioned.
 *
 * getQueue is a callback rather than a Queue instance so the not-found and
 * already-retried paths never touch Redis at all — getArQueue() opens a
 * real connection and throws if REDIS_URL is unreachable, which must not
 * turn a 404/409 into an unrelated 500.
 */
export async function retryDeadLetter(
  prisma: PrismaClient,
  getQueue: () => Queue,
  id: string,
  retriedBy: string,
): Promise<{ newBullJobId: string | undefined } | { notFound: true } | { alreadyRetried: true }> {
  const row = await prisma.workerDeadLetter.findUnique({ where: { id } });
  if (!row) return { notFound: true };
  if (row.retriedAt) return { alreadyRetried: true };

  const newJob = await getQueue().add(row.jobName, row.payload as Prisma.InputJsonValue);

  await prisma.workerDeadLetter.update({
    where: { id },
    data: { retriedAt: new Date(), retriedBy },
  });

  return { newBullJobId: newJob.id };
}
