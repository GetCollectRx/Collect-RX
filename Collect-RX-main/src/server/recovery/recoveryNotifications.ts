import type { PrismaClient } from '@prisma/client';
import { dispatchOpsAlert, opsAlertsEnabled } from '../observability/opsAlerts.js';
import { logger } from '../observability/logger.js';

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
const gateAlertCooldownMs = () =>
  Math.max(5, Number(process.env.PRACTICE_GATE_ALERT_COOLDOWN_MINUTES || 30)) * 60 * 1000;

const lastGateAlertSent = new Map<string, number>();

export function practiceGateAlertsEnabled(): boolean {
  return ['1', 'true', 'yes'].includes(
    (process.env.PRACTICE_GATE_ALERTS_ENABLED || process.env.OPS_ALERTS_ENABLED || '').trim().toLowerCase(),
  );
}

function appBaseUrl(): string {
  return (process.env.PUBLIC_APP_URL || process.env.SERVER_URL || 'http://localhost:5173').replace(/\/$/, '');
}

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

async function sendPracticeEmail(
  to: string[],
  subject: string,
  text: string,
): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  if (!apiKey || to.length === 0) return false;
  const sg = await import('@sendgrid/mail');
  sg.default.setApiKey(apiKey);
  await sg.default.send({
    to,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'ops@collectrx.ca',
      name: process.env.PRACTICE_ALERT_EMAIL_FROM_NAME || 'CollectRx',
    },
    subject: subject.slice(0, 200),
    text,
    html: `<p>${text.replace(/\n/g, '<br>')}</p>`,
  });
  return true;
}

async function sendPracticeSms(message: string): Promise<boolean> {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  const toRaw =
    process.env.PRACTICE_GATE_SMS_TO?.trim() || process.env.ALERT_SMS_TO?.trim();
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !toRaw) {
    return false;
  }
  const twilio = (await import('twilio')).default;
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const recipients = toRaw.split(',').map((n) => n.trim()).filter(Boolean);
  await Promise.allSettled(
    recipients.map((to) =>
      client.messages.create({ body: message.slice(0, 1500), from: TWILIO_FROM_NUMBER, to }),
    ),
  );
  return true;
}

/** SMS + email when a new blocking practice gate opens (cooldown per gate). */
export async function notifyPracticeOnBlockingGate(
  prisma: PrismaClient,
  params: {
    practiceId: string;
    gateId: string;
    claimId: string;
    claimNumber: string;
    title: string;
    detail: string | null;
  },
): Promise<void> {
  if (!practiceGateAlertsEnabled()) return;

  const key = `gate:${params.gateId}`;
  const last = lastGateAlertSent.get(key) ?? 0;
  if (Date.now() - last < gateAlertCooldownMs()) return;

  const claimUrl = `${appBaseUrl()}/insurance/${params.claimId}`;
  const text = [
    `CollectRx — practice gate opened on claim ${params.claimNumber}`,
    params.title,
    params.detail ?? 'Complete this step so carrier calls can resume.',
    claimUrl,
  ].join('\n');

  const staff = await prisma.user.findMany({
    where: {
      practiceId: params.practiceId,
      isActive: true,
      role: { in: ['practice_owner', 'office_manager', 'billing_coordinator'] },
    },
    select: { email: true },
  });
  const emails = staff.map((u) => u.email).filter(Boolean);
  const overrideTo = process.env.PRACTICE_GATE_EMAIL_TO?.trim();
  const emailTo = overrideTo
    ? overrideTo.split(',').map((e) => e.trim()).filter(Boolean)
    : emails;

  const channels: string[] = [];
  if (await sendPracticeEmail(emailTo, `Gate opened — ${params.claimNumber}`, text).catch(() => false)) {
    channels.push('email');
  }
  if (await sendPracticeSms(text).catch(() => false)) {
    channels.push('sms');
  }

  if (channels.length > 0) {
    lastGateAlertSent.set(key, Date.now());
    logger.info('[recoveryNotifications] Gate alert sent', {
      claimNumber: params.claimNumber,
      channels,
    });
  }
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
