/**
 * Practice Notification Service
 * Sends notifications to practices about escalations, validation issues, and other events
 */

import type { PrismaClient } from '@prisma/client';

export interface PracticeNotification {
  practiceId: string;
  type: 'VALIDATION_ESCALATION' | 'CARRIER_BLOCK' | 'PAYMENT_RECEIVED' | 'CLAIM_DENIED' | 'ACTION_OVERDUE';
  subject: string;
  message: string;
  claimId?: string;
  severity?: 'info' | 'warning' | 'critical';
}

/**
 * Send notification to practice
 * Current implementation: stores in DB for dashboard display
 * Future: email, SMS, webhook, Slack integration
 */
export async function sendPracticeNotification(
  prisma: PrismaClient,
  notification: PracticeNotification,
): Promise<void> {
  try {
    // Store notification in DB for dashboard
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

    // TODO: Email integration
    // TODO: Slack webhook integration
    // TODO: SMS for critical severity

    console.log(
      `[notification] Practice ${notification.practiceId} notified: ${notification.type}`,
    );
  } catch (err) {
    console.error('[practiceNotificationService] Failed to send notification:', err);
    throw err;
  }
}
