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
