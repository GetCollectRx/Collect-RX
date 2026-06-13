import { createRequire } from 'module';
import type { Prospect } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { logProspectActivity } from './prospectActivity.js';

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
  const from = process.env.SENDGRID_FROM_EMAIL || 'billing@collectrx.ca';
  const fromName = process.env.SENDGRID_FROM_NAME || 'CollectRx';

  if (!sg) {
    console.log('[prospectEmail] SENDGRID_API_KEY unset — would send to', prospect.email, opts.subject);
    if (prisma) {
      await logProspectActivity(prisma, prospect.id, opts.activityType, `[dev] ${opts.subject}`);
    }
    return false;
  }

  try {
    await sg.send({
      to: prospect.email,
      from: { email: from, name: fromName },
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      headers: {
        'X-Prospect-Id': prospect.id,
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
    console.error('[prospectEmail] send failed', (err as Error).message);
    return false;
  }
}
