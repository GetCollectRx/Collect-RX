/**
 * SendGrid Event Webhook: bounces, drops, spam reports, opens/clicks.
 * Prospects (dental practice owners): engagement tracking + stage advancement (prospect_id custom arg).
 * Patient balance opt-out removed — CollectRx is Practice → Insurance carrier recovery only.
 */
import { createRequire } from 'module';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { handleProspectSendGridEvent } from '../marketing/prospectEngagement.js';
import { markEmailEvent, type EmailEventType } from '../services/emailService.js';
import { logger } from '../observability/logger.js';
import { sendgridEventBatchSchema, sendgridEventSchema } from './sendgridEventSchema.js';

const require = createRequire(import.meta.url);
const { EventWebhook, EventWebhookHeader } = require('@sendgrid/eventwebhook') as {
  EventWebhook: new () => {
    convertPublicKeyToECDSA: (k: string) => unknown;
    verifySignature: (key: unknown, body: string | Buffer, sig: string, ts: string) => boolean;
  };
  EventWebhookHeader: { SIGNATURE: () => string; TIMESTAMP: () => string };
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

// 'sent' is recorded at send time by sendCampaignEmail — 'delivered' and
// 'processed' are deliberately absent so the send is not double-counted.
const CAMPAIGN_EVENT_MAP: Record<string, EmailEventType> = {
  open: 'opened',
  click: 'clicked',
  bounce: 'bounced',
  dropped: 'failed',
  deferred: 'deferred',
  spamreport: 'marked_spam',
  unsubscribe: 'unsubscribed',
  group_unsubscribe: 'unsubscribed',
};

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
        logger.error('[sendgrid/webhook] signature verification failed', {});
        return res.status(401).type('text/plain').send('invalid signature');
      }
    } else if (process.env.NODE_ENV === 'production') {
      logger.error('[sendgrid/webhook] SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY is required in production', {});
      return res.status(401).type('text/plain').send('verification required');
    } else {
      logger.warn('[sendgrid/webhook] SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY unset — webhook is not verified (dev only)', {});
    }

    let rawEvents: unknown;
    try {
      rawEvents = JSON.parse(bodyString);
    } catch {
      return res.status(400).type('text/plain').send('invalid json');
    }

    const batchParsed = sendgridEventBatchSchema.safeParse(rawEvents);
    if (!batchParsed.success) {
      logger.error('[sendgrid/webhook] payload is not a JSON array — rejecting', {
        error: batchParsed.error.issues,
      });
      return res.status(400).type('text/plain').send('expected array');
    }

    // Validate each event independently: SendGrid batches can carry
    // thousands of events per POST, and one malformed/unexpectedly-shaped
    // element must not drop (or crash processing of) the rest of a
    // legitimately-signed batch. Invalid elements are logged and skipped.
    for (const rawEvent of batchParsed.data) {
      const eventParsed = sendgridEventSchema.safeParse(rawEvent);
      if (!eventParsed.success) {
        logger.error('[sendgrid/webhook] skipping malformed event', {
          error: eventParsed.error.issues,
        });
        continue;
      }
      const ev = eventParsed.data;
      if (!ev.prospect_id) continue;

      if (prospectEngagementRelevant(ev.event)) {
        try {
          await handleProspectSendGridEvent(prisma, ev);
        } catch (e) {
          logger.error('[sendgrid/webhook] prospect event error', { error: e });
        }
      }

      const campaignEventType = ev.event ? CAMPAIGN_EVENT_MAP[ev.event] : undefined;
      if (campaignEventType) {
        try {
          await markEmailEvent(prisma, ev.prospect_id, campaignEventType, {
            campaignId: ev.campaign_id,
            templateId: ev.template_id,
            sendgridMessageId: ev.sg_message_id,
            bounceReason: ev.reason,
            linkClicked: ev.url,
          });
        } catch (e) {
          logger.error('[sendgrid/webhook] campaign event error', { error: e });
        }
      }
    }

    return res.status(200).type('text/plain').send('ok');
  };
}
