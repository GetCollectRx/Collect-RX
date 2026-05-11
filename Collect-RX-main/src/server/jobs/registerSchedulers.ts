import cron from 'node-cron';
import { getArQueue } from './arQueue.js';

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

  console.log(
    `[registerSchedulers] Bull repeatables: RULES every ${RULES_EVERY_MS}ms, REMINDER cron "${pattern}"`
  );
}
