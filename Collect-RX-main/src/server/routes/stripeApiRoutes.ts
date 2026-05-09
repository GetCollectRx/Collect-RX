import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createOnboardingLink, refreshAccountStatus, handleWebhook } from '../stripe/connect';
import { frontendBaseUrl } from '../stripe/billing';

export function stripeWebhookHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const sig = req.headers['stripe-signature'];
    if (!sig || typeof sig !== 'string') {
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }
    try {
      const rawBody = req.body as Buffer;
      if (!Buffer.isBuffer(rawBody)) {
        res.status(400).json({ error: 'Expected raw body' });
        return;
      }
      const result = await handleWebhook(rawBody, sig, prisma);
      res.json({ received: true, ...result });
    } catch (e) {
      console.error('[stripe/webhook]', e);
      res.status(400).json({ error: (e as Error).message });
    }
  };
}

export function createStripeConnectRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/connect/onboard/refresh', async (req: Request, res: Response) => {
    const practiceId = typeof req.query.practice_id === 'string' ? req.query.practice_id : '';
    if (!practiceId) {
      res.status(400).send('practice_id required');
      return;
    }
    try {
      const p = await prisma.practice.findUnique({ where: { id: practiceId } });
      const { url } = await createOnboardingLink(practiceId, undefined, p?.name ?? undefined);
      res.redirect(303, url);
    } catch (e) {
      console.error('[stripe/connect/refresh]', e);
      res.status(500).send((e as Error).message);
    }
  });

  r.get('/connect/onboard/complete', async (req: Request, res: Response) => {
    const practiceId = typeof req.query.practice_id === 'string' ? req.query.practice_id : '';
    if (!practiceId) {
      res.status(400).send('practice_id required');
      return;
    }
    try {
      await refreshAccountStatus(practiceId);
    } catch (e) {
      console.error('[stripe/connect/complete]', e);
    }
    res.redirect(303, `${frontendBaseUrl()}/admin`);
  });

  return r;
}
