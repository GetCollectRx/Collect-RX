/**
 * GoCardless PAD billing: practice-facing mandate registration + the
 * reconciliation poller trigger. Mounted under /api/gocardless (json body).
 *
 * Bank account details are never accepted here — the practice completes
 * GoCardless's own hosted Billing Request Flow (returned by GET
 * /mandate/authorization-link) to enter banking info and sign the PAD
 * agreement directly with GoCardless.
 */
import { Router, type Request, type Response } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../middleware/authenticate';
import { practiceIdFromSession, requirePracticeContext } from '../middleware/requirePracticeSession';
import { requirePracticeOwner } from '../middleware/requirePracticeOwner';
import { isPlatformDev } from '../accessControl/types.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { frontendBaseUrl } from '../stripe/billing.js';
import {
  registerPadMandate,
  getAuthorizationLink,
  cancelPadMandate,
  reconcilePendingAuthorizations,
  reconcilePendingPadTransactions,
} from '../gocardless/padService.js';

const router = Router();
router.use(authenticate);
router.use(requirePracticeContext);
router.use((req, res, next) => {
  if (isPlatformDev(req.auth)) return next();
  return requirePracticeOwner(req, res, next);
});

router.get('/mandate', async (req: Request, res: Response) => {
  const practiceId = practiceIdFromSession(req);
  const mandate = await prisma.padMandate.findUnique({
    where: { practiceId },
    include: { transactions: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  res.json({ mandate });
});

router.post('/mandate', async (req: Request, res: Response) => {
  const practiceId = practiceIdFromSession(req);
  const { billingEmail, monthlyAmountCents } = req.body as {
    billingEmail?: string;
    monthlyAmountCents?: number;
  };
  if (!billingEmail || !monthlyAmountCents) {
    res.status(400).json({ error: 'billingEmail and monthlyAmountCents are required' });
    return;
  }
  try {
    const practice = await prisma.practice.findUniqueOrThrow({ where: { id: practiceId }, select: { name: true } });
    const mandate = await registerPadMandate(prisma, {
      practiceId,
      practiceName: practice.name,
      billingEmail,
      monthlyAmountCents,
    });
    res.status(201).json({ mandate });
  } catch (e) {
    res.status(400).json({ error: apiErrorMessageForResponse(e) });
  }
});

router.get('/mandate/authorization-link', async (req: Request, res: Response) => {
  const practiceId = practiceIdFromSession(req);
  try {
    const url = await getAuthorizationLink(prisma, practiceId, frontendBaseUrl());
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: apiErrorMessageForResponse(e) });
  }
});

router.delete('/mandate', async (req: Request, res: Response) => {
  const practiceId = practiceIdFromSession(req);
  try {
    const mandate = await cancelPadMandate(prisma, practiceId);
    res.json({ mandate });
  } catch (e) {
    res.status(400).json({ error: apiErrorMessageForResponse(e) });
  }
});

/**
 * Manual triggers for the reconciliation poller — a safety net alongside
 * real GoCardless webhooks (see jobs/padReconciliationScheduler.ts) in
 * case a webhook delivery is missed.
 */
router.post('/reconcile', async (_req: Request, res: Response) => {
  try {
    const [authorizations, transactions] = await Promise.all([
      reconcilePendingAuthorizations(prisma),
      reconcilePendingPadTransactions(prisma),
    ]);
    res.json({ authorizations, transactions });
  } catch (e) {
    res.status(500).json({ error: apiErrorMessageForResponse(e) });
  }
});

export default router;
