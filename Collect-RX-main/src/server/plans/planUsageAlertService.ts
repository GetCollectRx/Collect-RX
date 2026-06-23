import type { PrismaClient } from '@prisma/client';
import { getPracticeSettings, updatePracticeSettings } from '../services/practiceSettingsService.js';
import { getPlanSummary, type UsageAlert } from './planBridge.js';
import { sendPlanUsageAlertEmail } from '../email/planUsageAlert.js';

type AlertSentMap = Record<string, boolean>;

function cycleAlertKey(cycleStartedAt: string | Date | undefined): string {
  const d = cycleStartedAt ? new Date(cycleStartedAt) : new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function alertEmailCodes(alerts: UsageAlert[]): string[] {
  return alerts
    .filter((a) => a.code.endsWith('_80') || a.code.endsWith('_95') || a.code.endsWith('_100') || a.code === 'TRIAL_LIMIT_REACHED')
    .map((a) => a.code);
}

/**
 * After usage increments, email owners when a threshold alert is newly crossed.
 * Dedupes per billing cycle using practice.settings.planUsageAlertsSent.
 */
export async function maybeSendPlanUsageAlertEmails(
  prisma: PrismaClient,
  practiceId: string,
): Promise<void> {
  const settings = await getPracticeSettings(prisma, practiceId);
  if (!settings.usageAlertEmailsEnabled) return;

  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    select: { name: true, subscriptionCurrentPeriodEnd: true },
  });
  if (!practice) return;

  const summary = await getPlanSummary(practiceId, practice.subscriptionCurrentPeriodEnd);
  const cycleKey = cycleAlertKey(summary.cycle?.startedAt);
  if (settings.planUsageAlertCycleKey !== cycleKey) {
    settings.planUsageAlertCycleKey = cycleKey;
    settings.planUsageAlertsSent = {};
  }

  const sent: AlertSentMap = { ...(settings.planUsageAlertsSent ?? {}) };
  const codes = alertEmailCodes(summary.alerts);
  const fresh = codes.filter((c) => !sent[c]);
  if (fresh.length === 0) return;

  const users = await prisma.user.findMany({
    where: {
      practiceId,
      isActive: true,
      role: { in: ['practice_owner', 'office_manager', 'billing_coordinator'] },
    },
    select: { email: true, displayName: true, role: true },
  });

  const recipients = users.filter((u) => {
    if (u.role === 'practice_owner') return true;
    if (u.role === 'office_manager') return settings.usageVisibleToOfficeManager;
    if (u.role === 'billing_coordinator') return settings.usageVisibleToBillingCoordinator;
    return false;
  });

  if (recipients.length === 0) return;

  for (const code of fresh) {
    const alert = summary.alerts.find((a: UsageAlert) => a.code === code);
    if (!alert) continue;

    const subject =
      alert.level === 'critical'
        ? `[CollectRx] Plan limit reached — ${practice.name}`
        : `[CollectRx] Plan usage alert — ${practice.name}`;

    for (const user of recipients) {
      await sendPlanUsageAlertEmail({
        toEmail: user.email,
        displayName: user.displayName,
        practiceName: practice.name,
        subject,
        bodyLines: [alert.message],
      });
    }
    sent[code] = true;
  }

  await updatePracticeSettings(prisma, practiceId, {
    planUsageAlertCycleKey: cycleKey,
    planUsageAlertsSent: sent,
  });
}
