import type { Prospect } from '@prisma/client';
import { wrapOutreachEmail } from './emailLayout.js';
import { OUTREACH_SIGNOFF, outreachGreeting } from './outreachVoice.js';
import type { ReplyIntent } from './marketingTypes.js';

const DEMO_LINK = process.env.MARKETING_DEMO_LINK || 'https://www.collectrx.ca/#early-access';

export type ObjectionVariant = 'not_ready' | 'has_solution' | 'too_small' | 'busy' | 'generic';

export interface ReplyTemplateResult {
  subject: string;
  text: string;
  html: string;
  autoSend: boolean;
}

function wrapReply(body: string): { html: string; text: string } {
  const inner = body.replace(/\n/g, '<br />');
  return {
    html: wrapOutreachEmail({ bodyHtml: `<div style="font-size:16px;line-height:1.56;">${inner}</div>` }),
    text: body,
  };
}

export function detectObjectionVariant(replyText: string): ObjectionVariant {
  const lower = replyText.toLowerCase();
  if (/too small|solo|one dentist|just me/.test(lower)) return 'too_small';
  if (/already have|current vendor|using .* already|we handle/.test(lower)) return 'has_solution';
  if (/not ready|not a priority|maybe later|next quarter|next year/.test(lower)) return 'not_ready';
  if (/busy|bad time|swamped|short staffed/.test(lower)) return 'busy';
  return 'generic';
}

export function getReplyTemplate(
  intent: ReplyIntent,
  prospect: Prospect,
  replyText: string,
): ReplyTemplateResult | null {
  const g = outreachGreeting(prospect.contactName);
  const practice = prospect.practiceName;

  switch (intent) {
    case 'positive':
      return {
        subject: `Re: ${practice}, next step`,
        autoSend: process.env.MARKETING_AUTO_REPLY_POSITIVE !== 'false',
        ...wrapReply(`${g}

Thanks for getting back to us.

CollectRx helps dental offices collect outstanding insurance AR with less staff time on carrier hold lines, and revenue from aging balances that would otherwise sit uncollected.

For a short walkthrough: ${DEMO_LINK}

Or reply with a day that works and we will set something up.

${OUTREACH_SIGNOFF}`),
      };

    case 'objection': {
      const variant = detectObjectionVariant(replyText);
      return {
        subject: `Re: ${practice}`,
        autoSend: false,
        ...wrapReply(objectionBody(g, practice, variant)),
      };
    }

    case 'unsubscribe':
      return {
        subject: 'You are unsubscribed',
        autoSend: true,
        ...wrapReply(`${g}

You have been removed from our outreach list. We will not email ${practice} again.

If this was a mistake, reply and we can add you back.

${OUTREACH_SIGNOFF}`),
      };

    case 'neutral':
      return {
        subject: `Re: ${practice}`,
        autoSend: false,
        ...wrapReply(`${g}

Thanks for your note. Someone from our team will read this and follow up within one business day.

${OUTREACH_SIGNOFF}`),
      };

    default:
      return null;
  }
}

function objectionBody(g: string, practice: string, variant: ObjectionVariant): string {
  switch (variant) {
    case 'too_small':
      return `${g}

Many of our early partners are solo or small offices. CollectRx runs insurance follow-up in the background without adding headcount.

If a 20-minute walkthrough would help: ${DEMO_LINK}

${OUTREACH_SIGNOFF}`;

    case 'has_solution':
      return `${g}

Understood. If your current process is working, no need to change.

If carrier hold time or aged insurance AR becomes a problem later, CollectRx handles follow-up to six major Canadian insurers from a PMS export. Reply when timing is better.

${OUTREACH_SIGNOFF}`;

    case 'not_ready':
      return `${g}

Understood. I will pause outreach for now.

If insurance AR follow-up becomes a priority later, reach us at ${DEMO_LINK} or reply to this thread.

${OUTREACH_SIGNOFF}`;

    case 'busy':
      return `${g}

Understood. Reply with a week that works for a short demo when things calm down, or I can check back in a few months.

${OUTREACH_SIGNOFF}`;

    default:
      return `${g}

Thanks for letting us know. CollectRx helps ${practice} collect outstanding insurance AR with less staff time on carrier follow-up. Not a fit for everyone, and that is fine.

If you want a brief walkthrough anyway: ${DEMO_LINK}

${OUTREACH_SIGNOFF}`;
  }
}
