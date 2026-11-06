import { Router, type Request, type Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { recordDemoBooking } from '../marketing/demoScheduler.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Cal.com signs the raw request body and sends the digest as
 * `X-Cal-Signature-256: sha256=<hmac-sha256 hex>`. It never sends the secret
 * itself in a header, so verification has to recompute this digest — a
 * string-equality check against a header never matches a real delivery.
 */
function verifyCalComSignature(rawBody: Buffer, header: string, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return timingSafeStringEqual(header, expected);
}

/**
 * Calendly signs `${timestamp}.${rawBody}` and sends
 * `Calendly-Webhook-Signature: t=<timestamp>,v1=<hmac-sha256 hex>`.
 */
function verifyCalendlySignature(rawBody: Buffer, header: string, secret: string): boolean {
  const parts = new Map(
    header.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key?.trim() ?? '', value?.trim() ?? ''];
    }),
  );
  const timestamp = parts.get('t');
  const signature = parts.get('v1');
  if (!timestamp || !signature) return false;

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');
  return timingSafeStringEqual(signature, expected);
}

/** Fallback for internally-triggered/generic bookings that aren't Calendly or Cal.com. */
function verifyRawSecretHeader(req: Request, secret: string): boolean {
  const provided =
    req.header('X-CollectRx-Webhook-Secret') ||
    req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  return provided !== undefined && timingSafeStringEqual(provided, secret);
}

function verifyWebhookSignature(req: Request, rawBody: Buffer): boolean {
  const secret = process.env.MARKETING_DEMO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }

  const calComHeader = req.header('X-Cal-Signature-256');
  if (calComHeader) return verifyCalComSignature(rawBody, calComHeader, secret);

  const calendlyHeader = req.header('Calendly-Webhook-Signature');
  if (calendlyHeader) return verifyCalendlySignature(rawBody, calendlyHeader, secret);

  return verifyRawSecretHeader(req, secret);
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
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ success: false, error: 'Expected raw JSON body' });
    }

    if (!verifyWebhookSignature(req, rawBody)) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    try {
      const body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
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
