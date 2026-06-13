/**
 * Hot Lead Alerts
 *
 * Fires when a prospect crosses a significant engagement threshold:
 *   - 3+ email opens
 *   - clicked a demo link
 *   - replied to an email
 *   - booked a demo
 *   - qualified via voice call
 *
 * Delivery channels (any combination):
 *   SLACK_MARKETING_WEBHOOK_URL — Slack Incoming Webhook
 *   MARKETING_ALERT_EMAIL       — email address to notify (via SendGrid)
 *   MARKETING_SENDER_EMAIL      — from address for alert emails
 */

export type AlertTrigger =
  | 'email_opened_3x'
  | 'email_clicked'
  | 'email_replied'
  | 'demo_booked'
  | 'qualified'

interface AlertPayload {
  prospectName: string
  prospectId: string
  city: string | null
  stage: string
  score: number
  trigger: AlertTrigger
  detail?: string
}

const TRIGGER_LABELS: Record<AlertTrigger, string> = {
  email_opened_3x: 'Opened 3 emails — hot!',
  email_clicked:   'Clicked demo link',
  email_replied:   'Replied to email',
  demo_booked:     'Booked a demo',
  qualified:       'Qualified via voice call',
}

const TRIGGER_EMOJI: Record<AlertTrigger, string> = {
  email_opened_3x: '🔥',
  email_clicked:   '👆',
  email_replied:   '💬',
  demo_booked:     '📅',
  qualified:       '✅',
}

function slackWebhookUrl(): string | null {
  return process.env.SLACK_MARKETING_WEBHOOK_URL?.trim() || null
}

function alertEmail(): string | null {
  return process.env.MARKETING_ALERT_EMAIL?.trim() || null
}

function getSendGrid(): null | { send: (msg: object) => Promise<unknown> } {
  if (!process.env.SENDGRID_API_KEY) return null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sg = require('@sendgrid/mail')
  sg.setApiKey(process.env.SENDGRID_API_KEY)
  return sg
}

function dashboardUrl(prospectId: string): string {
  const base = process.env.PUBLIC_APP_URL || 'https://app.collectrx.ca'
  return `${base}/partnerships/${prospectId}`
}

export async function fireHotLeadAlert(payload: AlertPayload): Promise<void> {
  const { prospectName, prospectId, city, stage, score, trigger, detail } = payload
  const emoji = TRIGGER_EMOJI[trigger]
  const label = TRIGGER_LABELS[trigger]
  const url = dashboardUrl(prospectId)
  const cityStr = city ? ` (${city})` : ''

  const promises: Promise<unknown>[] = []

  // ── Slack ────────────────────────────────────────────────────────────────
  const slackUrl = slackWebhookUrl()
  if (slackUrl) {
    const slackBody = {
      text: `${emoji} *Hot Lead:* ${prospectName}${cityStr} — ${label}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} *Hot Lead Alert*\n*${prospectName}*${cityStr}`,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Trigger:*\n${label}` },
            { type: 'mrkdwn', text: `*Stage:*\n${stage}` },
            { type: 'mrkdwn', text: `*Score:*\n${score}/100` },
            ...(detail ? [{ type: 'mrkdwn', text: `*Detail:*\n${detail}` }] : []),
          ],
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View in CollectRx' },
              url,
              style: 'primary',
            },
          ],
        },
      ],
    }
    promises.push(
      fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackBody),
      }).catch((e) => console.error('[hotLeadAlert] Slack error', (e as Error).message)),
    )
  }

  // ── Email ────────────────────────────────────────────────────────────────
  const toEmail = alertEmail()
  const sg = getSendGrid()
  const fromEmail = process.env.MARKETING_SENDER_EMAIL || process.env.SENDGRID_FROM_EMAIL || 'noreply@collectrx.ca'
  if (toEmail && sg) {
    promises.push(
      sg.send({
        to: toEmail,
        from: { email: fromEmail, name: 'CollectRx Partnerships' },
        subject: `${emoji} Hot Lead: ${prospectName} — ${label}`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="color:#1e293b">${emoji} Hot Lead Alert</h2>
            <p style="font-size:16px"><strong>${prospectName}</strong>${cityStr}</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0">
              <tr><td style="padding:6px 0;color:#64748b">Trigger</td><td style="padding:6px 0;font-weight:600">${label}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Stage</td><td style="padding:6px 0">${stage}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b">Score</td><td style="padding:6px 0">${score}/100</td></tr>
              ${detail ? `<tr><td style="padding:6px 0;color:#64748b">Detail</td><td style="padding:6px 0">${detail}</td></tr>` : ''}
            </table>
            <a href="${url}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">View in CollectRx →</a>
          </div>
        `,
      }).catch((e: Error) => console.error('[hotLeadAlert] email error', e.message)),
    )
  }

  if (promises.length === 0) {
    // No channels configured — log to console so it's not silently dropped
    console.info(`[hotLeadAlert] ${emoji} ${prospectName} — ${label} (no alert channel configured)`)
  }

  await Promise.allSettled(promises)
}
