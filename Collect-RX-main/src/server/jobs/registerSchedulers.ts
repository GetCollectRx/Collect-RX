import cron from 'node-cron';
import { getArQueue } from './arQueue.js';

const RULES_EVERY_MS = 60_000;
const TRIAGE_CREDENTIAL_HEALTH_CRON = '0 5 * * *';

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

  await q.add('RULES_TICK', {}, { repeat: { every: RULES_EVERY_MS } });
  await q.add('TRIAGE_CREDENTIAL_HEALTH', {}, { repeat: { pattern: TRIAGE_CREDENTIAL_HEALTH_CRON } });

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
      await q.add('LEARNING_CYCLE', {}, { repeat: { pattern: learningPattern } });
    }
  }

  const marketingEveryMs = parseInt(process.env.MARKETING_TICK_MS || '3600000', 10);
  if (process.env.MARKETING_LOOP_ENABLED !== '0') {
    await q.add('MARKETING_SEQUENCE_TICK', {}, { repeat: { every: marketingEveryMs } });
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
      await q.add('MARKETING_LEARNING_CYCLE', {}, { repeat: { pattern: marketingLearningPattern } });
    }
  }

  const dailyDigestPattern = (process.env.DAILY_DIGEST_CRON || '0 6 * * *').trim();
  const dailyDigestOn = ['1', 'true', 'yes'].includes(
    (process.env.DAILY_DIGEST_ENABLED ?? '1').trim().toLowerCase(),
  );
  if (dailyDigestOn) {
    if (!cron.validate(dailyDigestPattern)) {
      console.error(
        `[registerSchedulers] Invalid DAILY_DIGEST_CRON "${dailyDigestPattern}" — DAILY_DIGEST not registered`,
      );
    } else {
      await q.add('DAILY_DIGEST', {}, { repeat: { pattern: dailyDigestPattern } });
    }
  }

  console.log(
    `[registerSchedulers] Bull repeatables: RULES every ${RULES_EVERY_MS}ms, TRIAGE_CREDENTIAL_HEALTH daily` +
      (learningOn ? `, LEARNING cron "${learningPattern}"` : '') +
      (process.env.MARKETING_LOOP_ENABLED !== '0'
        ? `, MARKETING every ${marketingEveryMs}ms` +
          (marketingLearningOn ? `, MARKETING_LEARNING cron "${marketingLearningPattern}"` : '')
        : '') +
      (dailyDigestOn ? `, DAILY_DIGEST cron "${dailyDigestPattern}"` : ''),
  );
}
