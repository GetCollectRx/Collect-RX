/**
 * P4-01 / P4-02 — SendGrid Event Webhook: bounces, drops, spam reports.
 * Also handles marketing prospect engagement events (open, click, unsubscribe)
 * when custom_arg `prospect_id` is present.
 * https://docs.sendgrid.com/for-developers/tracking-events/event
 */
import { createRequire } from 'module';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { fireHotLeadAlert } from '../marketing/hotLeadAlerts.js';

const require = createRequire(import.meta.url);
const { EventWebhook, EventWebhookHeader } = require('@sendgrid/eventwebhook') as {
  EventWebhook: new () => {
    convertPublicKeyToECDSA: (k: string) => unknown;
    verifySignature: (key: unknown, body: string | Buffer, sig: string, ts: string) => boolean;
  };
  EventWebhookHeader: { SIGNATURE: () => string; TIMESTAMP: () => string };
};

type SgEvent = {
  email?: string;
  event?: string;
  reason?: string;
  /** custom_args from SendGrid v3 */
  balance_id?: string;
  prospect_id?: string;
  sequence_id?: string;
  step?: string;
  url?: string;
};

function optOutRelevant(e: string | undefined) {
  return e === 'bounce' || e === 'dropped' || e === 'spamreport' || e === 'unsubscribe';
}

function getHeader(req: Request, name: string): string {
  const h = req.headers[name.toLowerCase()] ?? req.headers[name];
  return String(Array.isArray(h) ? h[0] : h || '');
}

/**
 * `express.raw` must run first. Pass `prisma` from the app.
 */
export function makeSendgridEventWebhookHandler(prisma: PrismaClient) {
  return async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''), 'utf8');
    const bodyString = rawBody.toString('utf8');

    const publicKeyPem = process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY;
    if (publicKeyPem) {
      const ewh = new EventWebhook();
      const pub = ewh.convertPublicKeyToECDSA(publicKeyPem.replace(/\\n/g, '\n'));
      const sig = getHeader(req, EventWebhookHeader.SIGNATURE());
      const ts = getHeader(req, EventWebhookHeader.TIMESTAMP());
      if (!sig || !ts || !ewh.verifySignature(pub, rawBody, sig, ts)) {
        console.error('[sendgrid/webhook] signature verification failed');
        return res.status(401).type('text/plain').send('invalid signature');
      }
    } else if (process.env.NODE_ENV === 'production') {
      console.error(
        '[sendgrid/webhook] SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY is required in production',
      );
      return res.status(401).type('text/plain').send('verification required');
    } else {
      console.warn(
        '[sendgrid/webhook] SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY unset — webhook is not verified (dev only)',
      );
    }

    let events: SgEvent[];
    try {
      events = JSON.parse(bodyString) as SgEvent[];
      if (!Array.isArray(events)) {
        return res.status(400).type('text/plain').send('expected array');
      }
    } catch {
      return res.status(400).type('text/plain').send('invalid json');
    }

    for (const ev of events) {
      // ── Marketing prospect engagement events ──────────────────────────────
      if (ev.prospect_id && typeof ev.prospect_id === 'string') {
        await handleProspectEngagement(prisma, ev);
        continue;
      }

      if (!optOutRelevant(ev.event)) {
        continue;
      }
        const balId = ev.balance_id;
      if (balId && typeof balId === 'string') {
        try {
          await prisma.patientBalance.updateMany({
            where: { id: balId },
            data: { emailOptOutAt: new Date() },
          });
          console.log('[sendgrid/webhook] email opt-out by balance', { event: ev.event, balanceId: balId });
        } catch (e) {
          console.error('[sendgrid/webhook] db error', (e as Error).message);
        }
        continue;
      }
      const em = (ev.email || '').toLowerCase().trim();
      if (em) {
        try {
          const r = await prisma.patientBalance.updateMany({
            where: { patientEmail: { equals: em, mode: 'insensitive' } },
            data: { emailOptOutAt: new Date() },
          });
          if (r.count) {
            console.log('[sendgrid/webhook] email opt-out by address', { event: ev.event, count: r.count });
          }
        } catch (e) {
          console.error('[sendgrid/webhook] db error', (e as Error).message);
        }
      }
    }

    return res.status(200).type('text/plain').send('ok');
  };
}

/** Open/click/unsubscribe/bounce events for marketing prospect emails. */
async function handleProspectEngagement(prisma: PrismaClient, ev: SgEvent): Promise<void> {
  const prospectId = ev.prospect_id!;
  const now = new Date();

  try {
    const prospect = await prisma.prospectPractice.findUnique({ where: { id: prospectId } });
    if (!prospect) return;

    switch (ev.event) {
      case 'open': {
        await prisma.prospectEvent.create({
          data: {
            prospectId,
            sequenceId: ev.sequence_id || null,
            type: 'email_opened',
            metadata: { step: ev.step },
            occurredAt: now,
          },
        });

        // Count total opens for this prospect
        const openCount = await prisma.prospectEvent.count({
          where: { prospectId, type: 'email_opened' },
        });

        // Advance stage: contacted → engaged
        if (prospect.stage === 'contacted' || prospect.stage === 'new') {
          await prisma.prospectPractice.update({
            where: { id: prospectId },
            data: { stage: 'engaged', score: Math.min(100, prospect.score + 5), updatedAt: now },
          });
        }

        // Fire hot lead alert on 3rd open
        if (openCount === 3) {
          await fireHotLeadAlert({
            prospectName: prospect.name,
            prospectId,
            city: prospect.city,
            stage: 'engaged',
            score: Math.min(100, prospect.score + 5),
            trigger: 'email_opened_3x',
            detail: `Opened ${openCount} emails — high intent signal`,
          });
        }
        break;
      }

      case 'click': {
        await prisma.prospectEvent.create({
          data: {
            prospectId,
            sequenceId: ev.sequence_id || null,
            type: 'email_clicked',
            metadata: { step: ev.step, url: ev.url },
            occurredAt: now,
          },
        });

        // Advance to engaged, boost score
        await prisma.prospectPractice.update({
          where: { id: prospectId },
          data: {
            stage: ['new', 'contacted', 'engaged'].includes(prospect.stage) ? 'engaged' : prospect.stage,
            score: Math.min(100, prospect.score + 10),
            updatedAt: now,
          },
        });

        // Demo link click = strong signal → alert immediately
        if (ev.url?.includes('demo') || ev.url?.includes('calendly') || ev.url?.includes('cal.com')) {
          await fireHotLeadAlert({
            prospectName: prospect.name,
            prospectId,
            city: prospect.city,
            stage: 'engaged',
            score: Math.min(100, prospect.score + 10),
            trigger: 'email_clicked',
            detail: `Clicked demo link: ${ev.url?.slice(0, 80)}`,
          });
        }
        break;
      }

      case 'unsubscribe':
      case 'group_unsubscribe':
      case 'spamreport': {
        await prisma.prospectPractice.update({
          where: { id: prospectId },
          data: { optedOutAt: now, stage: 'not_interested', updatedAt: now },
        });
        await prisma.prospectSequence.updateMany({
          where: { prospectId, status: { in: ['active', 'paused'] } },
          data: { status: 'stopped', completedAt: now, updatedAt: now },
        });
        await prisma.prospectEvent.create({
          data: { prospectId, type: 'unsubscribed', metadata: { via: ev.event }, occurredAt: now },
        });
        break;
      }

      case 'bounce':
      case 'dropped': {
        await prisma.prospectEvent.create({
          data: {
            prospectId,
            type: 'email_bounced',
            metadata: { event: ev.event, reason: ev.reason, step: ev.step },
            occurredAt: now,
          },
        });
        // Score down — bad email address
        await prisma.prospectPractice.update({
          where: { id: prospectId },
          data: { score: Math.max(0, prospect.score - 20), updatedAt: now },
        });
        break;
      }
    }
  } catch (e) {
    console.error('[sendgrid/webhook] prospect engagement error', { prospectId, event: ev.event, err: (e as Error).message });
  }
}
