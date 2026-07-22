import cron from 'node-cron';
import type { PrismaClient } from '@prisma/client';
import { connectorMonitorEnabled, sweepConnectorHealth } from '../services/connectorSyncMonitor.js';

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
    console.log('[connectorMonitor] Disabled (set CONNECTOR_MONITOR_ENABLED=1 to enable)');
    return;
  }

  const pattern = (process.env.CONNECTOR_MONITOR_CRON || '*/15 * * * *').trim();
  if (!cron.validate(pattern)) {
    console.error(`[connectorMonitor] Invalid CONNECTOR_MONITOR_CRON "${pattern}"`);
    return;
  }

  started = true;
  cron.schedule(pattern, () => {
    void sweepConnectorHealth(prisma)
      .then((r) => {
        if (r.alerts.length > 0) {
          console.warn(
            `[connectorMonitor] ${r.alerts.length} alert(s) from ${r.checked} active connector(s)`,
          );
        }
      })
      .catch((err) => {
        console.error('[connectorMonitor] sweep failed:', (err as Error).message);
      });
  });

  console.log(`[connectorMonitor] Scheduled connector health sweep: cron "${pattern}"`);
}
