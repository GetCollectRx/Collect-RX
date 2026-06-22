/**
 * SendGrid Event Webhook: bounces, drops, spam reports, opens/clicks.
 * Prospects (dental practice owners): engagement tracking + stage advancement (prospect_id custom arg).
 * Patient balance opt-out removed — CollectRx is Practice → Insurance carrier recovery only.
 */
import { createRequire } from 'module';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { handleProspectSendGridEvent } from '../marketing/prospectEngagement.js';

const require = createRequire(import.meta.url);
const { EventWebhook, EventWebhookHeader } = require('@sendgrid/eventwebhook') as {
  EventWebhook: new () => {
    convertPublicKeyToECDSA: (k: string) => unknown;
    verifySignature: (key: unknown, body: string | Buffer, sig: string, ts: string) => boolean;
  };
  EventWebhookHeader: { SIGNATURE: () => string; TIMESTAMP: () => string };
};

type SgEvent = {
  email?: string;
  event?: string;
  reason?: string;
  url?: string;
  /** custom_args from SendGrid v3 */
  prospect_id?: string;
};

function prospectEngagementRelevant(e: string | undefined) {
  return (
    e === 'open' ||
    e === 'click' ||
    e === 'bounce' ||
    e === 'dropped' ||
    e === 'spamreport' ||
    e === 'unsubscribe'
  );
}

function getHeader(req: Request, name: string): string {
  const h = req.headers[name.toLowerCase()] ?? req.headers[name];
  return String(Array.isArray(h) ? h[0] : h || '');
}

/**
 * `express.raw` must run first. Pass `prisma` from the app.
 */
export function makeSendgridEventWebhookHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''), 'utf8');
    const bodyString = rawBody.toString('utf8');

    const publicKeyPem = process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY;
    if (publicKeyPem) {
      const ewh = new EventWebhook();
      const pub = ewh.convertPublicKeyToECDSA(publicKeyPem.replace(/\\n/g, '\n'));
      const sig = getHeader(req, EventWebhookHeader.SIGNATURE());
      const ts = getHeader(req, EventWebhookHeader.TIMESTAMP());
      if (!sig || !ts || !ewh.verifySignature(pub, rawBody, sig, ts)) {
        console.error('[sendgrid/webhook] signature verification failed');
        return res.status(401).type('text/plain').send('invalid signature');
      }
    } else if (process.env.NODE_ENV === 'production') {
      console.error(
        '[sendgrid/webhook] SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY is required in production',
      );
      return res.status(401).type('text/plain').send('verification required');
    } else {
      console.warn(
        '[sendgrid/webhook] SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY unset — webhook is not verified (dev only)',
      );
    }

    let events: SgEvent[];
    try {
      events = JSON.parse(bodyString) as SgEvent[];
      if (!Array.isArray(events)) {
        return res.status(400).type('text/plain').send('expected array');
      }
    } catch {
      return res.status(400).type('text/plain').send('invalid json');
    }

    for (const ev of events) {
      if (ev.prospect_id && prospectEngagementRelevant(ev.event)) {
        try {
          await handleProspectSendGridEvent(prisma, ev);
        } catch (e) {
          console.error('[sendgrid/webhook] prospect event error', (e as Error).message);
        }
      }
    }

    return res.status(200).type('text/plain').send('ok');
  };
}
