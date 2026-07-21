/**
 * SendGrid event webhook handler — processes bounces, opens, clicks, unsubscribes.
 * P4-01: Compliance logging for email events.
 *
 * Route: POST /api/webhooks/sendgrid
 * Signature: Ed25519 (SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY)
 * Documentation: https://docs.sendgrid.com/for-developers/tracking-events/event-webhook-overview
 *
 * Security: Verify webhook signature before processing. Return 200 for idempotency.
 */

import type { Request, Response } from 'express';
import { createHash, verifySignature } from '@sendgrid/eventwebhook';
import type { PrismaClient } from '@prisma/client';
import { logLine } from '../../observability/logger.js';
import { markEmailEvent } from '../../services/emailService.js';

/**
 * Map SendGrid event types to our EmailEventType.
 */
function mapSendGridEventType(sendGridEvent: string): string {
  const map: Record<string, string> = {
    sent: 'sent',
    open: 'opened',
    click: 'clicked',
    reply: 'replied',
    bounce: 'bounced',
    dropped: 'failed',
    spamreport: 'marked_spam',
    unsubscribe: 'unsubscribed',
    group_unsubscribe: 'unsubscribed',
    group_resubscribe: 'replied',
    deferred: 'deferred',
  };
  return map[sendGridEvent] || 'sent';
}

/**
 * Extract bounce reason from SendGrid bounce response.
 * "bounce_reason": "Mailbox full"
 */
function extractBounceReason(event: Record<string, unknown>): string | undefined {
  if (event.reason) return String(event.reason);
  if (event.bounce_reason) return String(event.bounce_reason);
  if (event.bounceType === 'Transient') return 'Soft bounce: temporary delivery issue';
  if (event.bounceType === 'Permanent') return 'Hard bounce: invalid or closed mailbox';
  return undefined;
}

/**
 * POST /api/webhooks/sendgrid
 * Process SendGrid events with Ed25519 signature verification.
 *
 * Required env:
 *   SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY (Ed25519 public key from SendGrid dashboard)
 *
 * Optional:
 *   SENDGRID_WEBHOOK_SIGNATURE_VERIFY=0 to disable verification (dev only!)
 */
export async function handleSendGridWebhook(
  req: Request,
  res: Response,
  db: PrismaClient,
): Promise<Response> {
  try {
    // Allow disabling signature verification for local dev
    const skipVerification =
      process.env.SENDGRID_WEBHOOK_SIGNATURE_VERIFY === '0' ||
      process.env.NODE_ENV === 'development';

    if (!skipVerification) {
      const signature = req.header('x-twilio-email-event-webhook-signature');
      const timestamp = req.header('x-twilio-email-event-webhook-timestamp');
      const verificationKey = process.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY;

      if (!verificationKey) {
        logLine('error', 'SendGrid webhook verification key not configured', {
          endpoint: '/api/webhooks/sendgrid',
        });
        return res.status(500).json({ error: 'Configuration error' });
      }

      if (!signature || !timestamp) {
        logLine('warn', 'SendGrid webhook missing signature headers', {
          hasSignature: !!signature,
          hasTimestamp: !!timestamp,
        });
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Verify the signature using SendGrid's eventwebhook library
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const isValid = verifySignature(verificationKey, body, signature, timestamp);

      if (!isValid) {
        logLine('warn', 'SendGrid webhook signature verification failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    // Parse events array
    const events: Array<Record<string, unknown>> = Array.isArray(req.body)
      ? req.body
      : [req.body];

    if (events.length === 0) {
      return res.status(200).json({ processed: 0 });
    }

    let processed = 0;
    let failed = 0;

    for (const event of events) {
      try {
        const email = String(event.email || '');
        const sendGridEventType = String(event.event || 'sent');
        const eventType = mapSendGridEventType(sendGridEventType);
        const timestamp = event.timestamp ? new Date(Number(event.timestamp) * 1000) : new Date();

        logLine('info', 'Processing SendGrid event', {
          email: '[redacted:email]',
          sendGridEventType,
          mappedEventType: eventType,
        });

        // Find prospect by email
        const prospect = await db.prospect.findFirst({
          where: { email },
          select: { id: true },
        });

        if (!prospect) {
          logLine('warn', 'SendGrid event: prospect not found', {
            email: '[redacted:email]',
            eventType,
          });
          failed++;
          continue;
        }

        // Build metadata
        const metadata = {
          sendgridMessageId: event.sg_message_id,
          templateId: event.category ? String(event.category) : undefined,
          bounceType: event.bounceType ? String(event.bounceType) : undefined,
          bounceReason: extractBounceReason(event),
          linkClicked: event.url ? String(event.url) : undefined,
          reasonCode: event.reason ? String(event.reason) : undefined,
          status: event.status ? String(event.status) : undefined,
        };

        // Record the event
        await markEmailEvent(db, prospect.id, eventType as Parameters<typeof markEmailEvent>[2], metadata);

        processed++;
      } catch (eventErr) {
        const error = eventErr instanceof Error ? eventErr.message : String(eventErr);
        logLine('error', 'Failed to process SendGrid event', { error });
        failed++;
      }
    }

    logLine('info', 'SendGrid webhook processed', {
      total: events.length,
      processed,
      failed,
    });

    // Return 200 to acknowledge receipt (SendGrid will retry on 4xx/5xx)
    return res.status(200).json({
      processed,
      failed,
      total: events.length,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logLine('error', 'SendGrid webhook handler error', { error });
    return res.status(500).json({ error });
  }
}

/**
 * Sample event structure from SendGrid webhook.
 * Not all fields present on every event — depends on event type.
 *
 * {
 *   "email": "prospect@example.com",
 *   "event": "bounce",
 *   "timestamp": 1600819200,
 *   "sg_message_id": "VJ23a34…",
 *   "sg_event_id": "VJ23a34…",
 *   "reason": "Mailbox does not exist",
 *   "bounceType": "Permanent",
 *   "status": "5.1.1"
 * }
 *
 * Full webhook reference:
 * https://docs.sendgrid.com/for-developers/tracking-events/event-webhook-overview
 */
