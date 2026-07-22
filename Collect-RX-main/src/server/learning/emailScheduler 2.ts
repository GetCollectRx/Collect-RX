import { type PrismaClient } from '@prisma/client';
import { wrapOutreachEmail } from '../marketing/emailLayout.js';

interface EmailSchedulerConfig {
  batchSize: number;
  rateLimitPerMinute: number;
  followUpDelayDays: number;
  enableLogging: boolean;
}

interface SendResult {
  prospectId: string;
  email: string;
  type: 'initial' | 'followup';
  success: boolean;
  error?: string;
  messageId?: string;
}

interface SchedulerSummary {
  totalProcessed: number;
  initialEmailsSent: number;
  followUpEmailsSent: number;
  failed: number;
  skipped: number;
  results: SendResult[];
}

/**
 * Get email scheduler configuration from environment variables.
 */
function getEmailSchedulerConfig(): EmailSchedulerConfig {
  return {
    batchSize: parseInt(process.env.EMAIL_SCHEDULER_BATCH_SIZE ?? '10', 10),
    rateLimitPerMinute: parseInt(process.env.EMAIL_SCHEDULER_RATE_LIMIT ?? '30', 10),
    followUpDelayDays: parseInt(process.env.EMAIL_SCHEDULER_FOLLOWUP_DELAY_DAYS ?? '5', 10),
    enableLogging: process.env.EMAIL_SCHEDULER_LOGGING !== 'false',
  };
}

/**
 * Check if email provider (SendGrid) is configured.
 */
function isEmailProviderConfigured(): boolean {
  return !!process.env.SENDGRID_API_KEY?.trim();
}

/**
 * Send email via SendGrid.
 */
async function sendEmailViaSendGrid(
  to: string,
  subject: string,
  htmlContent: string,
  metadata?: Record<string, string>,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'outreach@collectrx.ca';

  if (!apiKey) {
    return { success: false, error: 'SendGrid API key not configured' };
  }

  try {
    const sg = await import('@sendgrid/mail');
    sg.default.setApiKey(apiKey);

    const message = {
      to,
      from: {
        email: fromEmail,
        name: 'CollectRx Growth',
      },
      // Replies must land on the inbound-parse domain or the reply pipeline
      // (unsubscribe handling, emailRepliedAt) never sees them.
      replyTo: process.env.SENDGRID_REPLY_TO || 'reply@inbound.collectrx.ca',
      subject,
      html: htmlContent,
      customArgs: metadata,
      trackingSettings: {
        clickTracking: { enable: true },
        openTracking: { enable: true },
      },
    };

    const response = await sg.default.send(message);
    const messageId = response[0]?.headers?.['x-message-id'];
    return { success: true, messageId };
  } catch (err) {
    const errorMsg = (err as Error).message;
    return { success: false, error: errorMsg };
  }
}

/**
 * Generate initial outreach email HTML.
 */
export function generateInitialEmailHtml(prospectName: string): string {
  return wrapOutreachEmail({
    preheader: 'Automated insurance follow-up for dental practices',
    bodyHtml: `
      <p>Hi ${prospectName},</p>
      <p>I wanted to reach out about CollectRx — a platform that automates insurance follow-up for dental practices.</p>
      <p>Most practices spend 5-10 hours per week chasing down claim statuses and missing payments. CollectRx handles this with AI voice agents that call carriers, check claims, and resolve them automatically — often collecting claims within 24 hours.</p>
      <p>If you're interested in learning how practices like yours are reducing admin overhead, I'd be happy to show you a quick demo.</p>
      <p>Best regards,<br>CollectRx Growth Team</p>
    `,
  });
}

/**
 * Generate follow-up email HTML.
 */
export function generateFollowUpEmailHtml(prospectName: string): string {
  return wrapOutreachEmail({
    preheader: 'Quick follow-up on automating your insurance follow-up',
    bodyHtml: `
      <p>Hi ${prospectName},</p>
      <p>Checking in — wanted to see if you had any questions about CollectRx or if now is a better time to chat.</p>
      <p>Many dental practices have mentioned they're looking for ways to reduce the 5+ hours per week spent on insurance follow-up. If that resonates, I'd love to show you a 15-minute demo of how this works.</p>
      <p>Feel free to reply to this email or let me know what works best for your schedule.</p>
      <p>Best regards,<br>CollectRx Growth Team</p>
    `,
  });
}

/**
 * Select prospects due for initial email send.
 */
async function selectProspectsDueForInitialEmail(
  prisma: PrismaClient,
  limit: number,
): Promise<Array<{ id: string; email: string; practiceName: string }>> {
  const rows = await prisma.prospect.findMany({
    where: {
      email: { not: null },
      emailSequenceStep: 0,
      optOutAt: null,
      dnclListed: false,
      stage: { in: ['new', 'engaged'] },
    },
    select: { id: true, email: true, practiceName: true },
    take: limit,
    orderBy: { createdAt: 'asc' },
  });
  // Prisma does not narrow nullable columns from the where clause.
  return rows.filter((r): r is typeof r & { email: string } => r.email !== null);
}

/**
 * Select prospects due for follow-up email.
 */
async function selectProspectsDueForFollowUp(
  prisma: PrismaClient,
  followUpDelayDays: number,
  limit: number,
): Promise<Array<{ id: string; email: string; practiceName: string; initialEmailSentAt: Date }>> {
  const followUpThreshold = new Date(Date.now() - followUpDelayDays * 24 * 60 * 60 * 1000);

  const rows = await prisma.prospect.findMany({
    where: {
      email: { not: null },
      emailSequenceStep: 1,
      initialEmailSentAt: { not: null, lte: followUpThreshold },
      emailRepliedAt: null,
      optOutAt: null,
      dnclListed: false,
      stage: { in: ['new', 'engaged'] },
    },
    select: { id: true, email: true, practiceName: true, initialEmailSentAt: true },
    take: limit,
    orderBy: { initialEmailSentAt: 'asc' },
  });
  // Prisma does not narrow nullable columns from the where clause.
  return rows.filter(
    (r): r is typeof r & { email: string; initialEmailSentAt: Date } =>
      r.email !== null && r.initialEmailSentAt !== null,
  );
}

/**
 * Log email send attempt to ProspectActivity table.
 */
async function logEmailSendActivity(
  prisma: PrismaClient,
  prospectId: string,
  type: 'initial' | 'followup',
  success: boolean,
  error?: string,
  messageId?: string,
): Promise<void> {
  await prisma.prospectActivity.create({
    data: {
      prospectId,
      type: success ? `email_${type}_sent` : `email_${type}_failed`,
      summary: success
        ? `${type === 'initial' ? 'Initial' : 'Follow-up'} email sent successfully`
        : `${type === 'initial' ? 'Initial' : 'Follow-up'} email send failed: ${error}`,
      metadata: {
        messageId,
        error,
        timestamp: new Date().toISOString(),
      },
    },
  });
}

/**
 * Process batch of initial emails.
 */
async function processBatchInitialEmails(
  prisma: PrismaClient,
  prospects: Array<{ id: string; email: string; practiceName: string }>,
): Promise<SendResult[]> {
  const results: SendResult[] = [];

  for (const prospect of prospects) {
    const htmlContent = generateInitialEmailHtml(prospect.practiceName);
    const subject = `Automate Your Dental Insurance Follow-Up — CollectRx`;

    const sendResult = await sendEmailViaSendGrid(
      prospect.email,
      subject,
      htmlContent,
      { prospect_id: prospect.id, type: 'initial' },
    );

    const result: SendResult = {
      prospectId: prospect.id,
      email: prospect.email,
      type: 'initial',
      success: sendResult.success,
      error: sendResult.error,
      messageId: sendResult.messageId,
    };

    results.push(result);

    if (sendResult.success) {
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: {
          emailSequenceStep: 1,
          initialEmailSentAt: new Date(),
          lastEmailSentAt: new Date(),
        },
      });
    }

    await logEmailSendActivity(
      prisma,
      prospect.id,
      'initial',
      sendResult.success,
      sendResult.error,
      sendResult.messageId,
    );
  }

  return results;
}

/**
 * Process batch of follow-up emails.
 */
async function processBatchFollowUpEmails(
  prisma: PrismaClient,
  prospects: Array<{ id: string; email: string; practiceName: string; initialEmailSentAt: Date }>,
): Promise<SendResult[]> {
  const results: SendResult[] = [];

  for (const prospect of prospects) {
    const htmlContent = generateFollowUpEmailHtml(prospect.practiceName);
    const subject = `Quick follow-up: CollectRx demo for your practice`;

    const sendResult = await sendEmailViaSendGrid(
      prospect.email,
      subject,
      htmlContent,
      { prospect_id: prospect.id, type: 'followup' },
    );

    const result: SendResult = {
      prospectId: prospect.id,
      email: prospect.email,
      type: 'followup',
      success: sendResult.success,
      error: sendResult.error,
      messageId: sendResult.messageId,
    };

    results.push(result);

    if (sendResult.success) {
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: {
          emailSequenceStep: 2,
          followUpEmailSentAt: new Date(),
          lastEmailSentAt: new Date(),
        },
      });
    }

    await logEmailSendActivity(
      prisma,
      prospect.id,
      'followup',
      sendResult.success,
      sendResult.error,
      sendResult.messageId,
    );
  }

  return results;
}

/**
 * Main scheduler function — runs every 5 minutes via learning cycle.
 */
export async function runEmailScheduler(prisma: PrismaClient): Promise<SchedulerSummary> {
  const config = getEmailSchedulerConfig();

  if (!isEmailProviderConfigured()) {
    console.warn('[emailScheduler] SendGrid not configured — skipping email sends');
    return {
      totalProcessed: 0,
      initialEmailsSent: 0,
      followUpEmailsSent: 0,
      failed: 0,
      skipped: 1,
      results: [],
    };
  }

  const summary: SchedulerSummary = {
    totalProcessed: 0,
    initialEmailsSent: 0,
    followUpEmailsSent: 0,
    failed: 0,
    skipped: 0,
    results: [],
  };

  try {
    if (config.enableLogging) {
      console.log('[emailScheduler] Starting email scheduler run', {
        batchSize: config.batchSize,
        rateLimitPerMinute: config.rateLimitPerMinute,
        followUpDelayDays: config.followUpDelayDays,
      });
    }

    const initialProspects = await selectProspectsDueForInitialEmail(
      prisma,
      Math.floor(config.batchSize * 0.6),
    );

    const followUpProspects = await selectProspectsDueForFollowUp(
      prisma,
      config.followUpDelayDays,
      Math.floor(config.batchSize * 0.4),
    );

    const initialResults = await processBatchInitialEmails(prisma, initialProspects);
    const followUpResults = await processBatchFollowUpEmails(prisma, followUpProspects);

    summary.results = [...initialResults, ...followUpResults];
    summary.totalProcessed = summary.results.length;
    summary.initialEmailsSent = initialResults.filter((r) => r.success).length;
    summary.followUpEmailsSent = followUpResults.filter((r) => r.success).length;
    summary.failed = summary.results.filter((r) => !r.success).length;

    if (config.enableLogging) {
      console.log('[emailScheduler] Scheduler run complete', {
        totalProcessed: summary.totalProcessed,
        initialSent: summary.initialEmailsSent,
        followUpSent: summary.followUpEmailsSent,
        failed: summary.failed,
      });

      if (summary.failed > 0) {
        const failedResults = summary.results.filter((r) => !r.success);
        console.warn('[emailScheduler] Failed sends:', failedResults);
      }
    }

    return summary;
  } catch (err) {
    const errorMsg = (err as Error).message;
    console.error('[emailScheduler] Scheduler error:', errorMsg);
    throw err;
  }
}

export type { EmailSchedulerConfig, SendResult, SchedulerSummary };
