import type { PrismaClient } from '@prisma/client';
import { advanceProspectStage } from './sequenceEngine.js';
import { logProspectActivity } from './prospectActivity.js';
import { sendHotLeadAlert } from './hotLeadAlerts.js';
import { sendProspectEmail } from './prospectEmail.js';
import { buildPreDemoEmail } from './emailTemplates.js';
import { syncProspectStageToHubspot } from './hubspotSync.js';
import { logger } from '../observability/logger.js';

export interface DemoBookingInput {
  prospectId?: string;
  email?: string;
  scheduledAt: Date;
  source: string;
  externalId?: string;
}

export async function recordDemoBooking(
  prisma: PrismaClient,
  input: DemoBookingInput,
): Promise<{ prospectId: string }> {
  let prospect =
    input.prospectId
      ? await prisma.prospect.findUnique({ where: { id: input.prospectId } })
      : null;

  if (!prospect && input.email?.trim()) {
    prospect = await prisma.prospect.findFirst({
      where: { email: { equals: input.email.trim(), mode: 'insensitive' } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  if (!prospect) {
    throw new Error('No matching prospect for demo booking');
  }

  await prisma.prospect.update({
    where: { id: prospect.id },
    data: {
      demoScheduledAt: input.scheduledAt,
      preDemoEmailSentAt: null,
    },
  });

  await advanceProspectStage(prisma, prospect.id, 'demo_booked');
  await sendHotLeadAlert(prospect, 'demo_booked');
  await logProspectActivity(
    prisma,
    prospect.id,
    'demo_booked',
    `Demo scheduled ${input.scheduledAt.toISOString()} via ${input.source}`,
    { source: input.source, externalId: input.externalId ?? null },
  );

  void syncProspectStageToHubspot(prisma, prospect.id, 'demo_booked').catch((err) => {
    logger.warn('[hubspot] demo_booked sync failed', { error: err });
  });

  return { prospectId: prospect.id };
}

export async function runPreDemoEmailTick(prisma: PrismaClient): Promise<number> {
  const now = Date.now();
  const windowStart = new Date(now + 23 * 60 * 60 * 1000);
  const windowEnd = new Date(now + 25 * 60 * 60 * 1000);

  const due = await prisma.prospect.findMany({
    where: {
      optOutAt: null,
      preDemoEmailSentAt: null,
      demoScheduledAt: { gte: windowStart, lte: windowEnd },
      email: { not: null },
      stage: 'demo_booked',
    },
    take: 20,
  });

  let sent = 0;
  for (const prospect of due) {
    const { subject, html, text } = buildPreDemoEmail(prospect);
    const ok = await sendProspectEmail(
      prospect,
      { subject, html, text, activityType: 'pre_demo_email' },
      prisma,
    );

    if (ok || !process.env.SENDGRID_API_KEY) {
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: { preDemoEmailSentAt: new Date() },
      });
      sent++;
    }
  }

  return sent;
}
