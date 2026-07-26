import type { PrismaClient, Prospect } from '@prisma/client';
import {
  buildPostDemoFollowUp,
  type PostDemoOutcome,
} from './emailTemplates.js';
import { logProspectActivity } from './prospectActivity.js';
import { sendProspectEmail } from './prospectEmail.js';
import { advanceProspectStage } from './sequenceEngine.js';

export interface PostDemoFollowUpInput {
  outcome: PostDemoOutcome;
  concern?: string;
  concernResponse?: string;
  agreementSendDay?: string;
  /** When false, only save draft to suggestedReply (thinking without concern). Default true. */
  send?: boolean;
}

type ProspectMeta = {
  postDemoFollowUpSentAt?: string;
  demoOutcome?: PostDemoOutcome;
  lastInboundReply?: string;
  [key: string]: unknown;
};

function readMeta(prospect: Prospect): ProspectMeta {
  if (!prospect.metadata || typeof prospect.metadata !== 'object' || Array.isArray(prospect.metadata)) {
    return {};
  }
  return prospect.metadata as ProspectMeta;
}

export async function sendPostDemoFollowUp(
  prisma: PrismaClient,
  prospectId: string,
  input: PostDemoFollowUpInput,
): Promise<{ sent: boolean; draftOnly: boolean; prospect: Prospect }> {
  const prospect = await prisma.prospect.findUniqueOrThrow({ where: { id: prospectId } });
  if (!prospect.email || prospect.optOutAt) {
    throw new Error('Prospect has no email or has opted out');
  }

  const meta = readMeta(prospect);
  if (meta.postDemoFollowUpSentAt) {
    throw new Error('Post-demo follow-up already sent for this prospect');
  }

  const thinkingNeedsInput =
    input.outcome === 'thinking' && !input.concern?.trim() && input.send !== true;
  const shouldSend = input.send !== false && !thinkingNeedsInput;

  const email = buildPostDemoFollowUp(prospect, input.outcome, {
    agreementSendDay: input.agreementSendDay,
    concern: input.concern,
    concernResponse: input.concernResponse,
  });

  if (!shouldSend) {
    const updated = await prisma.prospect.update({
      where: { id: prospectId },
      data: {
        suggestedReply: email.text,
        metadata: {
          ...meta,
          demoOutcome: input.outcome,
          postDemoDraftSubject: email.subject,
        },
      },
    });
    await logProspectActivity(
      prisma,
      prospectId,
      'post_demo_draft',
      `Post-demo draft (${input.outcome}) saved for review`,
      { outcome: input.outcome },
    );
    return { sent: false, draftOnly: true, prospect: updated };
  }

  const sent = await sendProspectEmail(
    prospect,
    {
      subject: email.subject,
      html: email.html,
      text: email.text,
      activityType: `post_demo_${input.outcome}`,
    },
    prisma,
  );

  if (!sent && process.env.SENDGRID_API_KEY) {
    throw new Error('Failed to send post-demo follow-up email');
  }

  const nowIso = new Date().toISOString();
  let updated = await prisma.prospect.update({
    where: { id: prospectId },
    data: {
      suggestedReply: null,
      metadata: {
        ...meta,
        demoOutcome: input.outcome,
        postDemoFollowUpSentAt: nowIso,
      },
    },
  });

  if (input.outcome === 'interested') {
    updated = await advanceProspectStage(prisma, prospectId, 'qualified');
  } else if (input.outcome === 'not_fit') {
    updated = await advanceProspectStage(prisma, prospectId, 'closed_lost');
  }

  await logProspectActivity(
    prisma,
    prospectId,
    'post_demo_follow_up',
    `Post-demo email sent (${input.outcome}): ${email.subject}`,
    { outcome: input.outcome, sent: sent || !process.env.SENDGRID_API_KEY },
  );

  return { sent: sent || !process.env.SENDGRID_API_KEY, draftOnly: false, prospect: updated };
}

/** After scheduled demo time, remind admin to record outcome (once). */
export async function runPostDemoReminderTick(prisma: PrismaClient): Promise<number> {
  const now = Date.now();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);

  const due = await prisma.prospect.findMany({
    where: {
      optOutAt: null,
      stage: 'demo_booked',
      demoScheduledAt: { lte: twoHoursAgo },
      email: { not: null },
    },
    take: 20,
  });

  let reminded = 0;
  for (const prospect of due) {
    const meta = readMeta(prospect);
    if (meta.postDemoFollowUpSentAt || meta.postDemoReminderSentAt) continue;

    await logProspectActivity(
      prisma,
      prospect.id,
      'post_demo_reminder',
      'Demo time passed — record outcome and send post-demo follow-up',
    );
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: {
        metadata: { ...meta, postDemoReminderSentAt: new Date().toISOString() },
      },
    });
    reminded++;
  }

  return reminded;
}
