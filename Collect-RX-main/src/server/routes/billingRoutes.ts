import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/authenticate';
import { createBillingCheckoutSession, createBillingPortalSession } from '../stripe/billing';

export function createBillingRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.post('/checkout', authenticate, async (req: Request, res: Response) => {
    try {
      const practiceId = req.practiceAuth!.practiceId;
      const { url } = await createBillingCheckoutSession(practiceId, prisma);
      res.json({ url });
    } catch (e) {
      console.error('[billing/checkout]', e);
      res.status(400).json({ error: (e as Error).message });
    }
  });

  r.post('/portal', authenticate, async (req: Request, res: Response) => {
    try {
      const practiceId = req.practiceAuth!.practiceId;
      const { url } = await createBillingPortalSession(practiceId, prisma);
      res.json({ url });
    } catch (e) {
      console.error('[billing/portal]', e);
      res.status(400).json({ error: (e as Error).message });
    }
  });

  return r;
}
