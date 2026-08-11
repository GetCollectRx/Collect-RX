/**
 * Dispatch ops alerts with clear impact + suggested fixes (SMS, email, webhook).
 */
import { getAlertDefinition, type AlertDefinition, type AlertSeverity } from './alertCatalog.js';
import { logger } from './logger.js';

export interface OpsAlertPayload {
  alertId: string;
  /** Optional override; defaults to catalog title */
  title?: string;
  severity?: AlertSeverity;
  detail?: string;
  source?: string;
  host?: string;
}

const cooldownMs = () =>
  Math.max(5, Number(process.env.OPS_ALERT_COOLDOWN_MINUTES || 60)) * 60 * 1000;

const lastSent = new Map<string, number>();

/**
 * Explicit '1'/'true'/'yes' → on. Explicit '0'/'false'/'no' → off. Unset →
 * defaults on in production (an unsupervised pilot must not silently ship
 * with alerting off because nobody set the env var) and off elsewhere (dev/
 * test should not page anyone by default). Same three-state shape as
 * `startupScanEnabled()` in `startupHealthScan.ts`.
 */
export function opsAlertsEnabled(): boolean {
  const raw = (process.env.OPS_ALERTS_ENABLED || '').trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(raw)) return true;
  if (['0', 'false', 'no'].includes(raw)) return false;
  return process.env.NODE_ENV === 'production';
}

function alertKey(payload: OpsAlertPayload): string {
  return `${payload.alertId}:${payload.source ?? 'default'}`;
}

export function shouldSendAlert(payload: OpsAlertPayload): boolean {
  if (!opsAlertsEnabled()) return false;
  const key = alertKey(payload);
  const last = lastSent.get(key) ?? 0;
  return Date.now() - last >= cooldownMs();
}

export function formatOpsAlertText(payload: OpsAlertPayload): string {
  const def = getAlertDefinition(payload.alertId);
  const severity = payload.severity ?? def.severity;
  const title = payload.title ?? def.title;
  const host =
    payload.host ||
    process.env.PUBLIC_APP_URL ||
    process.env.SERVER_URL ||
    'unknown-host';
  const lines: string[] = [
    `CollectRx ALERT [${severity.toUpperCase()}]`,
    title,
    '',
    'IMPACT:',
    ...def.impact.map((i) => `• ${i}`),
    '',
    'AFFECTED:',
    def.affectedSystems.join(', '),
  ];
  if (payload.detail) {
    lines.push('', 'DETAIL:', payload.detail);
  }
  lines.push('', 'FIX:', ...def.suggestedFixes.map((f, i) => `${i + 1}. ${f}`));
  lines.push('', `Host: ${host}`, `Ref: ${def.id}`, `Source: ${payload.source ?? 'ops'}`);
  return lines.join('\n').slice(0, 1500);
}

export function formatOpsAlertHtml(payload: OpsAlertPayload): string {
  const def = getAlertDefinition(payload.alertId);
  const severity = payload.severity ?? def.severity;
  const title = payload.title ?? def.title;
  const host =
    payload.host ||
    process.env.PUBLIC_APP_URL ||
    process.env.SERVER_URL ||
    'unknown-host';
  const impactLi = def.impact.map((i) => `<li>${escapeHtml(i)}</li>`).join('');
  const fixLi = def.suggestedFixes.map((f) => `<li>${escapeHtml(f)}</li>`).join('');
  return `<!DOCTYPE html><html><body style="font-family:sans-serif">
<h2>CollectRx — ${escapeHtml(severity.toUpperCase())}: ${escapeHtml(title)}</h2>
<p><strong>Affected:</strong> ${escapeHtml(def.affectedSystems.join(', '))}</p>
<h3>Impact</h3><ul>${impactLi}</ul>
${payload.detail ? `<h3>Detail</h3><pre>${escapeHtml(payload.detail)}</pre>` : ''}
<h3>Suggested fixes</h3><ol>${fixLi}</ol>
<p><small>Host: ${escapeHtml(host)} · Ref: ${escapeHtml(def.id)} · Source: ${escapeHtml(payload.source ?? 'ops')}</small></p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendSms(message: string): Promise<boolean> {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, ALERT_SMS_TO } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !ALERT_SMS_TO) {
    return false;
  }
  const twilio = (await import('twilio')).default;
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const recipients = ALERT_SMS_TO.split(',').map((n) => n.trim()).filter(Boolean);
  await Promise.allSettled(
    recipients.map((to) =>
      client.messages.create({ body: message.slice(0, 1500), from: TWILIO_FROM_NUMBER, to }),
    ),
  );
  return true;
}

async function sendEmail(subject: string, text: string, html: string): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const toRaw = process.env.OPS_ALERT_EMAIL_TO?.trim();
  if (!apiKey || !toRaw) return false;
  const sg = await import('@sendgrid/mail');
  sg.default.setApiKey(apiKey);
  const to = toRaw.split(',').map((e) => e.trim()).filter(Boolean);
  await sg.default.send({
    to,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'ops@collectrx.ca',
      name: process.env.OPS_ALERT_EMAIL_FROM_NAME || 'CollectRx Ops',
    },
    subject: subject.slice(0, 200),
    text,
    html,
  });
  return true;
}

async function sendWebhook(text: string, payload: OpsAlertPayload, def: AlertDefinition): Promise<boolean> {
  const url = process.env.OPS_ALERT_WEBHOOK_URL?.trim();
  if (!url) return false;
  const body = {
    text,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `CollectRx ${(payload.severity ?? def.severity).toUpperCase()}: ${payload.title ?? def.title}` },
      },
      { type: 'section', text: { type: 'mrkdwn', text: `*Impact*\n${def.impact.map((i) => `• ${i}`).join('\n')}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*Affected:* ${def.affectedSystems.join(', ')}` } },
      ...(payload.detail
        ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Detail*\n\`\`\`${payload.detail.slice(0, 500)}\`\`\`` } }]
        : []),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Fix*\n${def.suggestedFixes.map((f, i) => `${i + 1}. ${f}`).join('\n')}`,
        },
      },
    ],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

/**
 * Send alert on all configured channels. Respects cooldown per alertId+source.
 */
export async function dispatchOpsAlert(payload: OpsAlertPayload): Promise<{
  sent: boolean;
  channels: string[];
  skippedCooldown: boolean;
}> {
  if (!opsAlertsEnabled()) {
    logger.warn('[opsAlerts] OPS_ALERTS_ENABLED is not set — alert logged only', {
      text: formatOpsAlertText(payload),
    });
    return { sent: false, channels: [], skippedCooldown: false };
  }
  if (!shouldSendAlert(payload)) {
    return { sent: false, channels: [], skippedCooldown: true };
  }

  const def = getAlertDefinition(payload.alertId);
  const text = formatOpsAlertText(payload);
  const html = formatOpsAlertHtml(payload);
  const subject = `CollectRx [${(payload.severity ?? def.severity).toUpperCase()}] ${payload.title ?? def.title}`;
  const channels: string[] = [];

  if (await sendSms(text).catch(() => false)) channels.push('sms');
  if (await sendEmail(subject, text, html).catch((e) => {
    logger.error('[opsAlerts] email failed', { error: e });
    return false;
  })) {
    channels.push('email');
  }
  if (await sendWebhook(text, payload, def).catch((e) => {
    logger.error('[opsAlerts] webhook failed', { error: e });
    return false;
  })) {
    channels.push('webhook');
  }

  if (channels.length === 0) {
    logger.error('[opsAlerts] No channel delivered — configure ALERT_SMS_TO, OPS_ALERT_EMAIL_TO, or OPS_ALERT_WEBHOOK_URL', {
      text,
    });
  } else {
    lastSent.set(alertKey(payload), Date.now());
    logger.info('[opsAlerts] Sent', { alertId: payload.alertId, channels });
  }

  return { sent: channels.length > 0, channels, skippedCooldown: false };
}

/** Map diagnosis check id → alert payloads for failed checks */
export function alertsFromFailedChecks(
  failed: Array<{ id: string; detail?: string; label?: string }>,
  source: string,
): OpsAlertPayload[] {
  return failed.map((f) => ({
    alertId: f.id,
    detail: f.detail ?? f.label,
    source,
  }));
}
