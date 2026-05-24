import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { verifyUnsubscribeRequest } from '../email/unsubscribeUrl';
import { publicLimiter } from '../middleware/rateLimiter';
import {
  isDatabaseUnavailableError,
  isReasonableUnsubscribeEmail,
  isValidPatientBalanceId,
  isValidPublicPayToken,
  publicPayJsonError,
} from '../publicApiHelpers';

/**
 * Unauthenticated public routes: patient pay token page + signed email unsubscribe.
 */
export function createPublicPatientPayRouter(prisma: PrismaClient): Router {
  const r = Router();
  r.use(publicLimiter);

  /**
   * P4-02 — List-unsubscribe from reminder emails (`buildEmailUnsubscribeUrl`).
   * GET applies `emailOptOutAt` on the matching `PatientBalance`.
   */
  r.get('/public/email-unsubscribe', async (req: Request, res: Response) => {
    const balanceId = typeof req.query.b === 'string' ? req.query.b.trim() : '';
    const email = typeof req.query.e === 'string' ? req.query.e.trim() : '';
    const sig = typeof req.query.s === 'string' ? req.query.s : undefined;
    if (!balanceId || !email || !sig || sig.length > 256) {
      return res.status(400).type('html').send('<p>Invalid unsubscribe link.</p>');
    }
    if (!isValidPatientBalanceId(balanceId) || !isReasonableUnsubscribeEmail(email)) {
      return res.status(400).type('html').send('<p>Invalid unsubscribe link.</p>');
    }
    let ok = false;
    try {
      ok = verifyUnsubscribeRequest(balanceId, email, sig);
    } catch (e) {
      console.error('[GET /public/email-unsubscribe] config', e);
      return res.status(500).type('html').send('<p>Unsubscribe is temporarily unavailable.</p>');
    }
    if (!ok) {
      return res.status(403).type('html').send('<p>Invalid or expired link.</p>');
    }
    const emailNorm = email.toLowerCase();
    try {
      const row = await prisma.patientBalance.findFirst({
        where: { id: balanceId },
        select: { id: true, patientEmail: true },
      });
      if (!row) {
        return res.status(404).type('html').send('<p>Record not found.</p>');
      }
      if (row.patientEmail) {
        const db = row.patientEmail.toLowerCase().trim();
        if (db !== emailNorm) {
          return res.status(403).type('html').send('<p>This link does not match our records.</p>');
        }
      }
      await prisma.patientBalance.update({
        where: { id: balanceId },
        data: { emailOptOutAt: new Date() },
      });
      return res
        .status(200)
        .type('html')
        .send(
          '<p>You have been unsubscribed from balance reminder emails for this account.</p>',
        );
    } catch (e) {
      console.error('[GET /public/email-unsubscribe]', e);
      if (isDatabaseUnavailableError(e)) {
        return res
          .status(503)
          .type('html')
          .send('<p>Service is temporarily unavailable. Please try again later.</p>');
      }
      return res.status(500).type('html').send('<p>Something went wrong. Please try again later.</p>');
    }
  });

  r.get('/public/pay/:publicToken', async (req: Request, res: Response) => {
    const publicToken = req.params.publicToken?.trim() ?? '';
    if (!publicToken || !isValidPublicPayToken(publicToken)) {
      return res.status(400).json({ error: 'Invalid link' });
    }

    try {
      const b = await prisma.patientBalance.findUnique({
        where: { publicPayToken: publicToken },
        select: {
          patientFirstName: true,
          patientOwes: true,
          amountPaid: true,
          paymentStatus: true,
          stripePaymentLink: true,
          publicPayTokenExpiresAt: true,
        },
      });

      if (!b) {
        return res.status(404).json({ error: 'Not found' });
      }

      if (b.publicPayTokenExpiresAt && b.publicPayTokenExpiresAt.getTime() < Date.now()) {
        return res.status(410).json({ message: 'Link expired' });
      }

      const owes = Number(b.patientOwes) || 0;
      const paid = Number(b.amountPaid) || 0;
      const amountDue = Math.max(0, owes - paid);
      const paidUp = b.paymentStatus === 'paid' || amountDue <= 0;
      const link =
        typeof b.stripePaymentLink === 'string' && b.stripePaymentLink.trim().length > 0
          ? b.stripePaymentLink.trim()
          : null;

      return res.json({
        paid: paidUp,
        amountDue,
        currency: 'CAD',
        stripeUrl: link,
        firstName: (b.patientFirstName || '').trim() || 'there',
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'P2025' || code === 'P2021') {
        return res.status(404).json({ error: 'Not found' });
      }
      console.error('GET /public/pay/:publicToken error', e);
      const mapped = publicPayJsonError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  return r;
}
