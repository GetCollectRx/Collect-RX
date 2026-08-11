import { createRequire } from 'module';
import type { Prospect, PrismaClient } from '@prisma/client'
import { logProspectActivity } from './prospectActivity.js';
import { OUTREACH_SENDER_EMAIL, OUTREACH_SENDER_NAME } from './outreachVoice.js';
import { buildProspectUnsubscribeUrl } from '../email/unsubscribeUrl.js';
import { logger } from '../observability/logger.js';

const require = createRequire(import.meta.url);

export interface SendProspectEmailOptions {
  subject: string;
  html: string;
  text: string;
  activityType: string;
}

function getSendGrid() {
  if (!process.env.SENDGRID_API_KEY) return null;
  const sg = require('@sendgrid/mail');
  sg.setApiKey(process.env.SENDGRID_API_KEY);
  return sg;
}

export async function sendProspectEmail(
  prospect: Prospect,
  opts: SendProspectEmailOptions,
  prisma?: PrismaClient,
): Promise<boolean> {
  if (!prospect.email || prospect.optOutAt) return false;

  const sg = getSendGrid();
  const from = process.env.SENDGRID_FROM_EMAIL || OUTREACH_SENDER_EMAIL;
  const fromName = process.env.SENDGRID_FROM_NAME || OUTREACH_SENDER_NAME;
  const replyTo = process.env.SENDGRID_REPLY_TO || 'reply@inbound.collectrx.ca';

  if (!sg) {
    logger.info('[prospectEmail] SENDGRID_API_KEY unset — would send', { to: prospect.email, subject: opts.subject });
    if (prisma) {
      await logProspectActivity(prisma, prospect.id, opts.activityType, `[dev] ${opts.subject}`);
    }
    return false;
  }

  // Gmail/Yahoo's 2024+ bulk-sender rules require a one-click List-Unsubscribe header on
  // top of the reply-text opt-out CASL already satisfies. Degrades gracefully (header
  // omitted, email still sends) if EMAIL_UNSUBSCRIBE_SECRET/JWT_SECRET isn't configured.
  const unsubscribeUrl = buildProspectUnsubscribeUrl(prospect.id);

  try {
    await sg.send({
      to: prospect.email,
      from: { email: from, name: fromName },
      replyTo: replyTo,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      headers: {
        'X-Prospect-Id': prospect.id,
        ...(unsubscribeUrl && {
          'List-Unsubscribe': `<${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }),
      },
      customArgs: {
        prospect_id: prospect.id,
      },
      trackingSettings: {
        clickTracking: { enable: true },
        openTracking: { enable: true },
      },
    });

    if (prisma) {
      await logProspectActivity(prisma, prospect.id, opts.activityType, opts.subject);
    }
    return true;
  } catch (err) {
    logger.error('[prospectEmail] send failed', { error: err });
    return false;
  }
}
