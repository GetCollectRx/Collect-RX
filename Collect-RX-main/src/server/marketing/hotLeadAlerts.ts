import { createRequire } from 'module';
import type { Prospect } from '@prisma/client';

const require = createRequire(import.meta.url);

export type HotLeadTrigger =
  | 'email_open_3'
  | 'email_click'
  | 'positive_reply'
  | 'qualified_call'
  | 'demo_booked'
  | 'stage_engaged';

function appBaseUrl(): string {
  return (
    process.env.PUBLIC_APP_URL?.replace(/\/$/, '') ||
    process.env.PUBLIC_API_BASE_URL?.replace(/\/$/, '') ||
    'https://www.collectrx.ca'
  );
}

function prospectDeepLink(prospectId: string): string {
  return `${appBaseUrl()}/admin/partnerships/${prospectId}`;
}

function formatProspectLine(p: Prospect): string {
  const loc = [p.city, p.province].filter(Boolean).join(', ');
  return `${p.practiceName}${loc ? ` (${loc})` : ''} · score ${p.score}/100`;
}

export async function sendHotLeadAlert(
  prospect: Prospect,
  trigger: HotLeadTrigger,
  detail?: string,
): Promise<void> {
  const title =
    trigger === 'email_open_3'
      ? 'Hot lead: opened 3 emails'
      : trigger === 'email_click'
        ? 'Hot lead: clicked email link'
        : trigger === 'positive_reply'
          ? 'Hot lead: positive reply'
          : trigger === 'qualified_call'
            ? '✅ Qualified via voice call'
            : trigger === 'demo_booked'
              ? '📅 Demo booked'
              : '🔥 Prospect engaged';

  const body = `${formatProspectLine(prospect)}${detail ? `\n${detail}` : ''}`;
  const link = prospectDeepLink(prospect.id);

  await Promise.all([
    sendSlackHotLead(title, body, link),
    sendEmailHotLead(title, body, link, prospect),
  ]);
}

async function sendSlackHotLead(title: string, body: string, link: string): Promise<void> {
  const url = process.env.SLACK_MARKETING_WEBHOOK_URL?.trim();
  if (!url) {
    console.log('[hotLeadAlerts] Slack not configured:', title, body);
    return;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: title } },
          { type: 'section', text: { type: 'mrkdwn', text: body } },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'View in CollectRx' },
                url: link,
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error('[hotLeadAlerts] Slack webhook failed', res.status);
    }
  } catch (err) {
    console.error('[hotLeadAlerts] Slack error', (err as Error).message);
  }
}

async function sendEmailHotLead(
  title: string,
  body: string,
  link: string,
  prospect: Prospect,
): Promise<void> {
  const to = process.env.MARKETING_ALERT_EMAIL?.trim();
  if (!to || !process.env.SENDGRID_API_KEY) {
    if (!to) console.log('[hotLeadAlerts] MARKETING_ALERT_EMAIL not set');
    return;
  }

  const sg = require('@sendgrid/mail');
  sg.setApiKey(process.env.SENDGRID_API_KEY);
  const from = process.env.SENDGRID_FROM_EMAIL || 'billing@collectrx.ca';

  try {
    await sg.send({
      to,
      from,
      subject: `[CollectRx] ${title}, ${prospect.practiceName}`,
      text: `${body}\n\nView: ${link}`,
      html: `<p>${body.replace(/\n/g, '<br>')}</p><p><a href="${link}">View prospect</a></p>`,
    });
  } catch (err) {
    console.error('[hotLeadAlerts] email error', (err as Error).message);
  }
}
