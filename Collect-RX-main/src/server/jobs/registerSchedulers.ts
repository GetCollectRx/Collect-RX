import cron from 'node-cron';
import type { JobsOptions } from 'bullmq';
import { getArQueue } from './arQueue.js';

const RULES_EVERY_MS = 60_000;
const TRIAGE_CREDENTIAL_HEALTH_CRON = '0 5 * * *';

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
    console.warn('[registerSchedulers] DISABLE_SCHEDULER is set — skipping Bull repeatables');
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

  // REMINDER_CYCLE (patient SMS/email) intentionally not registered — insurance-only product.

  const learningPattern = (process.env.LEARNING_CRON || '0 6 * * *').trim();
  const learningOn = ['1', 'true', 'yes'].includes(
    (process.env.LEARNING_LOOP_ENABLED || '').trim().toLowerCase(),
  );
  if (learningOn) {
    if (!cron.validate(learningPattern)) {
      console.error(
        `[registerSchedulers] Invalid LEARNING_CRON "${learningPattern}" — LEARNING_CYCLE not registered`,
      );
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
      console.error(
        `[registerSchedulers] Invalid MARKETING_LEARNING_CRON "${marketingLearningPattern}" — MARKETING_LEARNING_CYCLE not registered`,
      );
    } else {
      await q.add(
        'MARKETING_LEARNING_CYCLE',
        {},
        { repeat: { pattern: marketingLearningPattern }, ...JOB_RETRY_OPTS },
      );
    }
  }

  console.log(
    `[registerSchedulers] Bull repeatables: RULES every ${RULES_EVERY_MS}ms, TRIAGE_CREDENTIAL_HEALTH daily` +
      (learningOn ? `, LEARNING cron "${learningPattern}"` : '') +
      (process.env.MARKETING_LOOP_ENABLED !== '0'
        ? `, MARKETING every ${marketingEveryMs}ms` +
          (marketingLearningOn ? `, MARKETING_LEARNING cron "${marketingLearningPattern}"` : '')
        : ''),
  );
}
