/**
 * CollectRx — Patient Reminder Messaging
 *
 * Shared by reminder-engine.ts (automated daily runs) and patient routes
 * (manual "Send reminder" button in the dashboard).
 *
 * PHI constraint: only patient first name and balance amount leave this system.
 */

import { buildEmailUnsubscribeUrl } from '../email/unsubscribeUrl.js';

interface Balance {
  id: string;
  patientFirstName: string;
  patientEmail?: string | null;
  patientPhone?: string | null;
  patientOwes: number;
  treatmentDate?: Date | string | null;
  reminderStatus: string;
  /** P4-03: if set, do not send SMS (Twilio STOP). */
  smsOptOutAt?: Date | string | null;
  /** P4-02: if set, do not send balance reminder email (unsubscribe or bounce). */
  emailOptOutAt?: Date | string | null;
}

// Lazy clients
function getSendGrid() {
  if (!process.env.SENDGRID_API_KEY) return null;
  const sg = require('@sendgrid/mail');
  sg.setApiKey(process.env.SENDGRID_API_KEY);
  return sg;
}

function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return require('twilio')(sid, token);
}

function fmt(amount: number): string {
  return `$${parseFloat(String(amount)).toFixed(2)}`;
}

// Send email via SendGrid
export async function sendEmail(balance: Balance, paymentLink?: string | null): Promise<boolean> {
  const sg = getSendGrid();
  if (!sg) return false;
  if (!balance.patientEmail) return false;
  if (balance.emailOptOutAt) return false;

  const firstName = balance.patientFirstName;
  const amount = fmt(balance.patientOwes);
  const reminderNum = { none: '1', reminder_1: '2', reminder_2: '3', reminder_3: '3' }[balance.reminderStatus] || '1';
  const linkLine = paymentLink ? `\n\nPay securely online: ${paymentLink}` : '';
  const treatmentDateStr = balance.treatmentDate
    ? new Date(balance.treatmentDate).toLocaleDateString('en-CA')
    : 'file';

  let unsubUrl = '';
  let listUnsubHeaders: Record<string, string> = {};
  try {
    unsubUrl = buildEmailUnsubscribeUrl(balance.id, balance.patientEmail);
    if (unsubUrl) {
      listUnsubHeaders = {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      };
    }
  } catch (e) {
    console.warn('Unsubscribe URL skipped', { balanceId: balance.id, err: (e as Error).message });
  }

  const footer = unsubUrl
    ? `\nTo stop balance reminder email from this system: ${unsubUrl}\n(Or contact your dental office.)\n`
    : '\nTo stop these emails, contact your dental office.\n';

  try {
    const msg: Record<string, unknown> = {
      to: balance.patientEmail,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'billing@collectrx.ca',
        name: process.env.SENDGRID_FROM_NAME || 'CollectRx Billing',
      },
      subject: `Balance reminder — ${amount} outstanding`,
      text: [
        `Hi ${firstName},`,
        '',
        `This is a friendly reminder that you have an outstanding balance of ${amount} ` +
        `from your dental visit on ${treatmentDateStr}.`,
        '',
        `Your insurance carrier has processed their portion — the remaining balance is your responsibility.`,
        linkLine,
        '',
        `If you have questions, please contact your dental office directly.`,
        '',
        `This is reminder ${reminderNum} of 3.`,
        '',
        'To contact your dental office, use the phone number on your statement.',
        footer,
      ].join('\n'),
      // P4-01 / P4-08: correlate bounces in Event Webhook to this balance
      customArgs: {
        balance_id: balance.id,
      },
    };
    if (Object.keys(listUnsubHeaders).length) {
      (msg as { headers: Record<string, string> }).headers = { ...listUnsubHeaders };
    }
    await sg.send(msg);
    return true;
  } catch (err) {
    console.error('SendGrid error', { balanceId: balance.id, error: (err as Error).message });
    return false;
  }
}

// Send SMS via Twilio
export async function sendSMS(balance: Balance, paymentLink?: string | null): Promise<boolean> {
  if (balance.smsOptOutAt) {
    return false;
  }
  const twilio = getTwilio();
  if (!twilio) return false;
  if (!balance.patientPhone) return false;

  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) return false;

  // Normalize to E.164
  let to = balance.patientPhone.replace(/\D/g, '');
  if (to.length === 10) to = `+1${to}`;
  else if (!to.startsWith('+')) to = `+${to}`;

  const base = `Hi ${balance.patientFirstName}, you have a ${fmt(balance.patientOwes)} dental balance outstanding.`;
  const line = paymentLink
    ? `${base} Pay here: ${paymentLink}`
    : `${base} Please contact your dental office.`;
  const body = `${line} Reply STOP to opt out. Msg&data rates may apply.`;

  try {
    await twilio.messages.create({ body, from, to });
    return true;
  } catch (err) {
    console.error('Twilio error', { balanceId: balance.id, error: (err as Error).message });
    return false;
  }
}

/** P4-08: transient provider errors (rate limits) — two attempts with backoff. */
export async function sendEmailWithRetry(
  balance: Balance,
  paymentLink?: string | null,
  attempts = 2
): Promise<boolean> {
  for (let a = 0; a < attempts; a++) {
    if (await sendEmail(balance, paymentLink)) {
      return true;
    }
    if (a < attempts - 1) {
      await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
    }
  }
  return false;
}

export async function sendSMSWithRetry(
  balance: Balance,
  paymentLink?: string | null,
  attempts = 2
): Promise<boolean> {
  for (let a = 0; a < attempts; a++) {
    if (await sendSMS(balance, paymentLink)) {
      return true;
    }
    if (a < attempts - 1) {
      await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
    }
  }
  return false;
}

/** P3-23 — on-screen is primary; email when SendGrid is configured. */
export async function sendPaymentReceiptEmail(
  to: string,
  firstName: string,
  amount: number
): Promise<boolean> {
  const sg = getSendGrid();
  if (!sg) return false;
  try {
    const amt = fmt(amount);
    await sg.send({
      to,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'billing@collectrx.ca',
        name: process.env.SENDGRID_FROM_NAME || 'CollectRx Billing',
      },
      subject: 'Payment received',
      text: `Hi ${firstName},\n\nWe received your payment of ${amt}. Thank you.\n\nIf you have questions, contact your dental office directly.\n`,
    });
    return true;
  } catch (err) {
    console.error('Receipt email error', { to: to.replace(/@.*/, '@…'), err: (err as Error).message });
    return false;
  }
}
