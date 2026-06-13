import type { PrismaClient, Prospect, ProspectStage } from '@prisma/client';
import { COLD_SEQUENCE, interpolateSubject } from './emailTemplates.js';
import { sendProspectEmail } from './prospectEmail.js';
import { logProspectActivity } from './prospectActivity.js';
import { runReferralSequenceTick } from './referralEngine.js';

const STAGE_ORDER: ProspectStage[] = [
  'new',
  'contacted',
  'engaged',
  'qualified',
  'demo_booked',
  'closed_won',
  'closed_lost',
  'opted_out',
];

function stageIndex(s: ProspectStage): number {
  return STAGE_ORDER.indexOf(s);
}

export async function advanceProspectStage(
  prisma: PrismaClient,
  prospectId: string,
  target: ProspectStage,
): Promise<Prospect> {
  const current = await prisma.prospect.findUniqueOrThrow({ where: { id: prospectId } });
  if (stageIndex(target) <= stageIndex(current.stage) && target !== 'opted_out') {
    return current;
  }
  return prisma.prospect.update({
    where: { id: prospectId },
    data: {
      stage: target,
      lastEngagedAt: new Date(),
      ...(target === 'closed_won' ? { closedWonAt: new Date(), sequenceCompleted: true } : {}),
    },
  });
}

export async function runMarketingSequenceTick(prisma: PrismaClient): Promise<{
  coldEmailsSent: number;
  referralEmailsSent: number;
}> {
  const now = new Date();
  let coldEmailsSent = 0;

  const candidates = await prisma.prospect.findMany({
    where: {
      optOutAt: null,
      sequenceCompleted: false,
      email: { not: null },
      stage: { in: ['new', 'contacted', 'engaged'] },
      OR: [{ sequencePausedUntil: null }, { sequencePausedUntil: { lte: now } }],
    },
    take: 50,
    orderBy: { score: 'desc' },
  });

  for (const prospect of candidates) {
    const nextStepIndex = prospect.sequenceStep;
    if (nextStepIndex >= COLD_SEQUENCE.length) {
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: { sequenceCompleted: true },
      });
      continue;
    }

    const stepDef = COLD_SEQUENCE[nextStepIndex]!;
    if (prospect.lastEmailSentAt) {
      const minNext = new Date(
        prospect.lastEmailSentAt.getTime() + stepDef.daysAfterPrevious * 24 * 60 * 60 * 1000,
      );
      if (now < minNext) continue;
    } else if (nextStepIndex > 0) {
      continue;
    }

    const html = stepDef.buildHtml(prospect);
    const subject = interpolateSubject(stepDef.subject, prospect);
    const sent = await sendProspectEmail(
      prospect,
      {
        subject,
        html,
        text: stepDef.buildText(prospect),
        activityType: `sequence_email_step_${stepDef.step}`,
      },
      prisma,
    );

    if (!sent && !process.env.SENDGRID_API_KEY) {
      // Dev mode: still advance sequence for testing
      await logProspectActivity(prisma, prospect.id, stepDef.step === 1 ? 'sequence_dev_skip' : 'sequence_email', subject);
    }

    if (sent || !process.env.SENDGRID_API_KEY) {
      await prisma.prospect.update({
        where: { id: prospect.id },
        data: {
          sequenceStep: nextStepIndex + 1,
          lastEmailSentAt: now,
          stage: prospect.stage === 'new' ? 'contacted' : prospect.stage,
          sequenceCompleted: nextStepIndex + 1 >= COLD_SEQUENCE.length,
        },
      });
      coldEmailsSent++;
    }
  }

  const referralEmailsSent = await runReferralSequenceTick(prisma);
  return { coldEmailsSent, referralEmailsSent };
}
