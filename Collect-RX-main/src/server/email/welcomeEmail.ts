import { logger } from '../observability/logger.js';
import { resolveAppBaseUrl } from './appLinks.js';
import { isEmailConfigured, resolveFrom, sendMail } from './mailer.js';
import { FOUNDER_SIGNATURE_TEXT, FOUNDER_SIGNATURE_HTML } from './founderSignature.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Resolves true only when the welcome email was handed to a mail provider.
 * Resolves false when no provider is configured — registration still
 * succeeds either way, since there is no email-verification gate on login.
 * A provider failure still throws; callers should catch and log, not fail
 * the signup over a delivery problem.
 */
export async function sendWelcomeEmail(opts: {
  toEmail: string;
  displayName: string;
  practiceName: string;
  baseUrl?: string;
}): Promise<boolean> {
  const loginUrl = `${opts.baseUrl ?? resolveAppBaseUrl()}/login`;

  if (!isEmailConfigured()) {
    logger.info('[welcome-email] no email provider key set — skipping email', { to: opts.toEmail });
    return false;
  }

  const from = resolveFrom('ops@collectrx.ca');
  const safeDisplayName = escapeHtml(opts.displayName);
  const safePracticeName = escapeHtml(opts.practiceName);

  await sendMail({
    to: opts.toEmail,
    from,
    subject: `Welcome to CollectRx, ${opts.practiceName}`,
    text: [
      `Hi ${opts.displayName},`,
      '',
      `Your CollectRx account for ${opts.practiceName} is ready.`,
      '',
      'Sign in any time here:',
      loginUrl,
      '',
      FOUNDER_SIGNATURE_TEXT,
    ].join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <p style="font-size:20px;font-weight:700;color:#111">Welcome to CollectRx</p>
        <p style="color:#444">Hi ${safeDisplayName}, your account for <strong>${safePracticeName}</strong> is ready to go.</p>
        <a href="${loginUrl}"
           style="display:inline-block;margin:16px 0;padding:12px 24px;background:#0f6e56;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          Sign in to CollectRx
        </a>
        <p style="color:#888;font-size:13px">If you didn't create this account, contact us and we'll remove it.</p>
        <p style="color:#888;font-size:13px;margin-top:24px;border-top:1px solid #eee;padding-top:16px">${FOUNDER_SIGNATURE_HTML}</p>
      </div>
    `,
  });
  return true;
}
