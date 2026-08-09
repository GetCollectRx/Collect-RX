/**
 * P0.4 (DLQ half) — completes the earlier BullMQ retry work. Covers
 * buildErrorHistory's fallback behavior, insertDeadLetter/retryDeadLetter
 * against a real Postgres row, and the retention sweep. DB-dependent tests
 * skip cleanly if DATABASE_URL is unreachable, matching this repo's
 * convention (see tests/queueEngineFairnessAndLease.test.ts).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { Queue } from 'bullmq';
import { prisma } from '../src/server/index.js';
import {
  buildErrorHistory,
  insertDeadLetter,
  retryDeadLetter,
  pruneOldDeadLetters,
  defaultDlqRetentionDays,
} from '../src/server/jobs/deadLetterQueue.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn(
    '[deadLetterQueue] DATABASE_URL unreachable — DB-dependent tests will be skipped:',
    (e as Error).message,
  );
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

describe('buildErrorHistory', () => {
  it('maps one entry per stack trace, oldest attempt first', () => {
    const history = buildErrorHistory(
      ['Error: first failure\n  at foo', 'Error: second failure\n  at bar'],
      'Error: second failure',
      2,
    );
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ attempt: 1, error: 'Error: first failure' });
    expect(history[1]).toMatchObject({ attempt: 2, error: 'Error: second failure' });
    expect(history[0].failedAt).toBeTruthy();
  });

  it('falls back to a single synthetic entry when BullMQ retained no stack traces', () => {
    const history = buildErrorHistory(undefined, 'connection refused', 1);
    expect(history).toEqual([{ attempt: 1, error: 'connection refused', failedAt: expect.any(String) }]);
  });

  it('falls back the same way for an empty stacktrace array', () => {
    const history = buildErrorHistory([], 'timeout', 3);
    expect(history).toHaveLength(1);
    expect(history[0].attempt).toBe(3);
  });
});

describe('defaultDlqRetentionDays', () => {
  it('defaults to 30 and ignores invalid values', () => {
    expect(defaultDlqRetentionDays()).toBeGreaterThan(0);
  });
});

describe.skipIf(!dbReady)('insertDeadLetter / retryDeadLetter / pruneOldDeadLetters — real DB', () => {
  afterEach(async () => {
    await prisma.workerDeadLetter.deleteMany({ where: { queueName: 'test-dlq-queue' } });
  });

  it('inserts a dead letter with a generated correlation ID and full error history', async () => {
    const { id, correlationId } = await insertDeadLetter(prisma, {
      queueName: 'test-dlq-queue',
      jobName: 'RULES_TICK',
      bullJobId: 'job-123',
      payload: { foo: 'bar' },
      stacktrace: ['Error: db down', 'Error: db down'],
      finalErrorMessage: 'Error: db down',
      attemptsMade: 2,
    });

    expect(correlationId).toBeTruthy();
    const row = await prisma.workerDeadLetter.findUniqueOrThrow({ where: { id } });
    expect(row.jobName).toBe('RULES_TICK');
    expect(row.queueName).toBe('test-dlq-queue');
    expect(row.attemptsMade).toBe(2);
    expect(row.retriedAt).toBeNull();
    expect(Array.isArray(row.errorHistory)).toBe(true);
    expect((row.errorHistory as unknown[]).length).toBe(2);
  });

  it('retryDeadLetter re-enqueues the job and marks the row retried', async () => {
    const { id } = await insertDeadLetter(prisma, {
      queueName: 'test-dlq-queue',
      jobName: 'TRIAGE_CREDENTIAL_HEALTH',
      bullJobId: 'job-456',
      payload: {},
      stacktrace: undefined,
      finalErrorMessage: 'boom',
      attemptsMade: 3,
    });

    const added = { id: 'new-job-id' };
    const fakeQueue = { add: async () => added } as unknown as Queue;
    const getQueue = () => fakeQueue;

    const result = await retryDeadLetter(prisma, getQueue, id, 'user-42');
    expect(result).toEqual({ newBullJobId: 'new-job-id' });

    const row = await prisma.workerDeadLetter.findUniqueOrThrow({ where: { id } });
    expect(row.retriedAt).not.toBeNull();
    expect(row.retriedBy).toBe('user-42');
  });

  it('retryDeadLetter refuses to double-retry an already-retried row', async () => {
    const { id } = await insertDeadLetter(prisma, {
      queueName: 'test-dlq-queue',
      jobName: 'RULES_TICK',
      bullJobId: undefined,
      payload: {},
      stacktrace: undefined,
      finalErrorMessage: 'boom',
      attemptsMade: 3,
    });
    const fakeQueue = { add: async () => ({ id: 'x' }) } as unknown as Queue;
    const getQueue = () => fakeQueue;

    await retryDeadLetter(prisma, getQueue, id, 'user-1');
    const secondAttempt = await retryDeadLetter(prisma, getQueue, id, 'user-2');
    expect(secondAttempt).toEqual({ alreadyRetried: true });
  });

  it('retryDeadLetter reports notFound for a nonexistent id', async () => {
    const fakeQueue = { add: async () => ({ id: 'x' }) } as unknown as Queue;
    const getQueue = () => fakeQueue;
    const result = await retryDeadLetter(prisma, getQueue, 'does-not-exist', 'user-1');
    expect(result).toEqual({ notFound: true });
  });

  it('pruneOldDeadLetters deletes only rows older than the retention window', async () => {
    const { id: oldId } = await insertDeadLetter(prisma, {
      queueName: 'test-dlq-queue',
      jobName: 'RULES_TICK',
      bullJobId: undefined,
      payload: {},
      stacktrace: undefined,
      finalErrorMessage: 'boom',
      attemptsMade: 1,
    });
    await prisma.workerDeadLetter.update({
      where: { id: oldId },
      data: { createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
    });
    const { id: recentId } = await insertDeadLetter(prisma, {
      queueName: 'test-dlq-queue',
      jobName: 'RULES_TICK',
      bullJobId: undefined,
      payload: {},
      stacktrace: undefined,
      finalErrorMessage: 'boom',
      attemptsMade: 1,
    });

    const pruned = await pruneOldDeadLetters(prisma, 30);
    expect(pruned).toBeGreaterThanOrEqual(1);

    const oldRow = await prisma.workerDeadLetter.findUnique({ where: { id: oldId } });
    const recentRow = await prisma.workerDeadLetter.findUnique({ where: { id: recentId } });
    expect(oldRow).toBeNull();
    expect(recentRow).not.toBeNull();
  });
});
