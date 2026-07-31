import type { CycleSummary } from './types.js';

async function sendSms(message: string): Promise<void> {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, ALERT_SMS_TO } =
    process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !ALERT_SMS_TO) {
    console.warn('[learning/notify] Twilio env vars not set — skipping SMS');
    return;
  }

  const twilio = (await import('twilio')).default;
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const recipients = ALERT_SMS_TO.split(',').map((n) => n.trim()).filter(Boolean);

  await Promise.allSettled(
    recipients.map((to) =>
      client.messages.create({ body: message.slice(0, 1500), from: TWILIO_FROM_NUMBER, to }),
    ),
  );
}

async function sendEmail(
  to: string[],
  subject: string,
  text: string,
  html?: string,
): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  if (!apiKey || to.length === 0) {
    console.warn('[learning/notify] Email skipped: no API key or recipients');
    return;
  }

  try {
    const sg = await import('@sendgrid/mail');
    sg.default.setApiKey(apiKey);
    await sg.default.send({
      to,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'learning@collectrx.ca',
        name: 'CollectRx Learning',
      },
      subject,
      text,
      html: html || `<p>${text.replace(/\n/g, '<br>')}</p>`,
    });
  } catch (err) {
    console.error('[learning/notify] Email failed:', (err as Error).message);
  }
}

async function sendSlackWebhook(payload: Record<string, unknown>): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    console.warn('[learning/notify] Slack skipped: no webhook URL');
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[learning/notify] Slack webhook failed: ${response.status}`);
    }
  } catch (err) {
    console.error('[learning/notify] Slack request failed:', (err as Error).message);
  }
}

export async function sendLearningCycleSms(summary: CycleSummary): Promise<boolean> {
  const implemented =
    summary.implemented.length > 0
      ? summary.implemented.join('; ')
      : 'none this cycle';
  const skipped =
    summary.skipped.length > 0
      ? `${summary.skipped.length} below feasibility gate`
      : '0 skipped';

  const top =
    summary.topRanked.length > 0
      ? summary.topRanked
          .slice(0, 3)
          .map((t) => `${t.title} (R${t.rankScore}/F${t.feasibilityScore})`)
          .join(' | ')
      : 'n/a';

  const message =
    `CollectRx Phase 6 — Learning cycle\n` +
    `Pulled: ${summary.pulled} | Researched: ${summary.researched}\n` +
    `Implemented: ${implemented}\n` +
    `Skipped: ${skipped}\n` +
    `Top ranked: ${top}`;

  try {
    await sendSms(message);
    return true;
  } catch (err) {
    console.error('[learning/notify] SMS failed:', (err as Error).message);
    return false;
  }
}

export async function sendLearningCycleCompleteNotification(summary: CycleSummary): Promise<void> {
  const implemented =
    summary.implemented.length > 0
      ? summary.implemented.join('; ')
      : 'none this cycle';

  const top =
    summary.topRanked.length > 0
      ? summary.topRanked
          .slice(0, 3)
          .map((t) => `${t.title} (R${t.rankScore}/F${t.feasibilityScore})`)
          .join(' | ')
      : 'n/a';

  const emailBody = [
    `CollectRx Phase 6 — Learning Cycle Complete`,
    '',
    `Candidates Pulled: ${summary.pulled}`,
    `Researched: ${summary.researched}`,
    `Ranked: ${summary.ranked}`,
    `Implemented: ${implemented}`,
    `Skipped: ${summary.skipped.length}`,
    '',
    `Top Ranked Items:`,
    ...summary.topRanked.slice(0, 3).map(t => `• ${t.title} (Rank: ${t.rankScore}, Feasibility: ${t.feasibilityScore})`),
  ].join('\n');

  const alertEmail = process.env.ALERT_EMAIL_TO?.trim()?.split(',').map(e => e.trim()).filter(Boolean) || [];
  if (alertEmail.length > 0) {
    await sendEmail(alertEmail, 'Learning Cycle Complete', emailBody, `<p>${emailBody.replace(/\n/g, '<br>').replace(/• /g, '&bull; ')}</p>`);
  }

  // Slack notification
  await sendSlackWebhook({
    text: `🧠 Learning Cycle Complete`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Learning Cycle Summary*\nPulled: ${summary.pulled} | Researched: ${summary.researched}\nImplemented: ${implemented}\nTop: ${top}`,
        },
      },
    ],
  });
}
