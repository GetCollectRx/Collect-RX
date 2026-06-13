import type { Prospect } from '@prisma/client';
import { wrapOutreachEmail } from './emailLayout.js';
import { mergeProspectFields } from './aiPersonalization.js';
import {
  OUTREACH_SIGNOFF,
  capabilityLinesForStep,
  coreProblemLine,
  outreachGreeting,
} from './outreachVoice.js';

export interface ColdSequenceStep {
  step: number;
  daysAfterPrevious: number;
  subject: string;
  buildHtml: (prospect: Prospect) => string;
  buildText: (prospect: Prospect) => string;
}

const DEMO_LINK = process.env.MARKETING_DEMO_LINK || 'https://www.collectrx.ca/#early-access';

function bullets(items: string[]): string {
  return `<ul style="margin:16px 0;padding-left:20px;">${items.map((i) => `<li style="margin-bottom:8px;">${i}</li>`).join('')}</ul>`;
}

function brandedEmail(
  bodyInner: string,
  opts: { preheader?: string; cta?: { label: string; href: string } },
): string {
  return wrapOutreachEmail({ bodyHtml: bodyInner, ...opts });
}

function signoffHtml(): string {
  return `<p style="margin:24px 0 0;color:#60605f;">${OUTREACH_SIGNOFF}</p>`;
}

export const COLD_SEQUENCE: ColdSequenceStep[] = [
  {
    step: 1,
    daysAfterPrevious: 0,
    subject: 'Outstanding insurance AR, {{practice}}',
    buildHtml: (p) => {
      const lines = capabilityLinesForStep(1);
      const g = outreachGreeting(p.contactName);
      const inner = `<p style="margin:0 0 16px;">${g}</p>
<p style="margin:0 0 16px;">${coreProblemLine(p.practiceName)}</p>
<p style="margin:0 0 16px;">${lines[0] ?? ''}</p>
${bullets(lines.slice(1))}
${signoffHtml()}`;
      return brandedEmail(inner, {
        preheader: 'Staff time on hold plus revenue left uncollected on insurance AR.',
        cta: { label: 'See how CollectRx works', href: DEMO_LINK },
      });
    },
    buildText: (p) => {
      const lines = capabilityLinesForStep(1);
      const g = outreachGreeting(p.contactName);
      return `${g}

${coreProblemLine(p.practiceName)}

${lines.join('\n\n')}

See how it works: ${DEMO_LINK}

${OUTREACH_SIGNOFF}`;
    },
  },
  {
    step: 2,
    daysAfterPrevious: 3,
    subject: 'What CollectRx handles for {{practice}}',
    buildHtml: (p) => {
      const lines = capabilityLinesForStep(2);
      const inner = `<p style="margin:0 0 16px;">${outreachGreeting(p.contactName)}</p>
<p style="margin:0 0 16px;">Quick follow-up. Unresolved insurance AR is a double cost: staff hours on hold, and revenue that never lands.</p>
${bullets(lines)}
${signoffHtml()}`;
      return brandedEmail(inner, {
        preheader: 'Detect claims, follow up with carriers, queue office actions.',
        cta: { label: 'Book a 20-minute walkthrough', href: DEMO_LINK },
      });
    },
    buildText: (p) => {
      const lines = capabilityLinesForStep(2);
      return `${outreachGreeting(p.contactName)}

Quick follow-up. Unresolved insurance AR is a double cost: staff hours on hold, and revenue that never lands.

${lines.map((l) => `• ${l}`).join('\n')}

Book a walkthrough: ${DEMO_LINK}

${OUTREACH_SIGNOFF}`;
    },
  },
  {
    step: 3,
    daysAfterPrevious: 4,
    subject: 'Denials, visibility, and aged insurance AR, {{practice}}',
    buildHtml: (p) => {
      const lines = capabilityLinesForStep(3);
      const inner = `<p style="margin:0 0 16px;">${outreachGreeting(p.contactName)}</p>
<p style="margin:0 0 16px;">Beyond status calls, CollectRx works on insurance AR still owed to the practice:</p>
${bullets(lines)}
${signoffHtml()}`;
      return brandedEmail(inner, {
        preheader: 'Denials, collections metrics, and aged insurance AR.',
        cta: { label: 'Request early access', href: DEMO_LINK },
      });
    },
    buildText: (p) => {
      const lines = capabilityLinesForStep(3);
      return `${outreachGreeting(p.contactName)}

Beyond status calls, CollectRx works on insurance AR still owed to the practice:

${lines.map((l) => `• ${l}`).join('\n')}

Request early access: ${DEMO_LINK}

${OUTREACH_SIGNOFF}`;
    },
  },
  {
    step: 4,
    daysAfterPrevious: 7,
    subject: 'Last note, {{practice}}',
    buildHtml: (p) => {
      const trustLine = capabilityLinesForStep(4)[0];
      const inner = `<p style="margin:0 0 16px;">${outreachGreeting(p.contactName)}</p>
<p style="margin:0 0 16px;">Last email from me for now.</p>
<p style="margin:0 0 16px;">If unresolved insurance AR is not a priority at ${p.practiceName}, no action needed. If it is, CollectRx runs follow-up in the background so outstanding balances move toward collected revenue.</p>
${trustLine ? `<p style="margin:0 0 16px;">${trustLine}</p>` : ''}
${signoffHtml()}`;
      return brandedEmail(inner, {
        preheader: 'Last note. Reply if insurance AR follow-up is a priority.',
        cta: { label: 'Book a demo', href: DEMO_LINK },
      });
    },
    buildText: (p) => {
      const trustLine = capabilityLinesForStep(4)[0];
      return `${outreachGreeting(p.contactName)}

Last email from me for now.

If unresolved insurance AR is not a priority at ${p.practiceName}, no action needed. If it is, CollectRx runs follow-up in the background so outstanding balances move toward collected revenue.

${trustLine ?? ''}

Book a demo: ${DEMO_LINK}

${OUTREACH_SIGNOFF}`;
    },
  },
];

export function interpolateSubject(template: string, prospect: Prospect): string {
  return mergeProspectFields(template, prospect);
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
<p style="margin:0 0 16px;">This is a quick reminder about your CollectRx demo for ${prospect.practiceName} on ${when}.</p>
<p style="margin:0 0 16px;">We will walk through how insurance AR follow-up runs with your team in the loop, and answer questions about fit for your office.</p>
${signoffHtml()}`;
  return {
    subject: `Reminder: CollectRx demo for ${prospect.practiceName}`,
    html: brandedEmail(inner, {
      preheader: 'Your CollectRx demo is tomorrow.',
      cta: { label: 'Demo details', href: DEMO_LINK },
    }),
    text: `${g}

This is a quick reminder about your CollectRx demo for ${prospect.practiceName} on ${when}.

We will walk through how insurance AR follow-up runs with your team in the loop, and answer questions about fit for your office.

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
    subject: interpolateSubject(stepDef.subject, prospect),
    html: stepDef.buildHtml(prospect),
    text: stepDef.buildText(prospect),
  };
}

export function referralEmailHtml(
  practiceName: string,
  step: 1 | 2,
): { subject: string; html: string; text: string } {
  if (step === 1) {
    const inner = `<p style="margin:0 0 16px;">Hi,</p>
<p style="margin:0 0 16px;">We're glad ${practiceName} is using CollectRx.</p>
<p style="margin:0 0 16px;">If you know another dental office that spends too much staff time on insurance follow-up, we would appreciate an intro. Reply with a name and we will reach out respectfully.</p>
${signoffHtml()}`;
    return {
      subject: 'Quick favour, know another office?',
      html: brandedEmail(inner, { preheader: 'Know another office with insurance AR follow-up pain?' }),
      text: `Hi,

We're glad ${practiceName} is using CollectRx.

If you know another dental office that spends too much staff time on insurance follow-up, we would appreciate an intro.

${OUTREACH_SIGNOFF}`,
    };
  }
  const inner = `<p style="margin:0 0 16px;">Hi,</p>
<p style="margin:0 0 16px;">Last note on this. If anyone in your network still has money stuck in insurance AR, we would welcome an introduction.</p>
${signoffHtml()}`;
  return {
    subject: 'One last ask on referrals',
    html: brandedEmail(inner, {}),
    text: `Hi,

Last note on this. If anyone in your network still has money stuck in insurance AR, we would welcome an introduction.

${OUTREACH_SIGNOFF}`,
  };
}
