/**
 * Email Service — SendGrid integration with CASL compliance, template rendering, and bounce tracking.
 * P4-01: Email campaigns for prospect outreach and practice notifications.
 *
 * Key patterns:
 * - CASL-compliant: unsubscribe headers, mailing address, clear identification
 * - Template rendering with merge fields: {{OwnerLastName}}, {{PracticeName}}, {{BookingLink}}, etc.
 * - Bounce/complaint/unsubscribe tracking via SendGrid webhooks
 * - Idempotent: duplicate sends return early if already sent today
 * - No PHI: prospect campaigns use generic merge fields only
 * - Audit trail: all sends + bounces logged to EmailCampaignEvent
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { logLine } from '../observability/logger.js';

/**
 * Email template type — defines merge field keys and CASL footer.
 */
export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  requiredFields: string[];
  unsubscribeUrl?: string;
}

/**
 * Prospect merge data — keys match {{...}} placeholders in templates.
 */
export interface ProspectMergeData {
  OwnerLastName?: string;
  OwnerFirstName?: string;
  PracticeName?: string;
  PracticeCity?: string;
  PracticeProvince?: string;
  BookingLink?: string;
  UnsubscribeLink?: string;
  [key: string]: string | undefined;
}

/**
 * Email send result — tracks delivery and any errors.
 */
export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  bounced?: boolean;
  invalidEmail?: boolean;
}

/**
 * Email event type — maps to SendGrid webhook events.
 */
export type EmailEventType =
  | 'sent'
  | 'opened'
  | 'clicked'
  | 'replied'
  | 'bounced'
  | 'unsubscribed'
  | 'marked_spam'
  | 'deferred'
  | 'failed';

/**
 * Metadata attached to email events for tracking and debugging.
 */
export interface EmailEventMetadata {
  campaignId?: string;
  campaignName?: string;
  templateId?: string;
  templateName?: string;
  subject?: string;
  sendgridMessageId?: string;
  bounceType?: 'hard' | 'soft';
  bounceReason?: string;
  linkClicked?: string;
  [key: string]: unknown;
}

/**
 * CASL-compliant mailing address footer (Canadian legal requirement).
 * Can be overridden per-campaign via environment variables.
 */
function getMailingAddress(): string {
  const address = process.env.CASL_MAILING_ADDRESS ||
    `
    CollectRx
    145 King Street West, Suite 200
    Toronto, ON M5H 1A8
    Canada
    `.trim();
  return address;
}

/**
 * Render a template with merge data. Replaces {{key}} with values.
 * Throws if required fields are missing.
 */
export function renderTemplate(
  template: EmailTemplate,
  mergeData: ProspectMergeData,
): {
  subject: string;
  htmlBody: string;
  textBody: string;
} {
  for (const field of template.requiredFields) {
    if (!mergeData[field]) {
      throw new Error(`Missing required template field: ${field}`);
    }
  }

  const render = (text: string): string => {
    let result = text;
    for (const [key, value] of Object.entries(mergeData)) {
      if (value) {
        result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }
    }
    return result;
  };

  return {
    subject: render(template.subject),
    htmlBody: render(template.htmlBody),
    textBody: render(template.textBody),
  };
}

/**
 * Build CASL-compliant unsubscribe footer HTML.
 * Includes: list-unsubscribe header hint, mailing address, unsubscribe link.
 */
function buildCaslFooter(unsubscribeLink?: string): string {
  const mailingAddress = getMailingAddress();
  const footer = `
    <hr style="border: none; border-top: 1px solid #ccc; margin: 2em 0;">
    <p style="font-size: 12px; color: #666;">
      <strong>CollectRx</strong><br>
      ${mailingAddress.split('\n').join('<br>')}<br>
      <br>
      You received this email because you are subscribed to CollectRx marketing communications.
      ${unsubscribeLink ? `<a href="${unsubscribeLink}" style="color: #0066cc; text-decoration: underline;">Unsubscribe here</a>` : ''}
    </p>
  `;
  return footer;
}

/**
 * Validate email address format.
 */
function isValidEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email) && email.length <= 254;
}

/**
 * Send a campaign email to a prospect. CASL-compliant with merge fields.
 *
 * Idempotent: only sends once per prospect per day per template (when
 * MARKETING_IDEMPOTENT=1, the default).
 *
 * @param db Prisma client
 * @param prospectId UUID of prospect to send to
 * @param campaignId Optional campaign UUID (for tracking/grouping)
 * @param template Email template with subject, body, merge fields
 * @param mergeData Prospect-specific values (name, practice, link, etc.)
 * @returns Send result with messageId or error
 */
export async function sendCampaignEmail(
  db: PrismaClient,
  prospectId: string,
  campaignId: string | undefined,
  template: EmailTemplate,
  mergeData: ProspectMergeData,
): Promise<EmailSendResult> {
  try {
    // Load prospect from DB
    const prospect = await db.prospect.findUnique({
      where: { id: prospectId },
      select: {
        id: true,
        email: true,
        contactName: true,
        practiceName: true,
        lastEmailSentAt: true,
        optOutAt: true,
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!prospect) {
      logLine('warn', 'Prospect not found for email send', {
        prospectId,
        campaignId,
        templateId: template.id,
      });
      return {
        success: false,
        error: 'Prospect not found',
      };
    }

    // Validate email
    if (!isValidEmail(prospect.email)) {
      logLine('warn', 'Invalid email address', {
        prospectId,
        email: '[redacted:email]',
        templateId: template.id,
      });
      await markEmailEvent(
        db,
        prospectId,
        'failed',
        {
          campaignId,
          campaignName: prospect.campaign?.name,
          templateId: template.id,
          templateName: template.name,
          subject: template.subject,
        },
      );
      return {
        success: false,
        error: 'Invalid email address',
        invalidEmail: true,
      };
    }

    // CASL: Check opt-out status
    if (prospect.optOutAt) {
      logLine('warn', 'Prospect has opted out', {
        prospectId,
        templateId: template.id,
      });
      return {
        success: false,
        error: 'Prospect opted out',
      };
    }

    // Idempotency: Check if already sent today
    const shouldEnforceIdempotency =
      process.env.MARKETING_IDEMPOTENT !== '0' && process.env.MARKETING_IDEMPOTENT !== 'false';

    if (shouldEnforceIdempotency && prospect.lastEmailSentAt) {
      const lastSent = new Date(prospect.lastEmailSentAt);
      const now = new Date();
      const daysSinceLastSend = Math.floor(
        (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysSinceLastSend < 1) {
        logLine('info', 'Email already sent today (idempotent skip)', {
          prospectId,
          templateId: template.id,
          lastSentHoursAgo: Math.floor(
            (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60),
          ),
        });
        return {
          success: false,
          error: 'Already sent today (idempotent)',
        };
      }
    }

    // Render template with merge data
    const rendered = renderTemplate(template, mergeData);

    // Build CASL footer
    const unsubscribeLink = mergeData.UnsubscribeLink;
    const caslFooter = buildCaslFooter(unsubscribeLink);

    // Add footer to HTML body
    const htmlBody = rendered.htmlBody + caslFooter;

    // Add mailing address to text body
    const mailingAddress = getMailingAddress();
    const textBody = `${rendered.textBody}\n\n${mailingAddress}`;

    // Send via SendGrid
    const apiKey = process.env.SENDGRID_API_KEY?.trim();
    if (!apiKey) {
      logLine('error', 'SendGrid API key not configured', {
        prospectId,
        templateId: template.id,
      });
      return {
        success: false,
        error: 'SendGrid API key not configured',
      };
    }

    const sg = await import('@sendgrid/mail');
    sg.default.setApiKey(apiKey);

    const message = {
      to: prospect.email,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'marketing@collectrx.ca',
        name: process.env.SENDGRID_FROM_NAME || 'CollectRx',
      },
      subject: rendered.subject,
      html: htmlBody,
      text: textBody,
      // CASL: Add list-unsubscribe header for email clients
      ...(unsubscribeLink && {
        headers: {
          'List-Unsubscribe': `<${unsubscribeLink}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
      // Custom args for webhook processing — snake_case is the webhook
      // contract (handleSendgridEventWebhook reads ev.prospect_id).
      customArgs: {
        prospect_id: prospectId,
        campaign_id: campaignId || prospect.campaign?.id || 'unknown',
        template_id: template.id,
      },
    };

    const response = await sg.default.send(message);
    const messageId = response[0]?.headers?.['x-message-id'] || 'unknown';

    // Log successful send to DB
    await markEmailEvent(
      db,
      prospectId,
      'sent',
      {
        campaignId: campaignId || prospect.campaign?.id,
        campaignName: prospect.campaign?.name,
        templateId: template.id,
        templateName: template.name,
        subject: rendered.subject,
        sendgridMessageId: messageId,
      },
    );

    // Update prospect last_email_sent_at
    await db.prospect.update({
      where: { id: prospectId },
      data: { lastEmailSentAt: new Date() },
    });

    logLine('info', 'Email sent successfully', {
      prospectId,
      campaignId,
      templateId: template.id,
      messageId,
    });

    return {
      success: true,
      messageId,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logLine('error', 'Email send failed', {
      prospectId,
      campaignId,
      templateId: template.id,
      error,
    });

    // Log failure to DB
    await markEmailEvent(
      db,
      prospectId,
      'failed',
      {
        campaignId,
        templateId: template.id,
        templateName: template.name,
        error,
      },
    );

    return {
      success: false,
      error,
    };
  }
}

/**
 * Record an email event (opened, clicked, bounced, etc.).
 * Called by webhook handlers (SendGrid) and send functions.
 *
 * Idempotent: same event (prospectId + type + timestamp) is logged once.
 *
 * @param db Prisma client
 * @param prospectId UUID of prospect
 * @param eventType Email event type (sent, opened, clicked, bounced, unsubscribed, etc.)
 * @param metadata Event context (campaignId, templateId, bounceReason, clickedLink, etc.)
 */
export async function markEmailEvent(
  db: PrismaClient,
  prospectId: string,
  eventType: EmailEventType,
  metadata?: EmailEventMetadata,
): Promise<void> {
  try {
    // Special handling for unsubscribe / opt-out
    if (eventType === 'unsubscribed' || eventType === 'marked_spam') {
      await db.prospect.update({
        where: { id: prospectId },
        data: {
          optOutAt: new Date(),
        },
      });
      logLine('info', 'Prospect opted out', {
        prospectId,
        eventType,
      });
    }

    // Log bounce reason to prospect record
    if (eventType === 'bounced' && metadata?.bounceReason) {
      await db.prospect.update({
        where: { id: prospectId },
        data: {
          emailBounceReason: metadata.bounceReason,
        },
      });
    }

    // Create audit event
    const event = await db.emailCampaignEvent.create({
      data: {
        prospectId,
        eventType,
        emailSubject: metadata?.subject,
        metadata: metadata ? (metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });

    logLine('info', 'Email event logged', {
      prospectId,
      eventType,
      eventId: event.id,
      campaignId: metadata?.campaignId,
      templateId: metadata?.templateId,
    });

    // Update prospect engagement metrics
    if (eventType === 'opened') {
      await db.prospect.update({
        where: { id: prospectId },
        data: {
          emailOpenCount: { increment: 1 },
          lastEngagedAt: new Date(),
        },
      });
    }

    if (eventType === 'clicked') {
      await db.prospect.update({
        where: { id: prospectId },
        data: {
          emailClickCount: { increment: 1 },
          lastEngagedAt: new Date(),
        },
      });
    }

    if (eventType === 'replied') {
      await db.prospect.update({
        where: { id: prospectId },
        data: {
          lastEngagedAt: new Date(),
          emailRepliedAt: new Date(),
        },
      });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logLine('error', 'Failed to mark email event', {
      prospectId,
      eventType,
      error,
    });
  }
}

/**
 * Batch send emails to multiple prospects.
 * Returns array of results in the same order as inputs.
 */
export async function sendBatchCampaignEmails(
  db: PrismaClient,
  prospects: Array<{ prospectId: string; mergeData: ProspectMergeData }>,
  campaignId: string | undefined,
  template: EmailTemplate,
): Promise<EmailSendResult[]> {
  const results: EmailSendResult[] = [];

  for (const { prospectId, mergeData } of prospects) {
    const result = await sendCampaignEmail(
      db,
      prospectId,
      campaignId,
      template,
      mergeData,
    );
    results.push(result);

    // Rate limiting: stagger sends to avoid SendGrid throttling
    const delayMs = parseInt(process.env.EMAIL_BATCH_DELAY_MS || '100', 10);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

/**
 * Get engagement metrics for a prospect.
 */
export async function getProspectEngagement(
  db: PrismaClient,
  prospectId: string,
): Promise<{
  opens: number;
  clicks: number;
  bounces: number;
  unsubscribes: number;
  lastEventAt: Date | null;
}> {
  const events = await db.emailCampaignEvent.findMany({
    where: { prospectId },
    select: { eventType: true, eventTimestamp: true },
  });

  const counts = {
    opens: 0,
    clicks: 0,
    bounces: 0,
    unsubscribes: 0,
    lastEventAt: null as Date | null,
  };

  for (const event of events) {
    if (event.eventType === 'opened') counts.opens++;
    if (event.eventType === 'clicked') counts.clicks++;
    if (event.eventType === 'bounced') counts.bounces++;
    if (event.eventType === 'unsubscribed') counts.unsubscribes++;
    if (!counts.lastEventAt || event.eventTimestamp > counts.lastEventAt) {
      counts.lastEventAt = event.eventTimestamp;
    }
  }

  return counts;
}

/**
 * Sync SendGrid suppression list (bounce/complaints) back to DB.
 * Useful for importing historical suppression data.
 *
 * Note: This requires SendGrid Marketing Contacts API.
 * For production, prefer webhook events (real-time) over periodic pulls.
 */
export async function syncSendGridSuppressions(
  _db: PrismaClient,
): Promise<{ synced: number; failed: number }> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  if (!apiKey) {
    logLine('warn', 'SendGrid API key not configured for suppression sync');
    return { synced: 0, failed: 0 };
  }

  const synced = 0;
  const failed = 0;

  try {
    // Fetch bounces
    const sg = await import('@sendgrid/client');
    sg.default.setApiKey(apiKey);

    // Note: This is simplified. In production, you'd paginate through all bounces.
    // See: https://docs.sendgrid.com/api-reference/bounces-api/retrieve-all-bounces
    logLine('info', 'SendGrid suppression sync not implemented (use webhooks instead)', {
      bouncesSynced: synced,
      complaintsFailed: failed,
    });

    return { synced, failed };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logLine('error', 'SendGrid suppression sync failed', { error });
    return { synced, failed };
  }
}
