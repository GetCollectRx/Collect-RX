/**
 * Practice desktop connector health sweep — alerts ops when sync stops or fails.
 */
import type { PrismaClient } from '@prisma/client';
import { connectorHealth } from './desktopConnectorService.js';
import { dispatchOpsAlert, type OpsAlertPayload } from '../observability/opsAlerts.js';
import { appendAuditLog } from '../audit/auditLog.js';
import { logger } from '../observability/logger.js';

const STALE_MS = 30 * 60 * 1000;

export interface ConnectorSweepResult {
  checked: number;
  alerts: OpsAlertPayload[];
}

export async function sweepConnectorHealth(prisma: PrismaClient): Promise<ConnectorSweepResult> {
  const agents = await prisma.desktopConnectorAgent.findMany({
    where: { revokedAt: null },
    orderBy: { practiceId: 'asc' },
  });

  const alerts: OpsAlertPayload[] = [];

  for (const agent of agents) {
    const health = connectorHealth(agent);
    const label = `${agent.label} (${agent.hostname ?? 'unknown host'})`;

    if (health === 'error') {
      const payload: OpsAlertPayload = {
        alertId: 'connector_sync_failed',
        detail: `Practice ${agent.practiceId}: ${label} — ${agent.lastSyncMessage ?? 'sync error'}`,
        source: `connector:${agent.id}`,
      };
      alerts.push(payload);
      void appendAuditLog(prisma, {
        practiceId: agent.practiceId,
        action: 'connector.alert.sync_failed',
        subjectType: 'DesktopConnectorAgent',
        subjectId: agent.id,
        details: { message: agent.lastSyncMessage },
      });
    } else if (health === 'stale' || health === 'never') {
      const age = agent.lastHeartbeatAt
        ? `${Math.round((Date.now() - agent.lastHeartbeatAt.getTime()) / 60_000)}m ago`
        : 'never';
      const payload: OpsAlertPayload = {
        alertId: 'connector_stale',
        detail: `Practice ${agent.practiceId}: ${label} — last heartbeat ${age}`,
        source: `connector:${agent.id}`,
      };
      alerts.push(payload);
      void appendAuditLog(prisma, {
        practiceId: agent.practiceId,
        action: 'connector.alert.stale',
        subjectType: 'DesktopConnectorAgent',
        subjectId: agent.id,
        details: { lastHeartbeatAt: agent.lastHeartbeatAt?.toISOString() ?? null },
      });
    }
  }

  for (const payload of alerts) {
    await dispatchOpsAlert(payload).catch((err) => {
      logger.error('[connectorSyncMonitor] alert dispatch failed', { error: err });
    });
  }

  return { checked: agents.length, alerts };
}

export function connectorMonitorEnabled(): boolean {
  return !['0', 'false', 'no'].includes(
    (process.env.CONNECTOR_MONITOR_ENABLED ?? process.env.OPS_ALERTS_ENABLED ?? '1')
      .trim()
      .toLowerCase(),
  );
}

export { STALE_MS };
