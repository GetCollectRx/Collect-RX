/**
 * In-process ops monitor — fires alerts when runtime health degrades.
 * Enable with OPS_MONITOR_ENABLED=1 (and OPS_ALERTS_ENABLED=1).
 */
import type { PrismaClient } from '@prisma/client';
import { getMetrics } from './metrics.js';
import { dispatchOpsAlert } from './opsAlerts.js';
import { logger } from './logger.js';
import {
  getQueueHealth,
  evaluateQueueHealthAlerts,
  defaultQueueHealthThresholds,
} from './queueHealth.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** Same three-state defaulting as `opsAlertsEnabled()` — see its comment for why. */
export function opsMonitorEnabled(): boolean {
  const raw = (process.env.OPS_MONITOR_ENABLED || '').trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(raw)) return true;
  if (['0', 'false', 'no'].includes(raw)) return false;
  return process.env.NODE_ENV === 'production';
}

export function startOpsMonitor(prisma: PrismaClient): void {
  if (!opsMonitorEnabled()) {
    return;
  }

  const intervalMs = Math.max(60_000, Number(process.env.OPS_MONITOR_INTERVAL_MS || DEFAULT_INTERVAL_MS));

  const tick = async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      await dispatchOpsAlert({
        alertId: 'database_readiness',
        detail: (err as Error).message,
        source: 'ops-monitor',
      });
    }

    const m = getMetrics();
    const requests = m.http?.requests ?? 0;
    const errors5xx = m.http?.errors5xx ?? 0;
    const minRequests = Number(process.env.OPS_ALERT_5XX_MIN_REQUESTS || 20);
    const ratioThreshold = Number(process.env.OPS_ALERT_5XX_RATIO || 0.1);

    if (requests >= minRequests && errors5xx / requests >= ratioThreshold) {
      await dispatchOpsAlert({
        alertId: 'high_5xx_rate',
        detail: `${errors5xx} errors / ${requests} requests (${Math.round((100 * errors5xx) / requests)}%)`,
        source: 'ops-monitor',
      });
    }

    const emrFailed = m.emrOutbox?.failed ?? 0;
    const emrDelivered = m.emrOutbox?.delivered ?? 0;
    const emrMinFailed = Number(process.env.OPS_ALERT_EMR_MIN_FAILED || 3);
    if (emrFailed >= emrMinFailed && emrFailed > emrDelivered) {
      await dispatchOpsAlert({
        alertId: 'emr_outbox_failures',
        detail: `failed=${emrFailed} delivered=${emrDelivered} (since process boot)`,
        source: 'ops-monitor',
      });
    }

    // Queue health — the signal that catches silent dispatch stalls and stuck
    // call locks (see queueHealth.ts). A DB hiccup here must not kill the tick.
    try {
      const snapshot = await getQueueHealth(prisma);
      const alerts = evaluateQueueHealthAlerts(snapshot, defaultQueueHealthThresholds());
      for (const alert of alerts) {
        await dispatchOpsAlert({
          alertId: alert.alertId,
          detail: alert.detail,
          source: 'ops-monitor',
        });
      }
    } catch (err) {
      logger.error('[opsMonitor] queue health check failed', { error: err });
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, intervalMs).unref?.();

  logger.info('[opsMonitor] Started', { intervalMs });
}
