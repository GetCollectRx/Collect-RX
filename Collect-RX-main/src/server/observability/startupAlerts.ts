/**
 * Email digest when startup scan finds issues (default: khalid@collectrx.ca).
 */
import {
  failedStartupChecks,
  formatStartupDigest,
  type StartupCheckResult,
} from './startupHealthScan.js';

const DEFAULT_STARTUP_EMAIL = 'khalid@collectrx.ca';
const digestCooldownMs = () =>
  Math.max(5, Number(process.env.STARTUP_ALERT_COOLDOWN_MINUTES || 30)) * 60 * 1000;

let lastDigestSentAt = 0;

export function startupAlertEmailTo(): string {
  return (
    process.env.STARTUP_ALERT_EMAIL_TO?.trim() ||
    process.env.OPS_ALERT_EMAIL_TO?.trim() ||
    DEFAULT_STARTUP_EMAIL
  );
}

export function startupEmailAlertsEnabled(): boolean {
  if (['0', 'false', 'no'].includes((process.env.STARTUP_ALERT_EMAIL_ENABLED || '').trim().toLowerCase())) {
    return false;
  }
  return Boolean(process.env.SENDGRID_API_KEY?.trim() && startupAlertEmailTo());
}

async function sendDigestEmail(subject: string, text: string, html: string): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const toRaw = startupAlertEmailTo();
  if (!apiKey || !toRaw) {
    console.warn('[startupAlerts] SENDGRID_API_KEY or email recipient missing — skip email');
    return false;
  }
  const sg = await import('@sendgrid/mail');
  sg.default.setApiKey(apiKey);
  const to = toRaw.split(',').map((e) => e.trim()).filter(Boolean);
  await sg.default.send({
    to,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'ops@collectrx.ca',
      name: process.env.STARTUP_ALERT_EMAIL_FROM_NAME || 'CollectRx Startup Monitor',
    },
    subject: subject.slice(0, 200),
    text,
    html,
  });
  return true;
}

/**
 * Send one email listing all startup failures (respects cooldown).
 */
export async function sendStartupFailureDigest(
  results: StartupCheckResult[],
  context: { host: string; source: string },
): Promise<{ sent: boolean; failureCount: number }> {
  const failures = failedStartupChecks(results);
  if (failures.length === 0) {
    console.log('[startupAlerts] Startup scan OK — no email sent');
    return { sent: false, failureCount: 0 };
  }

  if (!startupEmailAlertsEnabled()) {
    console.warn(
      `[startupAlerts] ${failures.length} issue(s) but email disabled (set SENDGRID_API_KEY + STARTUP_ALERT_EMAIL_TO)`,
    );
    failures.forEach((f) => console.warn(`  ✗ ${f.label}: ${f.detail ?? ''}`));
    return { sent: false, failureCount: failures.length };
  }

  const now = Date.now();
  if (now - lastDigestSentAt < digestCooldownMs()) {
    console.log('[startupAlerts] Cooldown active — skip duplicate startup email');
    return { sent: false, failureCount: failures.length };
  }

  const { subject, text, html } = formatStartupDigest(failures, context);
  try {
    await sendDigestEmail(subject, text, html);
    lastDigestSentAt = now;
    console.log(`[startupAlerts] Sent startup digest (${failures.length} issues) → ${startupAlertEmailTo()}`);
    return { sent: true, failureCount: failures.length };
  } catch (err) {
    console.error('[startupAlerts] Email failed:', (err as Error).message);
    return { sent: false, failureCount: failures.length };
  }
}
