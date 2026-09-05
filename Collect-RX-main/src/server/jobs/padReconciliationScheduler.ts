import cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import { reconcilePendingAuthorizations, reconcilePendingPadTransactions } from '../gocardless/padService.js';
import { logger } from '../observability/logger.js';

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
    logger.info('[padReconcile] Disabled (set PAD_RECONCILE_ENABLED=1 to enable)', {});
    return;
  }

  const pattern = (process.env.PAD_RECONCILE_CRON || '*/15 * * * *').trim();
  if (!cron.validate(pattern)) {
    logger.error('[padReconcile] Invalid PAD_RECONCILE_CRON', { pattern });
    return;
  }

  started = true;
  cron.schedule(pattern, () => {
    void Promise.all([reconcilePendingAuthorizations(prisma), reconcilePendingPadTransactions(prisma)])
      .then(([authorizations, transactions]) => {
        if (authorizations.activated > 0 || transactions.updated > 0) {
          logger.info('[padReconcile] sweep results', {
            activated: authorizations.activated,
            authorizationsChecked: authorizations.checked,
            updated: transactions.updated,
            transactionsChecked: transactions.checked,
          });
        }
      })
      .catch((err) => {
        logger.error('[padReconcile] sweep failed', { error: err });
      });
  });

  logger.info('[padReconcile] Scheduled PAD reconciliation sweep', { pattern });
}
