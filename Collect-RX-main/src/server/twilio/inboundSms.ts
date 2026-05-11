/**
 * P4-03 — Inbound SMS (STOP/HELP/START). Twilio must POST to this URL; verify signature when configured.
 */

import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import twilio from 'twilio';

const STOP_RE = /^(stop|unsubscribe|cancel|end|quit|stopall)$/i;
const START_RE = /^start$/i;

function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length === 10) d = `+1${d}`;
  else if (!d.startsWith('+')) d = `+${d}`;
  return d;
}

/**
 * `twilioUrl` must match the **exact** URL configured on the Twilio number (scheme, host, path, no trailing slash mismatch).
 */
export function verifyTwilioSignature(req: Request, twilioUrl: string): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    return process.env.NODE_ENV !== 'production';
  }
  if (!twilioUrl) {
    console.warn('[twilio/inbound] TWILIO_SMS_INBOUND_URL unset — skipping signature check');
    return process.env.NODE_ENV !== 'production';
  }
  const signature = String(req.headers['x-twilio-signature'] || '');
  return twilio.validateRequest(token, signature, twilioUrl, req.body);
}

export async function handleTwilioInboundSms(
  req: Request,
  res: Response,
  prisma: PrismaClient
): Promise<void> {
  const twilioUrl = (process.env.TWILIO_SMS_INBOUND_URL || '').replace(/\/$/, '');
  if (!verifyTwilioSignature(req, twilioUrl)) {
    res.status(403).send('Forbidden');
    return;
  }

  const from = String((req.body as { From?: string }).From || '');
  const body = String((req.body as { Body?: string }).Body || '').trim();
  const normalizedFrom = normalizePhone(from);
  const phoneCandidates = [...new Set([from, normalizedFrom].filter(Boolean))];

  let rows: { id: string; patientPhone: string | null }[] = [];
  if (STOP_RE.test(body) || START_RE.test(body)) {
    rows = await prisma.patientBalance.findMany({
      where: { patientPhone: { in: phoneCandidates } },
      select: { id: true, patientPhone: true },
    });
    if (rows.length === 0) {
      rows = await prisma.patientBalance.findMany({
        where: { patientPhone: { not: null } },
        select: { id: true, patientPhone: true },
      });
    }
  }

  if (STOP_RE.test(body)) {
    for (const row of rows) {
      if (row.patientPhone && normalizePhone(row.patientPhone) === normalizedFrom) {
        await prisma.patientBalance.update({
          where: { id: row.id },
          data: { smsOptOutAt: new Date() },
        });
        break;
      }
    }
  } else if (START_RE.test(body)) {
    for (const row of rows) {
      if (row.patientPhone && normalizePhone(row.patientPhone) === normalizedFrom) {
        await prisma.patientBalance.update({
          where: { id: row.id },
          data: { smsOptOutAt: null },
        });
        break;
      }
    }
  }

  const help = process.env.PRACTICE_BILLING_PHONE || process.env.PRACTICE_PHONE || '';
  let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  if (body.toLowerCase() === 'help') {
    twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>CollectRx billing notice. For account questions, contact your dental office${help ? ` (${help})` : ''}.</Message></Response>`;
  } else if (STOP_RE.test(body)) {
    twiml =
      '<?xml version="1.0" encoding="UTF-8"?><Response><Message>You are opted out of billing SMS. Reply START to resubscribe.</Message></Response>';
  } else if (START_RE.test(body)) {
    twiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Reply HELP for info. To opt out, reply STOP.</Message></Response>';
  }

  res.type('text/xml').send(twiml);
}
