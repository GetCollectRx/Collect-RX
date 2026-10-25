/**
 * GoCardless webhook listener. Verified against
 * developer.gocardless.com/getting-started/stay-up-to-date-with-webhooks-v2:
 * a request carries a batch of events (up to 250); authenticity is proven
 * by recomputing an HMAC-SHA256 over the raw request body with the webhook
 * endpoint's secret and comparing it to the `Webhook-Signature` header.
 */
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { activateMandate, fetchAndApplyPayment } from '../gocardless/padService.js';
import type { GoCardlessWebhookEvent } from '../gocardless/client.js';
import { runWithRlsBypass } from '../db/rlsContext.js';

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface GoCardlessWebhookPayload {
  events: GoCardlessWebhookEvent[];
}

export function gocardlessWebhookHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const secret = process.env.GOCARDLESS_WEBHOOK_SECRET;
    if (!secret) {
      res.status(500).json({ error: 'GOCARDLESS_WEBHOOK_SECRET not configured' });
      return;
    }
    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody)) {
      res.status(400).json({ error: 'Expected raw body' });
      return;
    }
    const signature = req.headers['webhook-signature'];
    if (!verifySignature(rawBody, typeof signature === 'string' ? signature : undefined, secret)) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    let payload: GoCardlessWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }

    // No session exists on a webhook call — activateMandate/fetchAndApplyPayment
    // look mandates/payments up by their external GoCardless id, not practiceId,
    // so there is no per-request tenant scope to derive here in the first place.
    const processed = await runWithRlsBypass(async () => {
      let count = 0;
      for (const event of payload.events) {
        try {
          await prisma.processedGoCardlessEvent.create({ data: { id: event.id } });
        } catch (e: unknown) {
          if ((e as { code?: string }).code === 'P2002') continue; // already processed
          throw e;
        }

        if (event.resource_type === 'mandates' && event.action === 'active' && event.links.mandate) {
          await activateMandate(prisma, event.links.mandate);
          count += 1;
        } else if (event.resource_type === 'payments' && event.links.payment) {
          await fetchAndApplyPayment(prisma, event.links.payment);
          count += 1;
        }
      }
      return count;
    });

    res.json({ received: true, processed, total: payload.events.length });
  };
}
