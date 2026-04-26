/**
 * P8-02 — BullMQ worker: run rules + patient reminders out of the HTTP process.
 * Start: `npm run worker` (same env as API: DATABASE_URL, REDIS_URL, STRIPE_*, etc.)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { AR_QUEUE_NAME } from './jobs/arQueue.js';
import { runRulesEngineTick } from './rulesEngine.js';
import { runReminderCycle } from './patients/reminderEngine.js';

if (!process.env.REDIS_URL) {
  console.error('worker: REDIS_URL is required');
  process.exit(1);
}

const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const prisma = new PrismaClient();

const worker = new Worker(
  AR_QUEUE_NAME,
  async (job) => {
    if (job.name === 'RULES_TICK') {
      await runRulesEngineTick(prisma);
    } else if (job.name === 'REMINDER_CYCLE') {
      await runReminderCycle();
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

async function shutdown() {
  console.log('[worker] shutting down...');
  await worker.close();
  await prisma.$disconnect();
  await connection.quit();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
