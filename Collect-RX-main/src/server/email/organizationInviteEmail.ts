import { logger } from '../observability/logger.js';

function getSendGrid() {
  if (!process.env.SENDGRID_API_KEY) return null;
  const sg = require('@sendgrid/mail') as { setApiKey: (k: string) => void; send: (msg: unknown) => Promise<unknown> };
  sg.setApiKey(process.env.SENDGRID_API_KEY);
  return sg;
}

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
  const sg = getSendGrid();

  if (!sg) {
    logger.info('[org-invite] SENDGRID_API_KEY not set — skipping email', {
      to: opts.toEmail,
      acceptUrl,
    });
    return;
  }

  const from = {
    email: process.env.SENDGRID_FROM_EMAIL || 'ops@collectrx.ca',
    name: process.env.SENDGRID_FROM_NAME || 'CollectRx',
  };

  await sg.send({
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
      '— CollectRx',
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
      </div>
    `,
  });
}
