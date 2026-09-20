/**
 * Stripe webhook handler for CollectRx platform billing.
 * Handles practice subscription events (Stripe Billing) only.
 * CollectRx is Practice → Insurance; no patient/client payment collection.
 */
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { getStripe, handlePlatformBillingWebhook } from '../stripe/billing.js';
import { apiClientErrorMessage } from '../apiErrorMessage.js';
import { logger } from '../observability/logger.js';

/** Raw-body webhook handler — must be mounted before express.json(). */
export function stripeWebhookHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers['stripe-signature'];
    if (!sig || typeof sig !== 'string') {
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET not configured' });
      return;
    }
    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody)) {
      res.status(400).json({ error: 'Expected raw body' });
      return;
    }
    let event: Stripe.Event;
    try {
      event = getStripe().webhooks.constructEvent(rawBody, sig, secret);
    } catch (err) {
      res.status(400).json({ error: `Stripe signature verification failed: ${(err as Error).message}` });
      return;
    }
    try {
      logger.info('[stripe/webhook] received', { type: event.type, id: event.id });
      const result = await handlePlatformBillingWebhook(event, prisma, getStripe());
      res.json({ received: true, ...result });
    } catch (e) {
      logger.error('[stripe/webhook]', { error: e });
      res.status(400).json({ error: apiClientErrorMessage(e) });
    }
  };
}
