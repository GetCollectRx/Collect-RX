import cron from 'node-cron';
import type { JobsOptions } from 'bullmq';
import { getArQueue } from './arQueue.js';
import { getAgentRunnerQueue } from './agentRunnerQueue.js';
import { AGENT_SCHEDULES } from './agentSchedules.js';
import { logger } from '../observability/logger.js';

const RULES_EVERY_MS = 60_000;
const TRIAGE_CREDENTIAL_HEALTH_CRON = '0 5 * * *';
const DATA_RETENTION_CRON = '0 4 * * *';
const DLQ_RETENTION_SWEEP_CRON = '0 4 * * *';

/**
 * These repeatables previously had no attempts/backoff — a single transient
 * failure (DB blip, Redis hiccup) meant the job just silently didn't run
 * until its next scheduled fire, with only a console.error in the worker
 * process. 3 attempts with exponential backoff gives a transient failure a
 * real chance to clear before the job is skipped for a full cycle; the
 * worker's 'failed' handler (workerEntry.ts) alerts once attempts are
 * exhausted.
 */
const JOB_RETRY_OPTS: Pick<JobsOptions, 'attempts' | 'backoff'> = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
};

/**
 * Idempotent: clears existing repeatables for this queue, then registers RULES + REMINDER.
 * Call from the API process only (once per deploy is ideal; see PHASE8 doc for multi-replica).
 */
export async function registerArJobSchedulers(): Promise<void> {
  if (!process.env.REDIS_URL) {
    return;
  }
  if (process.env.DISABLE_SCHEDULER === '1' || process.env.DISABLE_SCHEDULER === 'true') {
    logger.warn('[registerSchedulers] DISABLE_SCHEDULER is set — skipping Bull repeatables', {});
    return;
  }

  const q = getArQueue();
  const existing = await q.getRepeatableJobs();
  for (const r of existing) {
    await q.removeRepeatableByKey(r.key);
  }

  await q.add('RULES_TICK', {}, { repeat: { every: RULES_EVERY_MS }, ...JOB_RETRY_OPTS });
  await q.add(
    'TRIAGE_CREDENTIAL_HEALTH',
    {},
    { repeat: { pattern: TRIAGE_CREDENTIAL_HEALTH_CRON }, ...JOB_RETRY_OPTS },
  );
  await q.add(
    'DLQ_RETENTION_SWEEP',
    {},
    { repeat: { pattern: DLQ_RETENTION_SWEEP_CRON }, ...JOB_RETRY_OPTS },
  );

  // DATA_RETENTION_ENABLED is a second, global gate on top of this repeatable —
  // see dataRetentionJob.ts. Registered even when the global flag is off so
  // flipping the env var doesn't also require a scheduler re-registration.
  await q.add('DATA_RETENTION', {}, { repeat: { pattern: DATA_RETENTION_CRON } });

  // REMINDER_CYCLE (patient SMS/email) intentionally not registered — insurance-only product.

  const learningPattern = (process.env.LEARNING_CRON || '0 6 * * *').trim();
  const learningOn = ['1', 'true', 'yes'].includes(
    (process.env.LEARNING_LOOP_ENABLED || '').trim().toLowerCase(),
  );
  if (learningOn) {
    if (!cron.validate(learningPattern)) {
      logger.error('[registerSchedulers] Invalid LEARNING_CRON — LEARNING_CYCLE not registered', {
        pattern: learningPattern,
      });
    } else {
      await q.add('LEARNING_CYCLE', {}, { repeat: { pattern: learningPattern }, ...JOB_RETRY_OPTS });
    }
  }

  const marketingEveryMs = parseInt(process.env.MARKETING_TICK_MS || '3600000', 10);
  if (process.env.MARKETING_LOOP_ENABLED !== '0') {
    await q.add('MARKETING_SEQUENCE_TICK', {}, { repeat: { every: marketingEveryMs }, ...JOB_RETRY_OPTS });
  }

  const marketingLearningPattern = (process.env.MARKETING_LEARNING_CRON || '0 7 * * 1').trim();
  const marketingLearningOn = ['1', 'true', 'yes'].includes(
    (process.env.MARKETING_LEARNING_ENABLED ?? '1').trim().toLowerCase(),
  );
  if (marketingLearningOn && process.env.MARKETING_LOOP_ENABLED !== '0') {
    if (!cron.validate(marketingLearningPattern)) {
      logger.error('[registerSchedulers] Invalid MARKETING_LEARNING_CRON — MARKETING_LEARNING_CYCLE not registered', {
        pattern: marketingLearningPattern,
      });
    } else {
      await q.add(
        'MARKETING_LEARNING_CYCLE',
        {},
        { repeat: { pattern: marketingLearningPattern }, ...JOB_RETRY_OPTS },
      );
    }
  }

  logger.info('[registerSchedulers] Bull repeatables registered', {
    rulesEveryMs: RULES_EVERY_MS,
    triageCredentialHealth: 'daily',
    dlqRetentionSweep: 'daily',
    dataRetentionEnabled: process.env.DATA_RETENTION_ENABLED === '1',
    learningCron: learningOn ? learningPattern : null,
    marketingEveryMs: process.env.MARKETING_LOOP_ENABLED !== '0' ? marketingEveryMs : null,
    marketingLearningCron:
      process.env.MARKETING_LOOP_ENABLED !== '0' && marketingLearningOn
        ? marketingLearningPattern
        : null,
  });
}

/**
 * Register agent runner jobs for autonomous agent ecosystem
 * Idempotent: clears existing agent repeatables and re-registers all agents
 */
export async function registerAgentRunners(): Promise<void> {
  if (!process.env.REDIS_URL) {
    logger.warn('[registerSchedulers] REDIS_URL not set — agent runners disabled', {});
    return;
  }

  if (process.env.DISABLE_AGENT_RUNNERS === '1' || process.env.DISABLE_AGENT_RUNNERS === 'true') {
    logger.warn('[registerSchedulers] DISABLE_AGENT_RUNNERS is set — skipping agent schedulers', {});
    return;
  }

  if (!process.env.API_BASE) {
    logger.warn('[registerSchedulers] API_BASE not set — agent runners disabled', {});
    return;
  }

  if (!process.env.AGENT_RUNTIME_SECRET) {
    logger.warn('[registerSchedulers] AGENT_RUNTIME_SECRET not set — agent runners disabled', {});
    return;
  }

  try {
    const q = getAgentRunnerQueue();

    // Clear existing agent jobs
    const existing = await q.getRepeatableJobs();
    for (const r of existing) {
      await q.removeRepeatableByKey(r.key);
    }

    // Register all agent schedules
    for (const schedule of AGENT_SCHEDULES) {
      if (!cron.validate(schedule.cron)) {
        logger.error('[registerSchedulers] Invalid cron pattern for agent', {
          agent: schedule.name,
          cron: schedule.cron,
        });
        continue;
      }

      await q.add(
        'AGENT_RUN',
        {
          agentName: schedule.name,
          cron: schedule.cron,
          upstreamAgents: schedule.upstreamAgents,
          timeWindow: 'UTC',
        },
        {
          repeat: { pattern: schedule.cron },
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 3600 }, // Keep completed jobs for 1 hour
        },
      );
    }

    logger.info('[registerSchedulers] Agent runner jobs registered', {
      agentCount: AGENT_SCHEDULES.length,
      startTime: '06:00 ET (Monday)',
      endTime: '15:00 ET (Monday)',
    });
  } catch (err) {
    logger.error('[registerSchedulers] Failed to register agent runners', {
      error: String(err),
    });
  }
}
