/**
 * CollectRx — Patient Reminder Engine
 *
 * Runs once daily at 9:00 AM (configurable via REMINDER_CRON).
 * Finds patient balances that have crossed a reminder threshold and sends
 * email (SendGrid) + SMS (Twilio) with their Stripe payment link.
 *
 * Thresholds (days since adjudication):
 *   none → reminder_1  :  day 7
 *   reminder_1 → reminder_2 : day 21
 *   reminder_2 → reminder_3 : day 45
 *
 * Rate-limit: max 1 message per channel per patient per 7-day window.
 */

import cron from 'node-cron';
import { getReminderCandidates, recordReminderSent, setPaymentLink } from './balances';
import { generatePaymentLink } from '../stripe/connect';
import { sendEmail, sendSMS } from './messaging';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function nextReminderStatus(current: string): string {
  const map: Record<string, string> = { none: 'reminder_1', reminder_1: 'reminder_2', reminder_2: 'reminder_3' };
  return map[current] || 'reminder_3';
}

// Build/retrieve payment link
async function ensurePaymentLink(balance: any): Promise<string | null> {
  if (balance.stripePaymentLink) return balance.stripePaymentLink;

  // Get Stripe account for practice
  if (!balance.practiceId) return null;

  const stripeAccount = await prisma.stripeConnectAccount.findUnique({
    where: { practiceId: balance.practiceId },
  });

  if (!stripeAccount?.chargesEnabled) return null;

  try {
    const { url, id } = await generatePaymentLink(balance, stripeAccount.stripeAccountId);
    await setPaymentLink(balance.id, url, id);
    return url;
  } catch (err) {
    console.warn('Could not generate Stripe payment link', { balanceId: balance.id, error: (err as Error).message });
    return null;
  }
}

// Core reminder cycle
export async function runReminderCycle(): Promise<{ sent: number; skipped: number; error?: string }> {
  console.log('Reminder engine: starting cycle');

  let candidates;
  try {
    candidates = await getReminderCandidates();
  } catch (err) {
    console.error('Reminder engine: failed to load candidates', { error: (err as Error).message });
    return { sent: 0, skipped: 0, error: (err as Error).message };
  }

  console.log(`Reminder engine: ${candidates.length} candidate(s)`);

  let sent = 0;
  let skipped = 0;

  for (const balance of candidates) {
    try {
      // Check per-channel 7-day rate limit for SMS separately
      const smsRecentlySent = balance.lastReminderSmsAt
        && (Date.now() - new Date(balance.lastReminderSmsAt).getTime()) < 7 * 86_400_000;

      const paymentLink = await ensurePaymentLink(balance);
      const nextStatus = nextReminderStatus(balance.reminderStatus);

      const balanceForMessaging = {
        id: balance.id,
        patientFirstName: balance.patientFirstName,
        patientEmail: balance.patientEmail,
        patientPhone: balance.patientPhone,
        patientOwes: Number(balance.patientOwes),
        treatmentDate: balance.treatmentDate,
        reminderStatus: balance.reminderStatus,
      };

      const emailSent = await sendEmail(balanceForMessaging, paymentLink);
      const smsSent = !smsRecentlySent && await sendSMS(balanceForMessaging, paymentLink);

      if (emailSent || smsSent) {
        await recordReminderSent(balance.id, { emailSent, smsSent, nextStatus });
        sent++;
        console.log('Reminder sent', {
          balanceId: balance.id, nextStatus, emailSent, smsSent,
        });
      } else {
        skipped++;
        console.log('Reminder skipped (no contact info or send failed)', { balanceId: balance.id });
      }
    } catch (err) {
      console.error('Reminder engine: error processing balance', {
        balanceId: balance.id, error: (err as Error).message,
      });
      skipped++;
    }
  }

  console.log(`Reminder engine: cycle complete — ${sent} sent, ${skipped} skipped`);
  return { sent, skipped };
}

// Scheduler
export function startReminderEngine() {
  const expression = process.env.REMINDER_CRON || '0 9 * * *'; // 9:00 AM every day

  if (!cron.validate(expression)) {
    console.error(`Invalid REMINDER_CRON expression: "${expression}" — reminder engine not started`);
    return;
  }

  cron.schedule(expression, () => {
    runReminderCycle().catch(err =>
      console.error('Reminder engine: unhandled error in cycle', { error: (err as Error).message })
    );
  });

  console.log(`Reminder engine scheduled: "${expression}"`);
}
