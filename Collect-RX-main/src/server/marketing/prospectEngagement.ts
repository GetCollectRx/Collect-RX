import type { PrismaClient, Prospect } from '@prisma/client';
import { sendHotLeadAlert } from './hotLeadAlerts.js';
import { logProspectActivity } from './prospectActivity.js';
import { advanceProspectStage } from './sequenceEngine.js';

type SgEngagementEvent = {
  event?: string;
  email?: string;
  prospect_id?: string;
  url?: string;
};

export async function handleProspectSendGridEvent(
  prisma: PrismaClient,
  ev: SgEngagementEvent,
): Promise<void> {
  const prospectId = ev.prospect_id;
  if (!prospectId) return;

  const prospect = await prisma.prospect.findUnique({ where: { id: prospectId } });
  if (!prospect || prospect.optOutAt) return;

  const event = ev.event?.toLowerCase();

  if (event === 'open') {
    const openCount = prospect.emailOpenCount + 1;
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: {
        emailOpenCount: openCount,
        lastEngagedAt: new Date(),
      },
    });
    await logProspectActivity(prisma, prospect.id, 'email_open', `Open #${openCount}`);

    if (prospect.stage === 'new' || prospect.stage === 'contacted') {
      await advanceProspectStage(prisma, prospect.id, 'engaged');
    }

    if (openCount >= 3) {
      const updated = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
      await sendHotLeadAlert(updated, 'email_open_3', `Opened ${openCount} emails`);
    }
    return;
  }

  if (event === 'click') {
    const clickCount = prospect.emailClickCount + 1;
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: {
        emailClickCount: clickCount,
        lastEngagedAt: new Date(),
      },
    });
    await logProspectActivity(prisma, prospect.id, 'email_click', ev.url || 'Link clicked');

    const updated = await advanceProspectStage(prisma, prospect.id, 'engaged');
    await sendHotLeadAlert(updated, 'email_click', ev.url || 'Clicked marketing link');

    if (/demo|book|early-access|calendly/i.test(ev.url || '')) {
      await advanceProspectStage(prisma, prospect.id, 'demo_booked');
      const booked = await prisma.prospect.findUniqueOrThrow({ where: { id: prospect.id } });
      await sendHotLeadAlert(booked, 'demo_booked', 'Demo link clicked');
    }
    return;
  }

  if (event === 'bounce' || event === 'dropped') {
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: { score: Math.max(0, prospect.score - 15) },
    });
    await logProspectActivity(prisma, prospect.id, 'email_bounce', event);
    return;
  }

  if (event === 'spamreport' || event === 'unsubscribe') {
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: {
        optOutAt: new Date(),
        stage: 'opted_out',
        sequenceCompleted: true,
      },
    });
    await logProspectActivity(prisma, prospect.id, 'email_opt_out', event);
  }
}

export async function findProspectByEmail(
  prisma: PrismaClient,
  email: string,
): Promise<Prospect | null> {
  const normalized = email.toLowerCase().trim();
  return prisma.prospect.findFirst({
    where: { email: { equals: normalized, mode: 'insensitive' } },
    orderBy: { updatedAt: 'desc' },
  });
}

/** Resolve prospect from inbound reply headers or body. */
export function extractProspectIdFromHeaders(headers: Record<string, string>): string | null {
  const direct = headers['x-prospect-id'] || headers['X-Prospect-Id'];
  if (direct?.trim()) return direct.trim();
  return null;
}
