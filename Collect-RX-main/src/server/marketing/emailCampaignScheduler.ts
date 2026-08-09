import type { Prospect, PrismaClient } from '@prisma/client';
import cron from 'node-cron';
import { sendProspectEmail } from './prospectEmail.js';
import { renderEmailTemplate, type EmailTemplateData } from './emailCampaignTemplates.js';

const MAX_EMAILS_PER_BATCH = 10; // Rate limit: max 10 emails per scheduler run

export interface CampaignSchedulerResult {
  sent: number;
  scheduled: number;
  errors: Array<{ prospectId: string; error: string }>;
  /** Set when the cycle refused to send at all because sender identity was unconfigured. */
  configError?: string;
}

/**
 * CASL s.6(2) requires every commercial electronic message to carry the sender's real
 * mailing address and a working contact. A default would put a fabricated address in front
 * of recipients and regulators, which is worse than not sending — so the campaign refuses
 * to run until both are configured.
 */
function requireSenderIdentity(): { mailingAddress: string; senderPhone: string } {
  const mailingAddress = process.env.MAILING_ADDRESS?.trim();
  const senderPhone = process.env.SENDER_PHONE?.trim();

  if (!mailingAddress || !senderPhone) {
    const missing = [
      mailingAddress ? null : 'MAILING_ADDRESS',
      senderPhone ? null : 'SENDER_PHONE',
    ].filter((name): name is string => name !== null);

    throw new Error(
      `${missing.join(' and ')} is required (no default) — CASL requires a real mailing ` +
        'address and contact in every commercial email. Set it before the campaign can send.',
    );
  }

  return { mailingAddress, senderPhone };
}

async function getEmailsToSend(prisma: PrismaClient): Promise<Prospect[]> {
  // Find prospects that should receive initial emails (new prospects with email in campaigns)
  return prisma.prospect.findMany({
    where: {
      AND: [
        { email: { not: null } },
        { optOutAt: null },
        { campaign: { active: true } },
        { stage: { in: ['new', 'contacted'] } },
        // Only send to prospects we haven't emailed yet (lastEmailSentAt is null)
        // OR whose follow-up is due (lastEmailSentAt is more than 5 days ago)
        {
          OR: [
            { lastEmailSentAt: null },
            // This is a rough approximation - in production we'd use a dedicated column
            // For now, if 5+ days have passed since last email, send follow-up
          ],
        },
      ],
    },
    take: MAX_EMAILS_PER_BATCH,
    orderBy: { createdAt: 'asc' },
  });
}

function buildTemplateData(
  prospect: Prospect,
  identity: { mailingAddress: string; senderPhone: string },
): EmailTemplateData {
  const lastNameMatch = prospect.contactName?.split(' ').pop() || 'there';
  const bookingLink = process.env.DEMO_BOOKING_URL || 'https://collectrx.ca/demo';

  return {
    ownerLastName: lastNameMatch,
    practiceName: prospect.practiceName,
    city: prospect.city || '',
    bookingLink,
    senderPhone: identity.senderPhone,
    mailingAddress: identity.mailingAddress,
  };
}

export async function runEmailCampaignScheduler(prisma: PrismaClient): Promise<CampaignSchedulerResult> {
  const result: CampaignSchedulerResult = {
    sent: 0,
    scheduled: 0,
    errors: [],
  };

  // Resolved once per cycle: a misconfigured deploy logs one clear reason, not one per prospect.
  let identity: { mailingAddress: string; senderPhone: string };
  try {
    identity = requireSenderIdentity();
  } catch (err) {
    result.configError = (err as Error).message;
    return result;
  }

  const emailsToSend = await getEmailsToSend(prisma);

  for (const prospect of emailsToSend) {
    try {
      const templateData = buildTemplateData(prospect, identity);
      const isFollowUp = prospect.lastEmailSentAt != null;

      const email = isFollowUp
        ? renderEmailTemplate('follow-up', templateData)
        : renderEmailTemplate('initial', templateData);

      const sent = await sendProspectEmail(prospect, {
        subject: email.subject,
        html: email.html,
        text: email.text,
        activityType: isFollowUp ? 'email_follow_up_sent' : 'email_initial_sent',
      }, prisma);

      if (!sent) {
        result.errors.push({ prospectId: prospect.id, error: 'SendGrid send failed' });
        continue;
      }

      // Update prospect with send timestamp
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: {
          lastEmailSentAt: new Date(),
          stage: 'contacted',
          // Store metadata for campaign tracking
          metadata: {
            ...((prospect.metadata as Record<string, unknown>) || {}),
            emailCampaignLastSent: new Date().toISOString(),
            emailCampaignFollowUpNeeded: true,
          },
        },
      });

      result.sent++;
    } catch (err) {
      result.errors.push({
        prospectId: prospect.id,
        error: (err as Error).message,
      });
    }
  }

  return result;
}

// Register this function to run periodically in the learning cycle
export function registerEmailCampaignScheduler() {
  return {
    name: 'emailCampaignScheduler',
    description: 'Send scheduled cold outreach emails to prospects',
    handler: runEmailCampaignScheduler,
  };
}

// Start email campaign scheduler via cron (every 5 minutes)
export function startEmailCampaignScheduler(prisma: PrismaClient): void {

  // Run every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    runEmailCampaignScheduler(prisma)
      .then((result) => {
        if (result.configError) {
          console.error(`[emailCampaignScheduler] not sending — ${result.configError}`);
          return;
        }
        if (result.sent > 0) {
          console.log(`[emailCampaignScheduler] Sent ${result.sent} emails, scheduled ${result.scheduled} follow-ups`);
        }
        if (result.errors.length > 0) {
          console.error(`[emailCampaignScheduler] ${result.errors.length} errors:`, result.errors);
        }
      })
      .catch((err) => {
        console.error('[emailCampaignScheduler] cycle error:', (err as Error).message);
      });
  });

  console.log('[emailCampaignScheduler] Cron scheduled: every 5 minutes');
}
