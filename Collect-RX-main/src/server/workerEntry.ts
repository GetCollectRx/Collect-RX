/**
 * P8-02 — BullMQ worker: run rules + patient reminders out of the HTTP process.
 * Start: `npm run worker` (same env as API: DATABASE_URL, REDIS_URL, STRIPE_*, etc.)
 */
import 'dotenv/config';
import { applyPostgresTlsToProcessEnv, assertPostgresTlsInProduction } from './databaseTls.js';

applyPostgresTlsToProcessEnv();

import { PrismaClient } from '@prisma/client';
import { Worker } from 'bullmq';
import express from 'express';
import IORedis from 'ioredis';
import { AR_QUEUE_NAME } from './jobs/arQueue.js';
import { MARKETING_QUEUE_NAME } from './marketing/marketingQueue.js';
import { runRulesEngineTick } from './rulesEngine.js';
import { runReminderCycle } from './patients/reminderEngine.js';
import { runLearningCycle } from './learning/cycle.js';
import { runMarketingSequenceTick } from './marketing/sequenceEngine.js';
import { runReferralSequenceTick } from './marketing/referralEngine.js';

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
const healthPort = parseInt(process.env.PORT ?? '3000', 10);

const worker = new Worker(
  AR_QUEUE_NAME,
  async (job) => {
    if (job.name === 'RULES_TICK') {
      // Insurance call_queue priority sync runs inside runRulesEngineTick (same path as in-process setInterval).
      await runRulesEngineTick(prisma);
    } else if (job.name === 'REMINDER_CYCLE') {
      await runReminderCycle();
    } else if (job.name === 'LEARNING_CYCLE') {
      await runLearningCycle(prisma);
    } else {
      throw new Error(`Unknown job name: ${job.name}`);
    }
  },
  { connection, concurrency: 1 }
);

const marketingWorker = new Worker(
  MARKETING_QUEUE_NAME,
  async (job) => {
    if (job.name === 'MARKETING_SEQUENCE_TICK') {
      await runMarketingSequenceTick(prisma);
      await runReferralSequenceTick(prisma);
    } else {
      console.warn(`[marketingWorker] Unknown job name: ${job.name}`);
    }
  },
  { connection, concurrency: 1 }
);

marketingWorker.on('failed', (job, err) => {
  console.error('[marketingWorker] job failed', { id: job?.id, name: job?.name, err: (err as Error).message });
});

worker.on('failed', (job, err) => {
  console.error('[worker] job failed', { id: job?.id, name: job?.name, err: (err as Error).message });
});

console.log(`[worker] listening on queue "${AR_QUEUE_NAME}" and "${MARKETING_QUEUE_NAME}"`);

// Railway services commonly enforce the same healthcheck path as the web service.
// The worker is not public-facing, but this tiny endpoint lets Railway confirm it is alive.
const healthApp = express();
healthApp.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'collectrx-worker', queues: [AR_QUEUE_NAME, MARKETING_QUEUE_NAME] });
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
