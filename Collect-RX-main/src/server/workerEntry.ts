/**
 * P8-02 — BullMQ worker: insurance ops tick out of the HTTP process.
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
import { runRulesEngineTick } from './rulesEngine.js';
import { runLearningCycle } from './learning/cycle.js';
import { runMarketingSequenceTick } from './marketing/sequenceEngine.js';
import { runMarketingLearningCycle } from './marketing/marketingLearningJob.js';
import type { PreVisitJobPayload } from './preVisit/preVisitJobs.js';

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

// Stub handlers — actual VAPI dispatch is a follow-on task. These exist now so the
// PRE_VISIT_ELIGIBILITY write path (previously missing entirely) is wired end-to-end.
async function handlePreVisitEligibility(prisma: PrismaClient, payload: PreVisitJobPayload): Promise<void> {
  console.log('[worker] PRE_VISIT_ELIGIBILITY', { practiceId: payload.practiceId, carrierId: payload.carrierId });
  // KNOWN GAP: EligibilitySnapshot.patientId is a PMS record id with no bridge to
  // patientToken (see src/server/preVisit/appointmentVerification.ts). Using the
  // token as a stand-in until that bridge exists. planYearStart is a placeholder
  // pending the real VAPI eligibility outcome.
  await prisma.eligibilitySnapshot.create({
    data: {
      practiceId: payload.practiceId,
      patientId: payload.patientToken,
      carrier: payload.carrierId,
      status: 'unknown',
      verifiedAt: new Date(),
      planYearStart: new Date(new Date().getUTCFullYear(), 0, 1),
    },
  });
}

async function handlePreVisitCdcpPredet(payload: PreVisitJobPayload): Promise<void> {
  // cdcpContext routes the downstream VAPI agent to the CDCP IVR line
  // (1-888-888-8110) instead of the standard Sun Life group benefits line.
  console.log('[worker] PRE_VISIT_CDCP_PREDET', {
    practiceId: payload.practiceId,
    carrierId: payload.carrierId,
    cdcpContext: payload.cdcpContext === true,
  });
}

const worker = new Worker(
  AR_QUEUE_NAME,
  async (job) => {
    if (job.name === 'RULES_TICK') {
      // Insurance call_queue priority sync runs inside runRulesEngineTick (same path as in-process setInterval).
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
      await handlePreVisitCdcpPredet(job.data as PreVisitJobPayload);
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

// Railway services commonly enforce the same healthcheck path as the web service.
// The worker is not public-facing, but this tiny endpoint lets Railway confirm it is alive.
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
