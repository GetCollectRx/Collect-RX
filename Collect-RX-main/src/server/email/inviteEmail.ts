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

const ROLE_LABELS: Record<string, string> = {
  office_manager: 'Office Manager',
  billing_coordinator: 'Billing Coordinator',
  front_desk: 'Front Desk',
  associate_dentist: 'Associate Dentist',
  accountant: 'Accountant',
};

export async function sendInviteEmail(opts: {
  toEmail: string;
  practiceName: string;
  role: string;
  token: string;
}): Promise<void> {
  const acceptUrl = `${appBaseUrl()}/accept-invite?token=${encodeURIComponent(opts.token)}`;
  const roleLabel = ROLE_LABELS[opts.role] ?? opts.role;
  const sg = getSendGrid();

  if (!sg) {
    logger.info('[invite] SENDGRID_API_KEY not set — skipping email', {
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
    subject: `You've been invited to CollectRx — ${opts.practiceName}`,
    text: [
      `You've been invited to join ${opts.practiceName} on CollectRx as ${roleLabel}.`,
      '',
      `Set up your account here (link expires in 72 hours):`,
      acceptUrl,
      '',
      '— CollectRx',
    ].join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <p style="font-size:20px;font-weight:700;color:#111">You're invited to CollectRx</p>
        <p style="color:#444">${opts.practiceName} has added you as <strong>${roleLabel}</strong>.</p>
        <p style="color:#444">Click below to set up your account. This link expires in 72 hours.</p>
        <a href="${acceptUrl}"
           style="display:inline-block;margin:16px 0;padding:12px 24px;background:#0f6e56;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
          Set up my account
        </a>
        <p style="color:#888;font-size:13px">If you weren't expecting this, you can safely ignore it.</p>
      </div>
    `,
  });
}
