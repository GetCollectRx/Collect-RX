import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requirePracticeContext, practiceIdFromSession } from '../middleware/requirePracticeSession';
import { authenticate } from '../middleware/authenticate';
import { requirePracticeOwner } from '../middleware/requirePracticeOwner.js';
import { createBillingCheckoutSession, createBillingPortalSession, getSubscriptionGateState } from '../stripe/billing';
import { apiClientErrorMessage } from '../apiErrorMessage.js';

export function createBillingRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.post('/checkout', authenticate, requirePracticeContext, requirePracticeOwner, async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      const requestedPlanId = typeof req.body?.planId === 'string' ? req.body.planId.trim() : undefined;
      const { url } = await createBillingCheckoutSession(practiceId, prisma, requestedPlanId);
      res.json({ url });
    } catch (e) {
      console.error('[billing/checkout]', e);
      res.status(400).json({ error: apiClientErrorMessage(e) });
    }
  });

  r.get('/usage', authenticate, requirePracticeContext, async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      const subscription = await getSubscriptionGateState(prisma, practiceId);
      res.json({ subscription });
    } catch (e) {
      console.error('[billing/usage]', e);
      res.status(400).json({ error: apiClientErrorMessage(e) });
    }
  });

  r.post('/portal', authenticate, requirePracticeContext, requirePracticeOwner, async (req: Request, res: Response) => {
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
