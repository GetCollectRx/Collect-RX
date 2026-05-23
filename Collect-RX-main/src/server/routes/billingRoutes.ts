import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/authenticate';
import { requirePracticeContext, practiceIdFromSession } from '../middleware/requirePracticeSession';
import { createBillingCheckoutSession, createBillingPortalSession } from '../stripe/billing';
import { apiClientErrorMessage } from '../apiErrorMessage.js';

export function createBillingRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.post('/checkout', authenticate, requirePracticeContext, async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      const { url } = await createBillingCheckoutSession(practiceId, prisma);
      res.json({ url });
    } catch (e) {
      console.error('[billing/checkout]', e);
      res.status(400).json({ error: apiClientErrorMessage(e) });
    }
  });

  r.post('/portal', authenticate, requirePracticeContext, async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      const { url } = await createBillingPortalSession(practiceId, prisma);
      res.json({ url });
    } catch (e) {
      console.error('[billing/portal]', e);
      res.status(400).json({ error: apiClientErrorMessage(e) });
    }
  });

  return r;
}
