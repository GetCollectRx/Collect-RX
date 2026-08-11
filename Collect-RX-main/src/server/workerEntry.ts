/**
 * P8-02 — BullMQ worker: insurance ops tick out of the HTTP process.
 */
import 'dotenv/config';
import { applyPostgresTlsToProcessEnv, assertPostgresTlsInProduction } from './databaseTls.js';

applyPostgresTlsToProcessEnv();

import type { PrismaClient } from '@prisma/client';
import { Worker, type ConnectionOptions } from 'bullmq';
import express from 'express';
import IORedis from 'ioredis';
import { prisma } from '../lib/prisma.js';
import { runWithRlsBypass, runWithPracticeRls } from './db/rlsContext.js';
import { runWithCorrelationId } from './observability/correlationContext.js';
import { AR_QUEUE_NAME } from './jobs/arQueue.js';
import { runRulesEngineTick } from './rulesEngine.js';
import { runLearningCycle } from './learning/cycle.js';
import { runMarketingSequenceTick } from './marketing/sequenceEngine.js';
import { runMarketingLearningCycle } from './marketing/marketingLearningJob.js';
import { enqueuePreVisitJob, type PreVisitJobPayload } from './preVisit/preVisitJobs.js';
import { dispatchPreVisitCall, dispatchTelusTx23Check } from './preVisit/preVisitDispatch.js';
import { sweepUpcomingAppointmentsAcrossPractices } from './preVisit/appointmentIngest.js';
import { runTriageCredentialHealthJob } from './triage/triageCredentialHealthJob.js';
import { dispatchOpsAlert } from './observability/opsAlerts.js';
import {
  shouldAlertOnJobExhaustion,
  buildJobFailureAlertDetail,
  resolveJobCorrelationId,
} from './jobs/jobFailureAlert.js';
import { insertDeadLetter, pruneOldDeadLetters } from './jobs/deadLetterQueue.js';
import { closeAgentRunnerQueue } from './jobs/agentRunnerQueue.js';
import { runAgent } from './jobs/agentRunnerService.js';
import { logger } from './observability/logger.js';

assertPostgresTlsInProduction();

if (!process.env.REDIS_URL) {
  logger.error(
    'worker: REDIS_URL is required',
    {
      hint:
        'Local Redis: from repo root run `docker compose up -d redis`, then in Collect-RX-main/.env: ' +
        'REDIS_URL=redis://127.0.0.1:6379. Without Redis: rules + reminders run in-process inside `npm run dev` ' +
        '(no worker process). One-off learning cycle (no worker): LEARNING_LOOP_ENABLED=1 npm run learning:cycle',
    },
  );
  process.exit(1);
}

// Bind the health port before touching Redis/BullMQ — constructing the Worker
// below opens a real connection, and on a slow/cold Redis this can take
// several seconds. Binding first means Fly sees an open socket on machine
// start instead of a window where nothing is listening (same fix as index.ts).
/** API uses PORT (3000) in dev; worker health must not collide. The Fly worker process uses PORT. */
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
  logger.info('[worker] health endpoint listening', { healthPort });
});
healthServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.error('[worker] health port already in use', {
      healthPort,
      apiPort: parseInt(process.env.PORT ?? '3000', 10),
      hint: 'Stop the other process or set WORKER_HEALTH_PORT.',
    });
    process.exit(1);
  }
  throw err;
});

const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

async function handlePreVisitEligibility(db: PrismaClient, payload: PreVisitJobPayload): Promise<void> {
  const result = await runWithPracticeRls(payload.practiceId, async () =>
    dispatchPreVisitCall(db, 'PRE_VISIT_ELIGIBILITY', payload),
  );
  if ('deferred' in result) {
    await enqueuePreVisitJob(
      'PRE_VISIT_ELIGIBILITY',
      payload,
      Math.max(0, result.retryAt.getTime() - Date.now()),
      `window:${result.retryAt.toISOString()}`,
    );
    logger.warn('[worker] PRE_VISIT_ELIGIBILITY deferred', { reason: result.reason });
    return;
  }
  if ('skipped' in result) {
    logger.info('[worker] PRE_VISIT_ELIGIBILITY skipped', { reason: result.reason });
  } else {
    logger.info('[worker] PRE_VISIT_ELIGIBILITY dispatched', { vapiCallId: result.vapiCallId });
  }
}

async function handlePreVisitCdcpPredet(db: PrismaClient, payload: PreVisitJobPayload): Promise<void> {
  const result = await runWithPracticeRls(payload.practiceId, async () =>
    dispatchPreVisitCall(db, 'PRE_VISIT_CDCP_PREDET', payload),
  );
  if ('deferred' in result) {
    await enqueuePreVisitJob(
      'PRE_VISIT_CDCP_PREDET',
      payload,
      Math.max(0, result.retryAt.getTime() - Date.now()),
      `window:${result.retryAt.toISOString()}`,
    );
    logger.warn('[worker] PRE_VISIT_CDCP_PREDET deferred', { reason: result.reason });
    return;
  }
  if ('skipped' in result) {
    logger.info('[worker] PRE_VISIT_CDCP_PREDET skipped', { reason: result.reason });
  } else {
    logger.info('[worker] PRE_VISIT_CDCP_PREDET dispatched', { vapiCallId: result.vapiCallId });
  }
}

async function handlePreVisitTelusTx23(db: PrismaClient, payload: PreVisitJobPayload): Promise<void> {
  const result = await runWithPracticeRls(payload.practiceId, async () =>
    dispatchTelusTx23Check(db, payload),
  );
  if (result.resolved) {
    logger.info('[worker] PRE_VISIT_TELUS_TX23 resolved', {});
  } else {
    logger.info('[worker] PRE_VISIT_TELUS_TX23 unresolved', { reason: result.reason });
  }
}

const worker = new Worker(
  AR_QUEUE_NAME,
  async (job) => {
    const correlationId = resolveJobCorrelationId(job.data as { correlationId?: string } | undefined);

    await runWithCorrelationId(correlationId, () =>
    runWithRlsBypass(async () => {
      if (job.name === 'RULES_TICK') {
        await runRulesEngineTick(prisma);
      } else if (job.name === 'TRIAGE_CREDENTIAL_HEALTH') {
        const checked = await runTriageCredentialHealthJob(prisma);
        logger.info('[worker] TRIAGE_CREDENTIAL_HEALTH checked credentials', { checked });
      } else if (job.name === 'REMINDER_CYCLE') {
        logger.info('[worker] REMINDER_CYCLE skipped — patient outreach disabled', {});
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
        if (n > 0) logger.info('[worker] APPOINTMENT_VERIFICATION_SWEEP verified appointments', { verified: n });
      } else if (job.name === 'DLQ_RETENTION_SWEEP') {
        const pruned = await pruneOldDeadLetters(prisma);
        if (pruned > 0) logger.info('[worker] DLQ_RETENTION_SWEEP pruned dead letters', { pruned });
      } else {
        throw new Error(`Unknown job name: ${job.name}`);
      }
    }));
  },
  { connection: connection as unknown as ConnectionOptions, concurrency: 1 },
);

worker.on('failed', (job, err) => {
  const attemptsMade = job?.attemptsMade ?? 0;
  const attemptsAllowed = job?.opts?.attempts ?? 1;
  logger.error('[worker] job failed', {
    id: job?.id,
    name: job?.name,
    attemptsMade,
    attemptsAllowed,
    error: err,
  });

  if (job && shouldAlertOnJobExhaustion(attemptsMade, attemptsAllowed)) {
    void dispatchOpsAlert({
      alertId: 'worker_job_failed',
      detail: buildJobFailureAlertDetail(job.name, job.id, attemptsMade, attemptsAllowed, (err as Error).message),
      source: 'worker',
    }).catch((alertErr) => {
      logger.error('[worker] failed to dispatch worker_job_failed alert', { error: alertErr });
    });

    void insertDeadLetter(prisma, {
      queueName: AR_QUEUE_NAME,
      jobName: job.name,
      bullJobId: job.id,
      payload: job.data,
      stacktrace: job.stacktrace ?? undefined,
      finalErrorMessage: (err as Error).message,
      attemptsMade,
    }).catch((dlqErr) => {
      logger.error('[worker] failed to write dead letter record', { error: dlqErr });
    });
  }
});

logger.info('[worker] listening on queue', { queue: AR_QUEUE_NAME });

// Agent runner worker (separate queue for autonomous agents)
const agentWorker = new Worker(
  'agent-runner',
  async (job) => {
    const correlationId = job.id ?? 'agent-run-' + Date.now();

    await runWithCorrelationId(correlationId, () =>
      runWithRlsBypass(async () => {
        if (job.name === 'AGENT_RUN') {
          await runAgent(job);
        } else {
          throw new Error(`Unknown agent job name: ${job.name}`);
        }
      }),
    );
  },
  { connection: connection as unknown as ConnectionOptions, concurrency: 1 },
);

agentWorker.on('failed', (job, err) => {
  const attemptsMade = job?.attemptsMade ?? 0;
  const attemptsAllowed = job?.opts?.attempts ?? 1;
  const agentName = job?.data?.agentName ?? 'unknown';

  logger.error('[worker] agent job failed', {
    id: job?.id,
    agentName,
    attemptsMade,
    attemptsAllowed,
    error: String(err),
  });

  if (job && shouldAlertOnJobExhaustion(attemptsMade, attemptsAllowed)) {
    void dispatchOpsAlert({
      alertId: 'agent_job_failed',
      detail: `Agent ${agentName} failed after ${attemptsMade} attempts: ${(err as Error).message}`,
      source: 'agent-worker',
    }).catch((alertErr) => {
      logger.error('[worker] failed to dispatch agent_job_failed alert', { error: alertErr });
    });
  }
});

agentWorker.on('completed', (job) => {
  logger.info('[worker] agent job completed', {
    id: job?.id,
    agentName: job?.data?.agentName,
  });
});

logger.info('[worker] agent runner listening on queue', { queue: 'agent-runner' });

async function shutdown() {
  logger.info('[worker] shutting down', {});
  healthServer.close();
  await worker.close();
  await agentWorker.close();
  await closeAgentRunnerQueue();
  await prisma.$disconnect();
  await connection.quit();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
