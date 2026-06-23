import type { PrismaClient, Prospect } from '@prisma/client';
import { referralEmailHtml } from './emailTemplates.js';
import { logProspectActivity } from './prospectActivity.js';
import { sendProspectEmail } from './prospectEmail.js';

const REFERRAL_STEPS = [
  { dayOffset: 14, subject: 'Quick favour, know another office?', step: 1 },
  { dayOffset: 30, subject: 'One last ask on referrals', step: 2 },
] as const;

export async function maybeStartReferralSequence(
  prisma: PrismaClient,
  prospect: Prospect,
): Promise<void> {
  if (prospect.stage !== 'closed_won' || prospect.referralCompleted || !prospect.closedWonAt) {
    return;
  }
  if (prospect.referralStep > 0) return;

  await prisma.prospect.update({
    where: { id: prospect.id },
    data: { referralStep: 0 },
  });

  await logProspectActivity(
    prisma,
    prospect.id,
    'referral_sequence_started',
    'Referral ask sequence scheduled (day 14 and 30)',
  );
}

export async function runReferralSequenceTick(prisma: PrismaClient): Promise<number> {
  const prospects = await prisma.prospect.findMany({
    where: {
      stage: 'closed_won',
      referralCompleted: false,
      optOutAt: null,
      closedWonAt: { not: null },
      email: { not: null },
    },
  });

  let sent = 0;
  const now = Date.now();

  for (const p of prospects) {
    if (!p.closedWonAt || !p.email) continue;
    const daysSinceWon = (now - p.closedWonAt.getTime()) / (24 * 60 * 60 * 1000);

    for (const stepDef of REFERRAL_STEPS) {
      if (p.referralStep >= stepDef.step) continue;
      if (daysSinceWon < stepDef.dayOffset) continue;

      const copy = referralEmailHtml(p.practiceName, stepDef.step as 1 | 2);

      await sendProspectEmail(
        p,
        {
          subject: copy.subject,
          html: copy.html,
          text: copy.text,
          activityType: `referral_email_${stepDef.step}`,
        },
        prisma,
      );

      const done = stepDef.step >= REFERRAL_STEPS.length;
      await prisma.prospect.update({
        where: { id: p.id },
        data: {
          referralStep: stepDef.step,
          referralCompleted: done,
        },
      });
      sent++;
      break;
    }
  }

  return sent;
}
