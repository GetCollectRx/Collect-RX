import cron from 'node-cron';
import { getArQueue } from './arQueue.js';
import { getMarketingQueue } from '../marketing/marketingQueue.js';

const RULES_EVERY_MS = 60_000;

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

  const pattern = process.env.REMINDER_CRON || '0 9 * * *';
  if (!cron.validate(pattern)) {
    console.error(`[registerSchedulers] Invalid REMINDER_CRON "${pattern}" — reminder job not registered`);
  } else {
    await q.add('REMINDER_CYCLE', {}, { repeat: { pattern } });
  }

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

  console.log(
    `[registerSchedulers] Bull repeatables: RULES every ${RULES_EVERY_MS}ms, REMINDER cron "${pattern}"` +
      (learningOn ? `, LEARNING cron "${learningPattern}"` : ''),
  );

  // Marketing sequence tick — hourly check for due email steps
  const mq = getMarketingQueue();
  const existingMq = await mq.getRepeatableJobs();
  for (const r of existingMq) {
    await mq.removeRepeatableByKey(r.key);
  }
  await mq.add('MARKETING_SEQUENCE_TICK', {}, { repeat: { every: 60 * 60 * 1000 } });
  console.log('[registerSchedulers] MARKETING_SEQUENCE_TICK registered (every 60min)');
}
