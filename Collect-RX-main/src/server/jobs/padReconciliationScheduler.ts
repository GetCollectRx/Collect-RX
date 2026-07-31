import cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import { reconcilePendingAuthorizations, reconcilePendingPadTransactions } from '../gocardless/padService.js';

let started = false;

function padReconcileEnabled(): boolean {
  return process.env.PAD_RECONCILE_ENABLED === '1' || process.env.PAD_RECONCILE_ENABLED === 'true';
}

/**
 * Cron safety-net sweep for GoCardless PAD status — activates authorized
 * mandates and applies payment status changes for anything a webhook might
 * have missed. Runs in-process (no Redis required). GoCardless's confirmed
 * webhooks (see webhooks/gocardless.ts) are the primary, real-time path;
 * this is the fallback.
 */
export function startPadReconciliationScheduler(prisma: PrismaClient): void {
  if (started) return;
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return;
  }
  if (!padReconcileEnabled()) {
    console.log('[padReconcile] Disabled (set PAD_RECONCILE_ENABLED=1 to enable)');
    return;
  }

  const pattern = (process.env.PAD_RECONCILE_CRON || '*/15 * * * *').trim();
  if (!cron.validate(pattern)) {
    console.error(`[padReconcile] Invalid PAD_RECONCILE_CRON "${pattern}"`);
    return;
  }

  started = true;
  cron.schedule(pattern, () => {
    void Promise.all([reconcilePendingAuthorizations(prisma), reconcilePendingPadTransactions(prisma)])
      .then(([authorizations, transactions]) => {
        if (authorizations.activated > 0 || transactions.updated > 0) {
          console.log(
            `[padReconcile] activated ${authorizations.activated}/${authorizations.checked} mandate(s), updated ${transactions.updated}/${transactions.checked} transaction(s)`,
          );
        }
      })
      .catch((err) => {
        console.error('[padReconcile] sweep failed:', (err as Error).message);
      });
  });

  console.log(`[padReconcile] Scheduled PAD reconciliation sweep: cron "${pattern}"`);
}
