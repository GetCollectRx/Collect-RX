import cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import { connectorMonitorEnabled, sweepConnectorHealth } from '../services/connectorSyncMonitor.js';
import { logger } from '../observability/logger.js';

let started = false;

/**
 * Cron sweep for stale/failed desktop connectors. Runs in API process (no Redis required).
 */
export function startConnectorMonitorScheduler(prisma: PrismaClient): void {
  if (started) return;
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return;
  }
  if (!connectorMonitorEnabled()) {
    logger.info('[connectorMonitor] Disabled (set CONNECTOR_MONITOR_ENABLED=1 to enable)', {});
    return;
  }

  const pattern = (process.env.CONNECTOR_MONITOR_CRON || '*/15 * * * *').trim();
  if (!cron.validate(pattern)) {
    logger.error('[connectorMonitor] Invalid CONNECTOR_MONITOR_CRON', { pattern });
    return;
  }

  started = true;
  cron.schedule(pattern, () => {
    void sweepConnectorHealth(prisma)
      .then((r) => {
        if (r.alerts.length > 0) {
          logger.warn('[connectorMonitor] alerts from active connectors', {
            alertCount: r.alerts.length,
            checked: r.checked,
          });
        }
      })
      .catch((err) => {
        logger.error('[connectorMonitor] sweep failed', { error: err });
      });
  });

  logger.info('[connectorMonitor] Scheduled connector health sweep', { pattern });
}
