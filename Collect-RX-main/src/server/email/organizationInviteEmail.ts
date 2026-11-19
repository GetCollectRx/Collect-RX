import { logger } from '../observability/logger.js';
import { isEmailConfigured, resolveFrom, sendMail } from './mailer.js';
import { FOUNDER_SIGNATURE_TEXT, FOUNDER_SIGNATURE_HTML } from './founderSignature.js';


function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'https://app.collectrx.ca').replace(/\/$/, '');
}

export async function sendOrganizationInviteEmail(opts: {
  toEmail: string;
  organizationName: string;
  inviterPracticeName: string;
  token: string;
}): Promise<void> {
  const acceptUrl = `${appBaseUrl()}/organizations/accept-invite?token=${encodeURIComponent(opts.token)}`;

  if (!isEmailConfigured()) {
    logger.info('[org-invite] no email provider key set — skipping email', {
      to: opts.toEmail,
      acceptUrl,
    });
    return;
  }

  const from = resolveFrom('ops@collectrx.ca');

  await sendMail({
    to: opts.toEmail,
    from,
    subject: `${opts.inviterPracticeName} invited your practice to join ${opts.organizationName} on CollectRx`,
    text: [
      `${opts.inviterPracticeName} has invited your practice to join the "${opts.organizationName}" group on CollectRx.`,
      '',
      'Joining shares only PHI-free aggregate stats (claim counts, resolution rate) with the group — no patient data.',
      '',
      `Accept or decline here (link expires in 72 hours):`,
      acceptUrl,
      '',
      "If you weren't expecting this, you can safely ignore it — nothing changes until you accept.",
      '',
      FOUNDER_SIGNATURE_TEXT,
    ].join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <p style="font-size:20px;font-weight:700;color:#111">Group invitation</p>
        <p style="color:#444"><strong>${opts.inviterPracticeName}</strong> has invited your practice to join <strong>${opts.organizationName}</strong> on CollectRx.</p>
        <p style="color:#444">Joining shares only PHI-free aggregate stats (claim counts, resolution rate) with the group — no patient data.</p>
        <p style="color:#444">This link expires in 72 hours. Nothing changes until you accept.</p>
        <a href="${acceptUrl}"
           style="display:inline-block;margin:16px 0;padding:12px 24px;background:#0f6e56;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          Review invitation
        </a>
        <p style="color:#888;font-size:13px">If you weren't expecting this, you can safely ignore it.</p>
        <p style="color:#888;font-size:13px;margin-top:24px;border-top:1px solid #eee;padding-top:16px">${FOUNDER_SIGNATURE_HTML}</p>
      </div>
    `,
  });
}
