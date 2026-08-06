import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { strictLimiter } from '../middleware/rateLimiter';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface EarlyAccessLead {
  name: string;
  email: string;
  practiceName: string;
  phone: string;
  intent: 'access' | 'demo';
  message: string;
}

/**
 * Unauthenticated lead capture for the public landing page (collectrx.ca)
 * "Request Early Access" / "Book a Demo" CTAs.
 */
export function createEarlyAccessRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.post('/early-access', strictLimiter, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const practiceName = typeof body.practiceName === 'string' ? body.practiceName.trim() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const intent: EarlyAccessLead['intent'] = body.intent === 'demo' ? 'demo' : 'access';

    if (!name || name.length > 200) {
      return res.status(400).json({ success: false, error: 'Please enter your name.' });
    }
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }
    if (practiceName.length > 200 || phone.length > 50 || message.length > 2000) {
      return res.status(400).json({ success: false, error: 'One of the fields is too long.' });
    }

    try {
      await prisma.earlyAccessRequest.create({
        data: {
          name,
          email,
          practiceName: practiceName || null,
          phone: phone || null,
          intent,
          message: message || null,
        },
      });
    } catch (e) {
      console.error('[POST /api/early-access] db error', e);
      return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
    }

    notifyEarlyAccessRequest({ name, email, practiceName, phone, intent, message }).catch((e) => {
      console.error('[POST /api/early-access] notify error', e);
    });

    res.status(201).json({ success: true });
  });

  return r;
}

/** Best-effort email notification — failures here never block the lead from being saved. */
async function notifyEarlyAccessRequest(lead: EarlyAccessLead): Promise<void> {
  if (!process.env.SENDGRID_API_KEY) return;

  const to = process.env.EARLY_ACCESS_NOTIFY_EMAIL || process.env.SENDGRID_FROM_EMAIL || 'billing@collectrx.ca';
  const sg = require('@sendgrid/mail');
  sg.setApiKey(process.env.SENDGRID_API_KEY);

  const subject = lead.intent === 'demo'
    ? `New demo request: ${lead.name}`
    : `New early access request: ${lead.name}`;

  const lines = [
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    lead.practiceName ? `Practice: ${lead.practiceName}` : null,
    lead.phone ? `Phone: ${lead.phone}` : null,
    lead.message ? `Message: ${lead.message}` : null,
  ].filter((line): line is string => line !== null).join('\n');

  await sg.send({
    to,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL || 'billing@collectrx.ca',
      name: process.env.SENDGRID_FROM_NAME || 'CollectRx',
    },
    subject,
    text: lines,
  });
}
