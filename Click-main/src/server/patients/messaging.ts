/**
 * CollectRx — Patient Reminder Messaging
 *
 * Shared by reminder-engine.ts (automated daily runs) and patient routes
 * (manual "Send reminder" button in the dashboard).
 *
 * PHI constraint: only patient first name and balance amount leave this system.
 */

interface Balance {
  id: string;
  patientFirstName: string;
  patientEmail?: string | null;
  patientPhone?: string | null;
  patientOwes: number;
  treatmentDate?: Date | string | null;
  reminderStatus: string;
}

// Lazy clients
function getSendGrid() {
  if (!process.env.SENDGRID_API_KEY) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sg = require('@sendgrid/mail');
  sg.setApiKey(process.env.SENDGRID_API_KEY);
  return sg;
}

function getTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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

  const firstName = balance.patientFirstName;
  const amount = fmt(balance.patientOwes);
  const reminderNum = { none: '1', reminder_1: '2', reminder_2: '3', reminder_3: '3' }[balance.reminderStatus] || '1';
  const linkLine = paymentLink ? `\n\nPay securely online: ${paymentLink}` : '';
  const treatmentDateStr = balance.treatmentDate
    ? new Date(balance.treatmentDate).toLocaleDateString('en-CA')
    : 'file';

  try {
    await sg.send({
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
      ].join('\n'),
    });
    return true;
  } catch (err) {
    console.error('SendGrid error', { balanceId: balance.id, error: (err as Error).message });
    return false;
  }
}

// Send SMS via Twilio
export async function sendSMS(balance: Balance, paymentLink?: string | null): Promise<boolean> {
  const twilio = getTwilio();
  if (!twilio) return false;
  if (!balance.patientPhone) return false;

  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) return false;

  // Normalize to E.164
  let to = balance.patientPhone.replace(/\D/g, '');
  if (to.length === 10) to = `+1${to}`;
  else if (!to.startsWith('+')) to = `+${to}`;

  const body = paymentLink
    ? `Hi ${balance.patientFirstName}, you have a ${fmt(balance.patientOwes)} dental balance outstanding. Pay here: ${paymentLink}`
    : `Hi ${balance.patientFirstName}, you have a ${fmt(balance.patientOwes)} dental balance outstanding. Please contact your dental office.`;

  try {
    await twilio.messages.create({ body, from, to });
    return true;
  } catch (err) {
    console.error('Twilio error', { balanceId: balance.id, error: (err as Error).message });
    return false;
  }
}
