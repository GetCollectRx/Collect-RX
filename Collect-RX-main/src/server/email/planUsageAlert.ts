/**
 * Email practice owners (and opted-in staff) when plan usage crosses thresholds.
 */
import { logger } from '../observability/logger.js';

async function getSendGrid() {
  if (!process.env.SENDGRID_API_KEY) return null;
  const sg = (await import('@sendgrid/mail')).default;
  sg.setApiKey(process.env.SENDGRID_API_KEY);
  return sg;
}

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'https://app.collectrx.ca').replace(/\/$/, '');
}

export async function sendPlanUsageAlertEmail(opts: {
  toEmail: string;
  displayName: string;
  practiceName: string;
  subject: string;
  bodyLines: string[];
}): Promise<void> {
  const sg = await getSendGrid();
  const billingUrl = `${appBaseUrl()}/billing`;
  const text = [
    `Hi ${opts.displayName},`,
    '',
    ...opts.bodyLines,
    '',
    `View plan & usage: ${billingUrl}`,
    '',
    '— CollectRx',
  ].join('\n');

  if (!sg) {
    logger.info('[plan-usage-alert] SENDGRID_API_KEY not set — skipping email', {
      to: opts.toEmail,
      subject: opts.subject,
      body: opts.bodyLines.join(' '),
    });
    return;
  }

  const from = {
    email: process.env.SENDGRID_FROM_EMAIL || 'noreply@collectrx.ca',
    name: process.env.SENDGRID_FROM_NAME || 'CollectRx',
  };

  await sg.send({
    to: opts.toEmail,
    from,
    subject: opts.subject,
    text,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <p style="font-size:18px;font-weight:700;color:#111">CollectRx plan usage</p>
        <p style="color:#444">Hi ${opts.displayName},</p>
        ${opts.bodyLines.map((l) => `<p style="color:#444">${l}</p>`).join('')}
        <a href="${billingUrl}"
           style="display:inline-block;margin:16px 0;padding:12px 24px;background:#0f6e56;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          View plan &amp; usage
        </a>
        <p style="color:#888;font-size:13px">${opts.practiceName}</p>
      </div>
    `,
  });
}
