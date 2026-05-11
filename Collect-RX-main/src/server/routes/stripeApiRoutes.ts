import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  createOnboardingLink,
  refreshAccountStatus,
  handleWebhook,
  verifyOnboardReturn,
} from '../stripe/connect';
import { frontendBaseUrl } from '../stripe/billing';
import { COOKIE_NAME, verifyPracticeToken, type PracticeJwtPayload } from '../authToken';

function practicePayloadFromRequest(req: Request): PracticeJwtPayload | null {
  try {
    const fromCookie = req.cookies?.[COOKIE_NAME] as string | undefined;
    const header = req.headers.authorization;
    const fromBearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const raw = fromBearer || fromCookie;
    if (!raw) return null;
    const payload = verifyPracticeToken(raw);
    if (payload.role !== 'practice' || !payload.practiceId) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Signed Stripe return URL (v=) or same-practice JWT — blocks IDOR on practice_id. */
function allowStripeOnboardReturn(req: Request, practiceId: string): boolean {
  const v = typeof req.query.v === 'string' ? req.query.v : '';
  if (verifyOnboardReturn(practiceId, v)) return true;
  const session = practicePayloadFromRequest(req);
  return Boolean(session?.practiceId === practiceId);
}

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
    if (!allowStripeOnboardReturn(req, practiceId)) {
      res.status(403).send('Forbidden');
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
    if (!allowStripeOnboardReturn(req, practiceId)) {
      res.status(403).send('Forbidden');
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
