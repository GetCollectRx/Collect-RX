import { getPublicAppBaseUrl } from './appUrl.js';

function firstName(patientDisplayName: string): string {
  const t = patientDisplayName.trim();
  if (!t) return 'there';
  return t.split(/\s+/)[0] || t;
}

function billingPhone(): string {
  return (process.env.PRACTICE_BILLING_PHONE || '').trim() || 'our office';
}

/**
 * Renders a patient message. Use real displayName + practice name from DB;
 * set PUBLIC_APP_URL in production so the pay link is not localhost.
 * Legacy /pay/:balanceId may require a logged-in session; prefer wiring public
 * token (P3-22) to Balance when sending real patient SMS/email.
 */
export function generateMessageBody(
  templateKey: string,
  patientDisplayName: string,
  amount: number,
  balanceId: string,
  daysOutstanding: number,
  practiceName: string
): string {
  const base = getPublicAppBaseUrl();
  const paymentLink = `${base}/pay/${balanceId}`;
  const greet = firstName(patientDisplayName);
  const phone = billingPhone();

  const templates: Record<string, string> = {
    NOTIFIED: `Hi ${greet},

This is ${practiceName} with a friendly reminder that you have an outstanding balance of $${amount.toFixed(2)} from your recent visit.

You can pay securely here:
${paymentLink}

If you have questions or want to set up a payment plan, contact ${phone}.

Thank you,
${practiceName}`,

    REMINDER_1: `Hi ${greet},

${practiceName} is following up on an outstanding balance of $${amount.toFixed(2)}, about ${daysOutstanding} days after we first notified you.

Please pay when you can:
${paymentLink}

Need help? Contact ${phone}.

— ${practiceName}`,

    REMINDER_2: `Hi ${greet},

This is ${practiceName}. Your account has an overdue balance of $${amount.toFixed(2)} (${daysOutstanding} days since our first notice).

Please pay as soon as possible:
${paymentLink}

${phone} if you need to talk through options.

— ${practiceName}`,

    ESCALATED: `Important — ${patientDisplayName}

${practiceName}: your balance of $${amount.toFixed(2)} is ${daysOutstanding} days past due and is being reviewed for next steps.

Pay now:
${paymentLink}

Contact ${phone} immediately to resolve this or arrange a plan.

— ${practiceName}`,
  };

  return templates[templateKey] || `${practiceName} — message for ${patientDisplayName} regarding $${amount.toFixed(2)}. Pay: ${paymentLink}`;
}
