/**
 * P1.2 — GET /api/diagnostics aggregator: one place to look during an
 * incident instead of separately checking Vapi, Postgres, the desk queue,
 * and BullMQ. Every sub-check is isolated with its own try/catch so one
 * failing subsystem (e.g. Redis down) still returns a useful snapshot for
 * everything else rather than a blank 500.
 */
import type { PrismaClient } from '@prisma/client';
import { vapiCircuitBreaker, type CircuitBreakerMetrics } from '../../vapi/circuitBreaker.js';
import { getQueueHealth, type QueueHealthSnapshot } from './queueHealth.js';
import { getEventLoopHealth, type EventLoopHealth } from './eventLoopHealth.js';

export interface DatabaseDiagnostics {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface BullMqDiagnostics {
  /** False when REDIS_URL is unset — BullMQ is not expected to be running. */
  configured: boolean;
  jobCounts?: Record<string, number>;
  /** Unresolved WorkerDeadLetter rows (retriedAt IS NULL). */
  dlqPending?: number;
  error?: string;
}

export interface DiagnosticsSnapshot {
  timestamp: string;
  eventLoop: EventLoopHealth;
  database: DatabaseDiagnostics;
  deskQueue: QueueHealthSnapshot | { error: string };
  vapiCircuitBreaker: CircuitBreakerMetrics;
  bullmq: BullMqDiagnostics;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function checkDatabase(prisma: PrismaClient): Promise<DatabaseDiagnostics> {
  const start = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { ok: false, latencyMs: Math.round(performance.now() - start), error: errorMessage(err) };
  }
}

async function checkBullMq(prisma: PrismaClient): Promise<BullMqDiagnostics> {
  if (!(process.env.REDIS_URL || '').trim()) {
    return { configured: false };
  }
  try {
    const { getQueueJobCounts } = await import('../jobs/arQueue.js');
    const [{ queue: _queue, ...jobCounts }, dlqPending] = await Promise.all([
      getQueueJobCounts(),
      prisma.workerDeadLetter.count({ where: { retriedAt: null } }),
    ]);
    return { configured: true, jobCounts, dlqPending };
  } catch (err) {
    return { configured: true, error: errorMessage(err) };
  }
}

export async function buildDiagnosticsSnapshot(prisma: PrismaClient): Promise<DiagnosticsSnapshot> {
  const [database, deskQueue, bullmq] = await Promise.all([
    checkDatabase(prisma),
    getQueueHealth(prisma).catch((err: unknown) => ({ error: errorMessage(err) })),
    checkBullMq(prisma),
  ]);

  return {
    timestamp: new Date().toISOString(),
    eventLoop: getEventLoopHealth(),
    database,
    deskQueue,
    vapiCircuitBreaker: vapiCircuitBreaker.getMetrics(),
    bullmq,
  };
}
