import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { recordDemoBooking } from '../marketing/demoScheduler.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';

function verifyWebhookSecret(req: Request): boolean {
  const expected = process.env.MARKETING_DEMO_WEBHOOK_SECRET?.trim();
  if (!expected) {
    return process.env.NODE_ENV !== 'production';
  }
  const provided =
    req.header('X-CollectRx-Webhook-Secret') ||
    req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  return provided === expected;
}

function parseScheduledAt(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Calendly invitee.created payload shape (subset). */
function parseCalendlyBody(body: Record<string, unknown>): {
  email?: string;
  scheduledAt?: Date;
  externalId?: string;
} | null {
  const event = body.event;
  if (event !== 'invitee.created') return null;
  const payload = body.payload as Record<string, unknown> | undefined;
  if (!payload) return null;
  const email =
    typeof payload.email === 'string'
      ? payload.email
      : typeof (payload.invitee as { email?: string } | undefined)?.email === 'string'
        ? (payload.invitee as { email: string }).email
        : undefined;
  const scheduledEvent = payload.scheduled_event as { start_time?: string } | undefined;
  const scheduledAt = parseScheduledAt(scheduledEvent?.start_time);
  const uri = typeof payload.uri === 'string' ? payload.uri : undefined;
  return { email, scheduledAt: scheduledAt ?? undefined, externalId: uri };
}

/** Cal.com BOOKING_CREATED payload shape (subset). */
function parseCalComBody(body: Record<string, unknown>): {
  email?: string;
  scheduledAt?: Date;
  externalId?: string;
} | null {
  if (body.triggerEvent !== 'BOOKING_CREATED') return null;
  const payload = body.payload as Record<string, unknown> | undefined;
  if (!payload) return null;
  const attendees = payload.attendees as { email?: string }[] | undefined;
  const email = attendees?.[0]?.email;
  const startTime = payload.startTime ?? payload.start;
  const scheduledAt = parseScheduledAt(startTime);
  const uid = typeof payload.uid === 'string' ? payload.uid : undefined;
  return { email, scheduledAt: scheduledAt ?? undefined, externalId: uid };
}

function parseGenericBody(body: Record<string, unknown>): {
  prospectId?: string;
  email?: string;
  scheduledAt: Date;
  source: string;
  externalId?: string;
} | null {
  const scheduledAt = parseScheduledAt(body.scheduledAt ?? body.startTime ?? body.start_time);
  if (!scheduledAt) return null;
  return {
    prospectId: typeof body.prospectId === 'string' ? body.prospectId : undefined,
    email: typeof body.email === 'string' ? body.email : undefined,
    scheduledAt,
    source: typeof body.source === 'string' ? body.source : 'webhook',
    externalId: typeof body.externalId === 'string' ? body.externalId : undefined,
  };
}

export function createDemoBookingWebhookRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    if (!verifyWebhookSecret(req)) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
      const body = req.body as Record<string, unknown>;
      const calendly = parseCalendlyBody(body);
      const calcom = parseCalComBody(body);
      const generic = parseGenericBody(body);

      const parsed = calendly || calcom || generic;
      if (!parsed?.scheduledAt) {
        return res.status(400).json({ success: false, error: 'scheduledAt required' });
      }

      const source = calendly ? 'calendly' : calcom ? 'cal.com' : generic?.source || 'webhook';
      const prospectId =
        generic?.prospectId ||
        (typeof body.prospectId === 'string' ? body.prospectId : undefined);

      const result = await recordDemoBooking(prisma, {
        prospectId,
        email: parsed.email ?? generic?.email,
        scheduledAt: parsed.scheduledAt,
        source,
        externalId: parsed.externalId ?? generic?.externalId,
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(422).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });

  return router;
}
