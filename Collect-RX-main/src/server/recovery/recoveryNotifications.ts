import type { PrismaClient } from '@prisma/client';
import { dispatchOpsAlert, opsAlertsEnabled } from '../observability/opsAlerts.js';

export interface RecoveryNotificationItem {
  id: string;
  kind: 'blocking_gate' | 'payment_trace_due';
  severity: 'info' | 'warning';
  title: string;
  detail: string;
  claimId: string;
  claimNumber: string;
  actionId?: string;
  dueAt: string | null;
  href: string;
}

const TRACE_WARNING_DAYS = Number(process.env.RECOVERY_TRACE_WARN_DAYS ?? 3);

export async function listRecoveryNotifications(
  prisma: PrismaClient,
  practiceId: string,
): Promise<RecoveryNotificationItem[]> {
  const now = new Date();
  const warnBefore = new Date(now.getTime() + TRACE_WARNING_DAYS * 86_400_000);
  const items: RecoveryNotificationItem[] = [];

  const gates = await prisma.claimRecoveryAction.findMany({
    where: { practiceId, status: 'BLOCKING', clearedAt: null },
    include: { claim: { select: { id: true, claimNumber: true } } },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  for (const g of gates) {
    items.push({
      id: `gate-${g.id}`,
      kind: 'blocking_gate',
      severity: 'warning',
      title: g.title,
      detail: g.detail ?? 'Practice action required before carrier calls resume.',
      claimId: g.claimId,
      claimNumber: g.claim.claimNumber,
      actionId: g.id,
      dueAt: null,
      href: `/insurance/${g.claimId}`,
    });
  }

  const traces = await prisma.claimRecoveryAction.findMany({
    where: {
      practiceId,
      actionType: 'PAYMENT_VERIFY_SYNC',
      status: 'OPEN',
      clearedAt: null,
      scheduledRecallAt: { lte: warnBefore },
    },
    include: { claim: { select: { id: true, claimNumber: true, paymentExpectedBy: true } } },
    take: 30,
  });

  for (const t of traces) {
    const due = t.scheduledRecallAt ?? t.claim.paymentExpectedBy;
    items.push({
      id: `trace-${t.id}`,
      kind: 'payment_trace_due',
      severity: due && due.getTime() <= now.getTime() ? 'warning' : 'info',
      title: 'Payment verification deadline approaching',
      detail: `Claim ${t.claim.claimNumber} — trace call if PMS balance unchanged.`,
      claimId: t.claimId,
      claimNumber: t.claim.claimNumber,
      dueAt: due?.toISOString() ?? null,
      href: `/insurance/${t.claimId}`,
    });
  }

  return items;
}

/** Rules-engine hook: email ops when gates open or traces due (cooldown via opsAlerts). */
export async function dispatchRecoveryPracticeAlerts(
  prisma: PrismaClient,
  practiceId: string,
): Promise<number> {
  if (!opsAlertsEnabled()) return 0;

  const notifications = await listRecoveryNotifications(prisma, practiceId);
  const urgent = notifications.filter((n) => n.severity === 'warning');
  if (urgent.length === 0) return 0;

  const detail = urgent
    .slice(0, 8)
    .map((n) => `• ${n.claimNumber}: ${n.title}`)
    .join('\n');

  await dispatchOpsAlert({
    alertId: 'recovery-practice-attention',
    title: `${urgent.length} recovery item(s) need attention`,
    detail: `Practice ${practiceId}\n${detail}`,
    source: `practice:${practiceId}`,
  });

  return urgent.length;
}
