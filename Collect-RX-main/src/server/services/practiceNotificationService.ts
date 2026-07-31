/**
 * Practice Notification Service
 * Sends notifications to practices about CDCP reconsiderations, learning cycles, and other events
 * Integrations: DB (dashboard), Email (SendGrid), SMS (Twilio), Slack (webhooks)
 */

import type { PrismaClient } from '@prisma/client';

export interface PracticeNotification {
  practiceId: string;
  type: 'CDCP_RECONSIDERATION' | 'LEARNING_CYCLE_COMPLETE' | 'VALIDATION_ESCALATION' | 'CARRIER_BLOCK' | 'PAYMENT_RECEIVED' | 'PAYMENT_FAILED' | 'CLAIM_DENIED' | 'ACTION_OVERDUE';
  subject: string;
  message: string;
  claimId?: string;
  severity?: 'info' | 'warning' | 'critical';
}

export interface CdcpNotificationData {
  practiceId: string;
  claimRef: string;
  status: string;
  submissionMethod?: string;
  confirmationNumber?: string;
  notes?: string;
}

export interface LearningCycleSummaryData {
  practiceId: string;
  cycleId: string;
  pulled: number;
  researched: number;
  implemented: string[];
  topRanked: Array<{ title: string; rankScore: number; feasibilityScore: number }>;
}

function getBaseUrl(): string {
  return (process.env.PUBLIC_APP_URL || process.env.SERVER_URL || 'http://localhost:5173').replace(/\/$/, '');
}

async function sendEmail(
  to: string[],
  subject: string,
  text: string,
  html?: string,
): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  if (!apiKey || to.length === 0) {
    console.warn('[practiceNotificationService] Email skipped: no API key or recipients');
    return false;
  }

  try {
    const sg = await import('@sendgrid/mail');
    sg.default.setApiKey(apiKey);
    await sg.default.send({
      to,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'notifications@collectrx.ca',
        name: 'CollectRx',
      },
      subject: subject.slice(0, 200),
      text,
      html: html || `<p>${text.replace(/\n/g, '<br>')}</p>`,
    });
    return true;
  } catch (err) {
    console.error('[practiceNotificationService] Email failed:', (err as Error).message);
    return false;
  }
}

async function sendSms(message: string, recipients?: string[]): Promise<boolean> {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
  const alertTo = recipients || process.env.ALERT_SMS_TO?.trim()?.split(',').map(n => n.trim()).filter(Boolean) || [];

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || alertTo.length === 0) {
    console.warn('[practiceNotificationService] SMS skipped: missing config or recipients');
    return false;
  }

  try {
    const twilio = (await import('twilio')).default;
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    await Promise.allSettled(
      alertTo.map((to) =>
        client.messages.create({ body: message.slice(0, 1500), from: TWILIO_FROM_NUMBER, to }),
      ),
    );
    return true;
  } catch (err) {
    console.error('[practiceNotificationService] SMS failed:', (err as Error).message);
    return false;
  }
}

async function sendSlackWebhook(payload: Record<string, unknown>): Promise<boolean> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    console.warn('[practiceNotificationService] Slack skipped: no webhook URL');
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[practiceNotificationService] Slack webhook failed: ${response.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[practiceNotificationService] Slack request failed:', (err as Error).message);
    return false;
  }
}

/**
 * Store notification in DB for dashboard display
 */
export async function sendPracticeNotification(
  prisma: PrismaClient,
  notification: PracticeNotification,
): Promise<void> {
  try {
    await prisma.practiceNotification.create({
      data: {
        practiceId: notification.practiceId,
        type: notification.type,
        subject: notification.subject,
        message: notification.message,
        claimId: notification.claimId,
        severity: notification.severity || 'info',
        readAt: null,
      },
    });

    console.log(
      `[notification] Practice ${notification.practiceId} notified: ${notification.type}`,
    );
  } catch (err) {
    console.error('[practiceNotificationService] Failed to store notification:', err);
    throw err;
  }
}

/**
 * Send CDCP reconsideration update notification
 * Channels: Email (staff), Slack (ops)
 */
export async function sendCdcpReconsiderationNotification(
  prisma: PrismaClient,
  data: CdcpNotificationData,
): Promise<void> {
  try {
    // Store in DB
    await sendPracticeNotification(prisma, {
      practiceId: data.practiceId,
      type: 'CDCP_RECONSIDERATION',
      subject: `CDCP Reconsideration: ${data.claimRef}`,
      message: `Status: ${data.status}${data.confirmationNumber ? ` | Confirmation: ${data.confirmationNumber}` : ''}`,
      severity: data.status === 'submitted' ? 'warning' : 'info',
    });

    // Email staff
    const staff = await prisma.user.findMany({
      where: {
        practiceId: data.practiceId,
        isActive: true,
        role: { in: ['practice_owner', 'office_manager', 'billing_coordinator'] },
      },
      select: { email: true },
    });

    const emailTo = staff.map(u => u.email).filter(Boolean);
    if (emailTo.length > 0) {
      const emailBody = [
        `CDCP Reconsideration Update: ${data.claimRef}`,
        `Status: ${data.status}`,
        data.submissionMethod ? `Submission Method: ${data.submissionMethod}` : '',
        data.confirmationNumber ? `Confirmation Number: ${data.confirmationNumber}` : '',
        data.notes ? `Notes: ${data.notes}` : '',
        `View details: ${getBaseUrl()}/cdcp`,
      ]
        .filter(Boolean)
        .join('\n');

      await sendEmail(emailTo, `CDCP Reconsideration: ${data.claimRef}`, emailBody);
    }

    // Slack ops notification for submitted reconsiderations
    if (data.status === 'submitted') {
      await sendSlackWebhook({
        text: `📋 CDCP Reconsideration Submitted`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*CDCP Reconsideration Submitted*\nPractice: ${data.practiceId}\nClaim: ${data.claimRef}\nConfirmation: ${data.confirmationNumber || 'pending'}`,
            },
          },
        ],
      });
    }
  } catch (err) {
    console.error('[practiceNotificationService] CDCP notification error:', err);
  }
}

/**
 * Send learning cycle summary notification
 * Channels: Email (practice owners), SMS (critical alerts), Slack (ops)
 */
export async function sendLearningCycleSummaryNotification(
  prisma: PrismaClient,
  data: LearningCycleSummaryData,
): Promise<void> {
  try {
    const implemented =
      data.implemented.length > 0
        ? data.implemented.join('; ')
        : 'none this cycle';

    const topRanked =
      data.topRanked.length > 0
        ? data.topRanked
            .slice(0, 3)
            .map((t) => `${t.title} (R${t.rankScore}/F${t.feasibilityScore})`)
            .join(' | ')
        : 'n/a';

    const summaryText = [
      `CollectRx Phase 6 — Learning Cycle Complete`,
      `Pulled: ${data.pulled} | Researched: ${data.researched}`,
      `Implemented: ${implemented}`,
      `Top Ranked: ${topRanked}`,
    ].join('\n');

    // Store in DB
    await sendPracticeNotification(prisma, {
      practiceId: data.practiceId,
      type: 'LEARNING_CYCLE_COMPLETE',
      subject: 'Learning Cycle Summary',
      message: summaryText,
      severity: 'info',
    });

    // Email practice owners
    const owners = await prisma.user.findMany({
      where: {
        practiceId: data.practiceId,
        isActive: true,
        role: 'practice_owner',
      },
      select: { email: true },
    });

    const emailTo = owners.map(u => u.email).filter(Boolean);
    if (emailTo.length > 0) {
      const emailBody = [
        `Your Practice Learning Cycle Summary`,
        '',
        `Pulled: ${data.pulled} candidates`,
        `Researched: ${data.researched}`,
        `Implemented: ${implemented}`,
        '',
        `Top Ranked Items:`,
        ...data.topRanked.slice(0, 3).map(t => `• ${t.title} (Rank: ${t.rankScore}, Feasibility: ${t.feasibilityScore})`),
        '',
        `View full results: ${getBaseUrl()}/analytics/learning`,
      ].join('\n');

      const htmlBody = emailBody.replace(/\n/g, '<br>').replace(/• /g, '&bull; ');
      await sendEmail(emailTo, 'Learning Cycle Complete', emailBody, `<p>${htmlBody}</p>`);
    }

    // SMS for critical implementations
    if (data.implemented.length > 0) {
      const smsMessage = `CollectRx Phase 6: ${data.implemented.length} improvements implemented. ${data.topRanked.length > 0 ? `Top item: ${data.topRanked[0]?.title.slice(0, 40)}` : ''}`;
      await sendSms(smsMessage);
    }

    // Slack ops notification
    await sendSlackWebhook({
      text: `🧠 Learning Cycle Complete`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Learning Cycle Summary*\nPractice: ${data.practiceId}\nPulled: ${data.pulled} | Researched: ${data.researched}\nImplemented: ${implemented}`,
          },
        },
      ],
    });
  } catch (err) {
    console.error('[practiceNotificationService] Learning cycle notification error:', err);
  }
}

/**
 * Send critical alert for carrier block or urgent reconsiderations
 * Channels: Email, SMS, Slack
 */
export async function sendCriticalAlert(
  prisma: PrismaClient,
  practiceId: string,
  title: string,
  message: string,
): Promise<void> {
  try {
    await sendPracticeNotification(prisma, {
      practiceId,
      type: 'CARRIER_BLOCK',
      subject: title,
      message,
      severity: 'critical',
    });

    // Email staff
    const staff = await prisma.user.findMany({
      where: {
        practiceId,
        isActive: true,
        role: { in: ['practice_owner', 'office_manager', 'billing_coordinator'] },
      },
      select: { email: true },
    });

    const emailTo = staff.map(u => u.email).filter(Boolean);
    if (emailTo.length > 0) {
      await sendEmail(emailTo, `⚠️ URGENT: ${title}`, message);
    }

    // SMS alert
    const smsMessage = `⚠️ CollectRx Alert: ${title}. ${message.slice(0, 100)}`;
    await sendSms(smsMessage);

    // Slack critical alert
    await sendSlackWebhook({
      text: `🚨 CRITICAL ALERT`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🚨 ${title}*\nPractice: ${practiceId}\n${message}`,
          },
        },
      ],
    });
  } catch (err) {
    console.error('[practiceNotificationService] Critical alert error:', err);
  }
}
