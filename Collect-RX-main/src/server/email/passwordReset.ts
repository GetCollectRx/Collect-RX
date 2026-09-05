/**
 * Send a password reset email via SendGrid.
 * Falls back to console logging when SENDGRID_API_KEY is not configured.
 */
import { logger } from '../observability/logger.js';
import { FOUNDER_SIGNATURE_TEXT, FOUNDER_SIGNATURE_HTML } from './founderSignature.js';

async function getSendGrid() {
  if (!process.env.SENDGRID_API_KEY) return null;
  const sg = (await import('@sendgrid/mail')).default;
  sg.setApiKey(process.env.SENDGRID_API_KEY);
  return sg;
}

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'https://app.collectrx.ca').replace(/\/$/, '');
}

/**
 * Call once at process startup in production. Without SENDGRID_API_KEY,
 * sendPasswordResetEmail() silently falls back to console-logging the reset
 * URL instead of emailing it — safe for local dev, dangerous in production
 * (an operator would believe reset emails are going out when they are not).
 * Mirrors assertJwtConfigAtStartup() in ../authToken.ts.
 */
export function assertPasswordResetEmailConfigAtStartup(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.SENDGRID_API_KEY) {
    throw new Error(
      'SENDGRID_API_KEY is required in production (password reset emails would otherwise ' +
      'silently log the reset URL to the console instead of sending it)',
    );
  }
}

export async function sendPasswordResetEmail(
  toEmail: string,
  displayName: string,
  token: string,
): Promise<void> {
  const resetUrl = `${appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const sg = await getSendGrid();

  if (!sg) {
    logger.info('[password-reset] SENDGRID_API_KEY not set — skipping email', {
      recipient: toEmail,
      resetUrl,
    });
    return;
  }

  const from = {
    email: process.env.SENDGRID_FROM_EMAIL || 'noreply@collectrx.ca',
    name: process.env.SENDGRID_FROM_NAME || 'CollectRx',
  };

  await sg.send({
    to: toEmail,
    from,
    subject: 'Reset your CollectRx password',
    text: [
      `Hi ${displayName},`,
      '',
      'Someone requested a password reset for your CollectRx account.',
      '',
      `Reset your password here (valid for 1 hour):`,
      resetUrl,
      '',
      'If you did not request this, you can safely ignore this email.',
      '',
      FOUNDER_SIGNATURE_TEXT,
    ].join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <p style="font-size:20px;font-weight:700;color:#111">Reset your password</p>
        <p style="color:#444">Hi ${displayName},</p>
        <p style="color:#444">Someone requested a password reset for your CollectRx account.</p>
        <a href="${resetUrl}"
           style="display:inline-block;margin:16px 0;padding:12px 24px;background:#0f6e56;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          Reset password
        </a>
        <p style="color:#888;font-size:13px">Link expires in 1 hour. If you did not request this, ignore this email.</p>
        <p style="color:#888;font-size:13px;margin-top:24px;border-top:1px solid #eee;padding-top:16px">${FOUNDER_SIGNATURE_HTML}</p>
      </div>
    `,
  });
}
