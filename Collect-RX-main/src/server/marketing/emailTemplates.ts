import type { Prospect } from '@prisma/client';
import { wrapOutreachEmail } from './emailLayout.js';
import { mergeProspectFields } from './aiPersonalization.js';
import {
  OUTREACH_SENDER_NAME,
  OUTREACH_SIGNOFF,
  OUTREACH_SIGNOFF_HTML,
  outreachGreeting,
} from './outreachVoice.js';

export interface ColdSequenceStep {
  step: number;
  daysAfterPrevious: number;
  subject: string;
  buildHtml: (prospect: Prospect) => string;
  buildText: (prospect: Prospect) => string;
}

export const DEMO_LINK = process.env.MARKETING_DEMO_LINK || 'https://collectrx.ca/demo';
export const BOOKING_LINK = process.env.MARKETING_BOOKING_LINK || 'https://calendly.com/collectrx/pilot-setup';

export type SubjectVariant = 'a' | 'b';

/** Deterministic 50/50 A/B assignment per prospect for subject-line testing. */
export function pickSubjectVariant(prospectId: string): SubjectVariant {
  let sum = 0;
  for (let i = 0; i < prospectId.length; i++) {
    sum += prospectId.charCodeAt(i);
  }
  return sum % 2 === 0 ? 'a' : 'b';
}

const T1_SUBJECTS: Record<SubjectVariant, string> = {
  a: 'Building something for dental practices in {{city}}, one question',
  b: 'Quick note about insurance follow-up calls at {{practice}}',
};

const T2_SUBJECTS: Record<SubjectVariant, string> = {
  a: 'Circling back, CollectRx for {{practice}}',
  b: 'One more note about dental insurance follow-ups',
};

function brandedEmail(
  bodyInner: string,
  opts: { preheader?: string },
): string {
  return wrapOutreachEmail({ bodyHtml: bodyInner, ...opts });
}

function signoffHtml(): string {
  return `<p style="margin:24px 0 0;color:#60605f;">${OUTREACH_SIGNOFF_HTML}</p>`;
}

function linkHtml(label: string, href: string): string {
  return `<a href="${href}" style="color:#0b5b47;">${label}</a>`;
}

// Two-step cold sequence: T1 (day 0) then T2 (day 7 if no reply). Sequence stops on reply or opt-out.
export const COLD_SEQUENCE: ColdSequenceStep[] = [
  {
    step: 1,
    daysAfterPrevious: 0,
    subject: T1_SUBJECTS.a,
    buildHtml: (p) => {
      const g = outreachGreeting(p.contactName);
      const inner = `<p style="margin:0 0 16px;">${g}</p>
<p style="margin:0 0 16px;">I'm ${OUTREACH_SENDER_NAME}, a founder building a product for Canadian dental practices. I wanted to reach out directly because I think the problem I'm working on is one your team deals with regularly.</p>
<p style="margin:0 0 16px;">Most practices I've spoken with spend several hours every week following up with carriers on outstanding claims. It's repetitive, time-consuming, and nobody's favorite part of running a practice.</p>
<p style="margin:0 0 16px;">I've built an AI system to handle those calls. CollectRx is new, and I'm looking for a small number of practices across Ontario to be among the first to trial it.</p>
<p style="margin:0 0 16px;">If you want to see how it works first: ${linkHtml('collectrx.ca/demo', DEMO_LINK)}</p>
<p style="margin:0 0 16px;">If you'd rather talk directly, here's my 15-minute booking link: ${linkHtml('calendly.com/collectrx/pilot-setup', BOOKING_LINK)}</p>
${signoffHtml()}`;
      return brandedEmail(inner, {
        preheader: "I've built an AI system to handle insurance carrier follow-up calls.",
      });
    },
    buildText: (p) => {
      const g = outreachGreeting(p.contactName);
      return `${g}

I'm ${OUTREACH_SENDER_NAME}, a founder building a product for Canadian dental practices. I wanted to reach out directly because I think the problem I'm working on is one your team deals with regularly.

Most practices I've spoken with spend several hours every week following up with carriers on outstanding claims. It's repetitive, time-consuming, and nobody's favorite part of running a practice.

I've built an AI system to handle those calls. CollectRx is new, and I'm looking for a small number of practices across Ontario to be among the first to trial it.

If you want to see how it works first: ${DEMO_LINK}

If you'd rather talk directly, here's my 15-minute booking link: ${BOOKING_LINK}

${OUTREACH_SIGNOFF}`;
    },
  },
  {
    step: 2,
    daysAfterPrevious: 7,
    subject: T2_SUBJECTS.a,
    buildHtml: (p) => {
      const province = p.province?.trim() || 'Ontario';
      const inner = `<p style="margin:0 0 16px;">${outreachGreeting(p.contactName)}</p>
<p style="margin:0 0 16px;">I sent a note last week about a tool I've built to automate dental insurance carrier calls. Wanted to follow up once in case it got buried.</p>
<p style="margin:0 0 16px;">The short version: I'm looking for practices in ${province} to be among the first to trial it, at no cost, and lock in pricing before we scale.</p>
<p style="margin:0 0 16px;">Demo: ${linkHtml('collectrx.ca/demo', DEMO_LINK)}<br />Book a call: ${linkHtml('calendly.com/collectrx/pilot-setup', BOOKING_LINK)}</p>
<p style="margin:0 0 16px;">If the timing isn't right, no problem.</p>
${signoffHtml()}`;
      return brandedEmail(inner, {
        preheader: 'One follow-up on insurance AR automation for your practice.',
      });
    },
    buildText: (p) => {
      const province = p.province?.trim() || 'Ontario';
      return `${outreachGreeting(p.contactName)}

I sent a note last week about a tool I've built to automate dental insurance carrier calls. Wanted to follow up once in case it got buried.

The short version: I'm looking for practices in ${province} to be among the first to trial it, at no cost, and lock in pricing before we scale.

Demo: ${DEMO_LINK}
Book a call: ${BOOKING_LINK}

If the timing isn't right, no problem.

${OUTREACH_SIGNOFF}`;
    },
  },
];

export function interpolateSubject(template: string, prospect: Prospect): string {
  return mergeProspectFields(template, prospect);
}

export function resolveColdSubject(step: number, prospect: Prospect): string {
  const variant = pickSubjectVariant(prospect.id);
  if (step === 1) return interpolateSubject(T1_SUBJECTS[variant], prospect);
  if (step === 2) return interpolateSubject(T2_SUBJECTS[variant], prospect);
  const stepDef = COLD_SEQUENCE[step - 1];
  return stepDef ? interpolateSubject(stepDef.subject, prospect) : '';
}

export function buildPreDemoEmail(prospect: Prospect): {
  subject: string;
  html: string;
  text: string;
} {
  const when = prospect.demoScheduledAt
    ? prospect.demoScheduledAt.toLocaleString('en-CA', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : 'your scheduled time';
  const g = outreachGreeting(prospect.contactName);
  const inner = `<p style="margin:0 0 16px;">${g}</p>
<p style="margin:0 0 16px;">Looking forward to talking on ${when}.</p>
<p style="margin:0 0 16px;">We'll cover how the system works and what a free trial would look like for ${prospect.practiceName}. I'll walk you through the demo and answer whatever questions you have.</p>
<p style="margin:0 0 16px;">You don't need to prepare anything. Just 15 minutes.</p>
<p style="margin:0 0 16px;">If you need to reschedule, just reply to this email.</p>
${signoffHtml()}`;
  return {
    subject: `CollectRx call, ${when}`,
    html: brandedEmail(inner, {
      preheader: `CollectRx call confirmed for ${when}.`,
    }),
    text: `${g}

Looking forward to talking on ${when}.

We'll cover how the system works and what a free trial would look like for ${prospect.practiceName}. I'll walk you through the demo and answer whatever questions you have.

You don't need to prepare anything. Just 15 minutes.

If you need to reschedule, just reply to this email.

${OUTREACH_SIGNOFF}`,
  };
}

/** Preview next cadence email (step 1–4) without sending. */
export function previewColdEmail(
  prospect: Prospect,
  step: number,
): { step: number; subject: string; html: string; text: string } | null {
  const stepDef = COLD_SEQUENCE[step - 1];
  if (!stepDef) return null;
  return {
    step: stepDef.step,
    subject: resolveColdSubject(stepDef.step, prospect),
    html: stepDef.buildHtml(prospect),
    text: stepDef.buildText(prospect),
  };
}

export type PostDemoOutcome = 'interested' | 'thinking' | 'not_fit';

/** Template 5A/5B/5C — suggested draft after a demo call (manual send or CRM copy). */
export function buildPostDemoFollowUp(
  prospect: Prospect,
  outcome: PostDemoOutcome,
  opts?: { agreementSendDay?: string; concern?: string; concernResponse?: string },
): { subject: string; html: string; text: string } {
  const g = outreachGreeting(prospect.contactName);
  const practice = prospect.practiceName;
  const agreementDay = opts?.agreementSendDay?.trim() || 'this week';

  let body: string;
  let subject: string;

  if (outcome === 'interested') {
    subject = `Re: ${practice}, next steps`;
    body = `${g}

Thanks for the time today.

To summarize where we landed: you are open to a 60-day free trial. I will send the trial agreement by ${agreementDay}. It is short and covers what the trial involves and what happens after. Nothing is binding beyond the trial period.

Questions before then, just reply.

${OUTREACH_SIGNOFF}`;
  } else if (outcome === 'thinking') {
    const concern = opts?.concern?.trim() || 'your question from today';
    const response =
      opts?.concernResponse?.trim() ||
      'I want to give you a complete answer on that rather than rush it.';
    subject = `Re: ${practice}`;
    body = `${g}

Thanks for the time today and for the honest questions.

You mentioned ${concern}. ${response}

Take the time you need. If more questions come up, I am easy to reach.

${OUTREACH_SIGNOFF}`;
  } else {
    subject = `Re: ${practice}`;
    body = `${g}

Thanks for taking the time. Sounds like this is not the right fit for ${practice} right now.

If anything changes down the road, I am easy to reach.

${OUTREACH_SIGNOFF}`;
  }

  const paragraphs = body.split('\n\n').map((p) => `<p style="margin:0 0 16px;">${p.replace(/\n/g, '<br />')}</p>`).join('');
  return {
    subject,
    html: brandedEmail(paragraphs, {}),
    text: body,
  };
}

export function referralEmailHtml(
  practiceName: string,
  step: 1 | 2,
): { subject: string; html: string; text: string } {
  if (step === 1) {
    const inner = `<p style="margin:0 0 16px;">Hi,</p>
<p style="margin:0 0 16px;">Glad to hear things are working well at ${practiceName}.</p>
<p style="margin:0 0 16px;">I'm building the first few customer relationships in Ontario right now. If you know another practice owner with the same AR problem and you respect their judgment, I'd welcome an introduction. You don't have to do anything complicated — even a one-line email introducing me is enough, and I'll take it from there.</p>
<p style="margin:0 0 16px;">No pressure if nobody comes to mind.</p>
${signoffHtml()}`;
    return {
      subject: 'One ask — know another practice owner?',
      html: brandedEmail(inner, { preheader: "If you know another practice owner with the same AR problem, I'd welcome an intro." }),
      text: `Hi,

Glad to hear things are working well at ${practiceName}.

I'm building the first few customer relationships in Ontario right now. If you know another practice owner with the same AR problem and you respect their judgment, I'd welcome an introduction. You don't have to do anything complicated — even a one-line email introducing me is enough, and I'll take it from there.

No pressure if nobody comes to mind.

${OUTREACH_SIGNOFF}`,
    };
  }
  const inner = `<p style="margin:0 0 16px;">Hi,</p>
<p style="margin:0 0 16px;">Last note on this. If anyone in your network is dealing with the same AR backlog and you think they'd find it useful, I'd welcome the introduction.</p>
${signoffHtml()}`;
  return {
    subject: 'Last note on referrals',
    html: brandedEmail(inner, {}),
    text: `Hi,

Last note on this. If anyone in your network is dealing with the same AR backlog and you think they'd find it useful, I'd welcome the introduction.

${OUTREACH_SIGNOFF}`,
  };
}
