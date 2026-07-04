/**
 * P8-02 — BullMQ worker: insurance ops tick out of the HTTP process.
 */
import 'dotenv/config';
import { applyPostgresTlsToProcessEnv, assertPostgresTlsInProduction } from './databaseTls.js';

applyPostgresTlsToProcessEnv();

import { PrismaClient } from '@prisma/client';
import { Worker } from 'bullmq';
import express from 'express';
import IORedis from 'ioredis';
import { AR_QUEUE_NAME } from './jobs/arQueue.js';
import { runRulesEngineTick } from './rulesEngine.js';
import { runLearningCycle } from './learning/cycle.js';
import { runMarketingSequenceTick } from './marketing/sequenceEngine.js';
import { runMarketingLearningCycle } from './marketing/marketingLearningJob.js';
import type { PreVisitJobPayload } from './preVisit/preVisitJobs.js';
import { dispatchPreVisitCall, dispatchTelusTx23Check } from './preVisit/preVisitDispatch.js';
import { sweepUpcomingAppointmentsAcrossPractices } from './preVisit/appointmentIngest.js';

assertPostgresTlsInProduction();

if (!process.env.REDIS_URL) {
  console.error(
    'worker: REDIS_URL is required.\n' +
      '  Local Redis: from repo root run `docker compose up -d redis`, then in Collect-RX-main/.env:\n' +
      '    REDIS_URL=redis://127.0.0.1:6379\n' +
      '  Without Redis: rules + reminders run in-process inside `npm run dev` (no worker process).\n' +
      '  One-off learning cycle (no worker): LEARNING_LOOP_ENABLED=1 npm run learning:cycle',
  );
  process.exit(1);
}

const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const prisma = new PrismaClient();

async function handlePreVisitEligibility(prisma: PrismaClient, payload: PreVisitJobPayload): Promise<void> {
  const result = await dispatchPreVisitCall(prisma, 'PRE_VISIT_ELIGIBILITY', payload);
  if ('skipped' in result) {
    console.log('[worker] PRE_VISIT_ELIGIBILITY skipped:', result.reason);
  } else {
    console.log('[worker] PRE_VISIT_ELIGIBILITY dispatched:', result.vapiCallId);
  }
}

async function handlePreVisitCdcpPredet(prisma: PrismaClient, payload: PreVisitJobPayload): Promise<void> {
  const result = await dispatchPreVisitCall(prisma, 'PRE_VISIT_CDCP_PREDET', payload);
  if ('skipped' in result) {
    console.log('[worker] PRE_VISIT_CDCP_PREDET skipped:', result.reason);
  } else {
    console.log('[worker] PRE_VISIT_CDCP_PREDET dispatched:', result.vapiCallId);
  }
}

async function handlePreVisitTelusTx23(prisma: PrismaClient, payload: PreVisitJobPayload): Promise<void> {
  const result = await dispatchTelusTx23Check(prisma, payload);
  if (result.resolved) {
    console.log('[worker] PRE_VISIT_TELUS_TX23 resolved');
  } else {
    console.log('[worker] PRE_VISIT_TELUS_TX23 unresolved:', result.reason);
  }
}

const worker = new Worker(
  AR_QUEUE_NAME,
  async (job) => {
    if (job.name === 'RULES_TICK') {
      await runRulesEngineTick(prisma);
    } else if (job.name === 'REMINDER_CYCLE') {
      console.log('[worker] REMINDER_CYCLE skipped — patient outreach disabled');
    } else if (job.name === 'LEARNING_CYCLE') {
      await runLearningCycle(prisma);
    } else if (job.name === 'MARKETING_SEQUENCE_TICK') {
      await runMarketingSequenceTick(prisma);
    } else if (job.name === 'MARKETING_LEARNING_CYCLE') {
      await runMarketingLearningCycle(prisma);
    } else if (job.name === 'PRE_VISIT_ELIGIBILITY') {
      await handlePreVisitEligibility(prisma, job.data as PreVisitJobPayload);
    } else if (job.name === 'PRE_VISIT_CDCP_PREDET') {
      await handlePreVisitCdcpPredet(prisma, job.data as PreVisitJobPayload);
    } else if (job.name === 'PRE_VISIT_TELUS_TX23') {
      await handlePreVisitTelusTx23(prisma, job.data as PreVisitJobPayload);
    } else if (job.name === 'APPOINTMENT_VERIFICATION_SWEEP') {
      const n = await sweepUpcomingAppointmentsAcrossPractices(prisma);
      if (n > 0) console.log(`[worker] APPOINTMENT_VERIFICATION_SWEEP verified ${n} appointment(s)`);
    } else {
      throw new Error(`Unknown job name: ${job.name}`);
    }
  },
  { connection, concurrency: 1 }
);

worker.on('failed', (job, err) => {
  console.error('[worker] job failed', { id: job?.id, name: job?.name, err: (err as Error).message });
});

console.log(`[worker] listening on queue "${AR_QUEUE_NAME}"`);

/** API uses PORT (3000) in dev; worker health must not collide. Railway worker service uses PORT. */
function resolveWorkerHealthPort(): number {
  if (process.env.WORKER_HEALTH_PORT) {
    return parseInt(process.env.WORKER_HEALTH_PORT, 10);
  }
  const apiPort = parseInt(process.env.PORT ?? '3000', 10);
  if (process.env.NODE_ENV !== 'production') {
    return apiPort + 1;
  }
  return apiPort;
}

const healthPort = resolveWorkerHealthPort();

const healthApp = express();
healthApp.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'collectrx-worker', queue: AR_QUEUE_NAME });
});
healthApp.get('/api/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', service: 'collectrx-worker' });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', error: (err as Error).message });
  }
});
const healthServer = healthApp.listen(healthPort, () => {
  console.log(`[worker] health endpoint listening on port ${healthPort}`);
});
healthServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[worker] port ${healthPort} already in use (API may be on ${parseInt(process.env.PORT ?? '3000', 10)}). ` +
        'Stop the other process or set WORKER_HEALTH_PORT.',
    );
    process.exit(1);
  }
  throw err;
});

async function shutdown() {
  console.log('[worker] shutting down...');
  healthServer.close();
  await worker.close();
  await prisma.$disconnect();
  await connection.quit();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
