// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Alert Service
//
// Sends SMS (via Twilio) and email (via nodemailer) notifications when
// critical events occur, most importantly CARRIER_BLOCK detection.
//
// Required env vars:
//   TWILIO_ACCOUNT_SID   — Twilio account SID
//   TWILIO_AUTH_TOKEN    — Twilio auth token
//   TWILIO_FROM_NUMBER   — Twilio phone number (e.g. +16135551234)
//   ALERT_SMS_TO         — comma-separated list of numbers to alert
//   SMTP_HOST            — SMTP server hostname
//   SMTP_PORT            — SMTP server port (default 587)
//   SMTP_USER            — SMTP username
//   SMTP_PASS            — SMTP password
//   ALERT_EMAIL_TO       — comma-separated list of emails to alert
//   ALERT_EMAIL_FROM     — sender address
// ─────────────────────────────────────────────────────────────────────────────

import type { CarrierId } from '@prisma/client';
import { CARRIER_CONFIGS } from '../carriers/adapter';

export interface CarrierBlockAlertParams {
  practiceId: string;
  carrierId: CarrierId;
  vapiCallId: string;
  outcomeDetail: string;
}

// ---------------------------------------------------------------------------
// SMS via Twilio
// ---------------------------------------------------------------------------

async function sendSmsAlert(message: string): Promise<void> {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, ALERT_SMS_TO } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !ALERT_SMS_TO) {
    console.warn('[alerts] Twilio env vars not set — skipping SMS alert');
    return;
  }

  const twilio = (await import('twilio')).default;
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  const recipients = ALERT_SMS_TO.split(',').map((n) => n.trim()).filter(Boolean);

  await Promise.allSettled(
    recipients.map((to) =>
      client.messages.create({ body: message, from: TWILIO_FROM_NUMBER, to }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Email via nodemailer
// ---------------------------------------------------------------------------

async function sendEmailAlert(subject: string, html: string): Promise<void> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO, ALERT_EMAIL_FROM } =
    process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !ALERT_EMAIL_TO) {
    console.warn('[alerts] SMTP env vars not set — skipping email alert');
    return;
  }

  const nodemailer = (await import('nodemailer')).default;
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT ?? '587', 10),
    secure: parseInt(SMTP_PORT ?? '587', 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const recipients = ALERT_EMAIL_TO.split(',').map((e) => e.trim()).filter(Boolean);

  await transporter.sendMail({
    from: ALERT_EMAIL_FROM ?? `CollectRx <${SMTP_USER}>`,
    to:   recipients.join(','),
    subject,
    html,
  });
}

// ---------------------------------------------------------------------------
// Public: CARRIER_BLOCK alert
// ---------------------------------------------------------------------------

/**
 * Send SMS + email alert when a carrier block event is detected.
 * Called by the Vapi webhook handler AFTER writing the CarrierBlockEvent to DB.
 *
 * Non-fatal: errors are logged but do not propagate — the webhook must still
 * return 200 to Vapi even if alerts fail.
 */
export async function sendCarrierBlockAlert(params: CarrierBlockAlertParams): Promise<void> {
  const { practiceId, carrierId, vapiCallId, outcomeDetail } = params;
  const carrierName = CARRIER_CONFIGS[carrierId]?.displayName ?? carrierId;
  const ts = new Date().toISOString();

  const smsMessage =
    `🚨 CARRIER BLOCK DETECTED — CollectRx\n` +
    `Carrier: ${carrierName}\n` +
    `Practice: ${practiceId}\n` +
    `Call: ${vapiCallId}\n` +
    `Time: ${ts}\n` +
    `All calls to ${carrierName} are now SUSPENDED.\n` +
    `Unblock via: POST /api/carriers/${carrierId}/unblock`;

  const emailHtml = `
    <h2 style="color:#c0392b">⚠️ CARRIER BLOCK DETECTED</h2>
    <table style="font-family:monospace;font-size:14px;border-collapse:collapse">
      <tr><td style="padding:4px 12px;font-weight:bold">Carrier</td><td>${carrierName}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold">Practice ID</td><td>${practiceId}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold">Vapi Call ID</td><td>${vapiCallId}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold">Detected At</td><td>${ts}</td></tr>
      <tr><td style="padding:4px 12px;font-weight:bold">Detail</td><td>${outcomeDetail}</td></tr>
    </table>
    <p style="color:#c0392b"><strong>All calls to ${carrierName} for practice ${practiceId} are now SUSPENDED.</strong></p>
    <p>Investigate manually, then resume via:<br>
    <code>POST /api/carriers/${carrierId}/unblock</code></p>
    <hr>
    <p style="font-size:12px;color:#666">CollectRx — automated AR platform</p>
  `;

  await Promise.allSettled([
    sendSmsAlert(smsMessage),
    sendEmailAlert(`[URGENT] CollectRx: Carrier Block — ${carrierName}`, emailHtml),
  ]);

  console.log(`[alerts] Carrier block alerts sent for ${carrierId} / practice ${practiceId}`);
}
