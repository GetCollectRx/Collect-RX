/**
 * Trial onboarding sequence — triggered manually after a prospect signs the trial agreement.
 *
 * Steps:
 *   0  day  0  — Pre-kickoff confirmation (sent immediately on start-trial)
 *   1  day  7  — First check-in
 *   2  day 30  — Mid-trial review
 *   3  day 55  — Pre-close conversation
 *   4  day 60  — Trial end review
 *
 * Trigger: POST /api/partnerships/prospects/:id/start-trial
 * Each step sends one email to the prospect and logs a ProspectActivity.
 * The daily sequence tick fires these emails at their scheduled offset.
 */

import type { PrismaClient, Prospect } from '@prisma/client';
import { sendProspectEmail } from './prospectEmail.js';
import { logProspectActivity } from './prospectActivity.js';
import { wrapOutreachEmail } from './emailLayout.js';
import { OUTREACH_SIGNOFF, OUTREACH_SIGNOFF_HTML, outreachGreeting } from './outreachVoice.js';

interface TrialStep {
  stepIndex: number;
  dayOffset: number;
  subject: (p: Prospect) => string;
  buildHtml: (p: Prospect) => string;
  buildText: (p: Prospect) => string;
}

function signoffHtml(): string {
  return `<p style="margin:24px 0 0;color:#60605f;">${OUTREACH_SIGNOFF_HTML}</p>`;
}

function wrap(bodyHtml: string, preheader?: string): string {
  return wrapOutreachEmail({ bodyHtml, preheader });
}

const TRIAL_STEPS: TrialStep[] = [
  {
    stepIndex: 0,
    dayOffset: 0,
    subject: (p) => `CollectRx trial confirmed — ${p.practiceName}`,
    buildHtml: (p) => {
      const g = outreachGreeting(p.contactName);
      return wrap(
        `<p style="margin:0 0 16px;">${g}</p>
<p style="margin:0 0 16px;">Looking forward to getting started. Here is what to expect in the first few days.</p>
<p style="margin:0 0 16px;">I will reach out shortly to book a 30-minute kickoff call. On that call we will pick the first batch of claims to run, confirm your carrier accounts, and agree on who at the practice is the point of contact for questions.</p>
<p style="margin:0 0 16px;">You do not need to prepare anything. I will handle the setup from there.</p>
<p style="margin:0 0 16px;">If anything comes up before then, just reply to this email.</p>
${signoffHtml()}`,
        `Your CollectRx trial is confirmed for ${p.practiceName}.`,
      );
    },
    buildText: (p) => {
      const g = outreachGreeting(p.contactName);
      return `${g}

Looking forward to getting started. Here is what to expect in the first few days.

I will reach out shortly to book a 30-minute kickoff call. On that call we will pick the first batch of claims to run, confirm your carrier accounts, and agree on who at the practice is the point of contact for questions.

You do not need to prepare anything. I will handle the setup from there.

If anything comes up before then, just reply to this email.

${OUTREACH_SIGNOFF}`;
    },
  },
  {
    stepIndex: 1,
    dayOffset: 7,
    subject: (p) => `Week 1 check-in — ${p.practiceName}`,
    buildHtml: (p) => {
      const g = outreachGreeting(p.contactName);
      return wrap(
        `<p style="margin:0 0 16px;">${g}</p>
<p style="margin:0 0 16px;">One week in. I wanted to check in and make sure everything is running as expected.</p>
<p style="margin:0 0 16px;">You should have received a summary of what ran in the first queue — which claims were followed up on, what resolved, and anything that needs office action. If that summary has not arrived or anything looks off, reply and I will sort it.</p>
<p style="margin:0 0 16px;">Any questions so far?</p>
${signoffHtml()}`,
        `Week 1 check-in for ${p.practiceName}.`,
      );
    },
    buildText: (p) => {
      const g = outreachGreeting(p.contactName);
      return `${g}

One week in. I wanted to check in and make sure everything is running as expected.

You should have received a summary of what ran in the first queue — which claims were followed up on, what resolved, and anything that needs office action. If that summary has not arrived or anything looks off, reply and I will sort it.

Any questions so far?

${OUTREACH_SIGNOFF}`;
    },
  },
  {
    stepIndex: 2,
    dayOffset: 30,
    subject: (p) => `30-day check-in — ${p.practiceName}`,
    buildHtml: (p) => {
      const g = outreachGreeting(p.contactName);
      return wrap(
        `<p style="margin:0 0 16px;">${g}</p>
<p style="margin:0 0 16px;">We are at the halfway point of the trial. I would like to set up a 15-minute call this week to go over what the system has been doing and make sure it is working the way it should for your practice.</p>
<p style="margin:0 0 16px;">On the call I want to cover: what has resolved so far, anything in the queue that has not moved, and whether there are carriers or claim types where you feel like we should be doing more.</p>
<p style="margin:0 0 16px;">Does this week work? Reply with a time that suits you and I will send a calendar invite.</p>
${signoffHtml()}`,
        `30-day mid-trial check-in for ${p.practiceName}.`,
      );
    },
    buildText: (p) => {
      const g = outreachGreeting(p.contactName);
      return `${g}

We are at the halfway point of the trial. I would like to set up a 15-minute call this week to go over what the system has been doing and make sure it is working the way it should for your practice.

On the call I want to cover: what has resolved so far, anything in the queue that has not moved, and whether there are carriers or claim types where you feel like we should be doing more.

Does this week work? Reply with a time that suits you and I will send a calendar invite.

${OUTREACH_SIGNOFF}`;
    },
  },
  {
    stepIndex: 3,
    dayOffset: 55,
    subject: (p) => `Coming up on 60 days — ${p.practiceName}`,
    buildHtml: (p) => {
      const g = outreachGreeting(p.contactName);
      return wrap(
        `<p style="margin:0 0 16px;">${g}</p>
<p style="margin:0 0 16px;">The 60-day trial wraps up in about five days. I want to make sure we have time to talk before it closes.</p>
<p style="margin:0 0 16px;">I will put together a summary of what the system ran during the trial — claims worked, amounts resolved, and time your team would have spent doing this manually. That gives us something concrete to look at when we talk about what a continued arrangement looks like.</p>
<p style="margin:0 0 16px;">Can we find 15 minutes this week? Reply and I will send options.</p>
${signoffHtml()}`,
        `Trial wrapping up in 5 days — ${p.practiceName}.`,
      );
    },
    buildText: (p) => {
      const g = outreachGreeting(p.contactName);
      return `${g}

The 60-day trial wraps up in about five days. I want to make sure we have time to talk before it closes.

I will put together a summary of what the system ran during the trial — claims worked, amounts resolved, and time your team would have spent doing this manually. That gives us something concrete to look at when we talk about what a continued arrangement looks like.

Can we find 15 minutes this week? Reply and I will send options.

${OUTREACH_SIGNOFF}`;
    },
  },
  {
    stepIndex: 4,
    dayOffset: 60,
    subject: (p) => `Trial complete — ${p.practiceName}`,
    buildHtml: (p) => {
      const g = outreachGreeting(p.contactName);
      return wrap(
        `<p style="margin:0 0 16px;">${g}</p>
<p style="margin:0 0 16px;">The 60-day trial is complete. Thank you for running it.</p>
<p style="margin:0 0 16px;">I will send you a full summary of what ran: claims followed up on, amounts resolved, and any that are still in progress. If we have not already spoken about next steps, I would like to set up a brief call to walk through it together.</p>
<p style="margin:0 0 16px;">If you want to continue using CollectRx, the rate we agree on now stays locked in before we open to additional practices. If you need more time to decide, that is fine too.</p>
<p style="margin:0 0 16px;">Reply and we will set something up.</p>
${signoffHtml()}`,
        `Your CollectRx trial is complete. Here is what happened.`,
      );
    },
    buildText: (p) => {
      const g = outreachGreeting(p.contactName);
      return `${g}

The 60-day trial is complete. Thank you for running it.

I will send you a full summary of what ran: claims followed up on, amounts resolved, and any that are still in progress. If we have not already spoken about next steps, I would like to set up a brief call to walk through it together.

If you want to continue using CollectRx, the rate we agree on now stays locked in before we open to additional practices. If you need more time to decide, that is fine too.

Reply and we will set something up.

${OUTREACH_SIGNOFF}`;
    },
  },
];

/** Manually start the trial onboarding sequence for a prospect. Sends step 0 immediately. */
export async function startTrialOnboarding(
  prisma: PrismaClient,
  prospectId: string,
): Promise<void> {
  const prospect = await prisma.prospect.findUniqueOrThrow({ where: { id: prospectId } });

  if (prospect.trialStartedAt) {
    throw new Error(`Trial already started for prospect ${prospectId}`);
  }

  const now = new Date();
  await prisma.prospect.update({
    where: { id: prospectId },
    data: { trialStartedAt: now, trialSequenceStep: 0 },
  });

  // Send step 0 immediately
  const step = TRIAL_STEPS[0]!;
  await sendTrialStep(prisma, prospect, step, now);
}

async function sendTrialStep(
  prisma: PrismaClient,
  prospect: Prospect,
  step: TrialStep,
  trialStartedAt: Date,
): Promise<void> {
  const subject = step.subject(prospect);
  const sent = await sendProspectEmail(
    prospect,
    {
      subject,
      html: step.buildHtml(prospect),
      text: step.buildText(prospect),
      activityType: `trial_step_${step.stepIndex}`,
    },
    prisma,
  );

  const sentOrDev = sent || !process.env.SENDGRID_API_KEY;
  if (sentOrDev) {
    await prisma.prospect.update({
      where: { id: prospect.id },
      data: { trialSequenceStep: step.stepIndex + 1 },
    });
    await logProspectActivity(
      prisma,
      prospect.id,
      `trial_step_${step.stepIndex}`,
      subject,
      { dayOffset: step.dayOffset, trialStartedAt: trialStartedAt.toISOString() },
    );
  }
}

/**
 * Called by the daily job tick. Sends any trial onboarding emails that are due today.
 * Returns the number of emails sent.
 */
export async function runTrialOnboardingTick(prisma: PrismaClient): Promise<number> {
  const now = new Date();
  let sent = 0;

  const active = await prisma.prospect.findMany({
    where: {
      trialStartedAt: { not: null },
      trialSequenceStep: { lt: TRIAL_STEPS.length },
      optOutAt: null,
      email: { not: null },
    },
  });

  for (const prospect of active) {
    const trialStartedAt = prospect.trialStartedAt!;
    const nextStepIndex = prospect.trialSequenceStep;
    const step = TRIAL_STEPS[nextStepIndex];
    if (!step) continue;

    const dueAt = new Date(trialStartedAt.getTime() + step.dayOffset * 24 * 60 * 60 * 1000);
    if (now < dueAt) continue;

    await sendTrialStep(prisma, prospect, step, trialStartedAt);
    sent++;
  }

  return sent;
}
