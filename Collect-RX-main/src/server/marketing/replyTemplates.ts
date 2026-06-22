import type { Prospect } from '@prisma/client';
import { wrapOutreachEmail } from './emailLayout.js';
import { BOOKING_LINK, DEMO_LINK } from './emailTemplates.js';
import { OUTREACH_SIGNOFF, outreachGreeting } from './outreachVoice.js';
import type { ReplyIntent } from './marketingTypes.js';

export type ObjectionVariant =
  | 'pricing'
  | 'privacy'
  | 'has_solution'
  | 'not_ready'
  | 'proven'
  | 'busy'
  | 'too_small'
  | 'generic';

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
  if (/cost|price|pricing|how much|fee|pay|subscription|what does it/.test(lower)) return 'pricing';
  if (/privacy|data security|patient data|phipa|pipeda|hipaa|phi|personal information|share.*data|comfortable sharing/.test(lower)) {
    return 'privacy';
  }
  if (/proven|validated|tested|does it work|actually work|been tested|any customers|case stud|is this real/.test(lower)) {
    return 'proven';
  }
  if (/too small|solo|one dentist|just me/.test(lower)) return 'too_small';
  if (/already have|current vendor|using .* already|we handle|our biller|someone handling/.test(lower)) {
    return 'has_solution';
  }
  if (/not ready|not a priority|maybe later|next quarter|next year|not the right time|wrong time/.test(lower)) {
    return 'not_ready';
  }
  if (/busy|bad time|swamped|short staffed|too busy/.test(lower)) return 'busy';
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
        subject: `Re: ${practice}`,
        autoSend: process.env.MARKETING_AUTO_REPLY_POSITIVE !== 'false',
        ...wrapReply(`${g}

Good to hear from you. Happy to walk you through it.

The best next step is a short call where I can show you the demo in context and answer your specific questions. I can usually cover how it works and what a trial would look like in about 15 minutes.

Book a time here: ${BOOKING_LINK}

Or reply with a day that works and we can set something up.

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

Thanks for your note. I will read this and follow up within one business day.

${OUTREACH_SIGNOFF}`),
      };

    default:
      return null;
  }
}

function objectionBody(g: string, practice: string, variant: ObjectionVariant): string {
  switch (variant) {
    case 'pricing':
      return `${g}

The trial is free. After the trial, if you want to continue, we agree on a rate before the public launch and that stays locked in permanently. Early customers get that rate specifically because they trialed it first.

The conversation about the specific number happens after you have seen it work on your own claims.

Worth a short call to see if the pilot makes sense for ${practice}? I can walk you through what it involves.

${OUTREACH_SIGNOFF}`;

    case 'privacy':
      return `${g}

That is the right concern to raise. Here is a direct answer.

CollectRx does not access patient records. The system works with claim reference numbers and carrier identifiers, not names, health card numbers, or clinical information. There is no connection to your practice management software during the pilot.

Everything is designed to comply with PIPEDA and Canadian healthcare privacy standards.

I can walk you through exactly what crosses the system boundary on a short call, so you can make an informed decision. Would that be useful?

${OUTREACH_SIGNOFF}`;

    case 'has_solution':
      return `${g}

That is actually the setup where this tends to make the most sense.

Your biller is probably excellent at the parts of the job that need human judgment. CollectRx handles the part that does not: sitting on hold, navigating IVRs, following up on the same claim across three calls. A biller's capacity has a ceiling. That is usually why an AR backlog exists even when someone is actively working it. CollectRx runs concurrent queues without hold time, so it adds throughput without adding headcount.

This is not a replacement. The biller handles exceptions and escalations. CollectRx handles the repetitive queue they should not be spending time on anyway.

Worth a quick look at whether that dynamic is true for your practice?

${OUTREACH_SIGNOFF}`;

    case 'proven':
      return `${g}

The product is built and functional. The demo at ${DEMO_LINK} shows how it works. CollectRx is new, which is why I am offering a free trial rather than asking you to commit to a paid subscription before you have seen it work on your own claims.

That is a reasonable and normal way to evaluate any new software. You see it run, you decide whether it is delivering value, and then we talk about what a continued arrangement looks like.

Happy to walk you through it on a short call if that would help.

${OUTREACH_SIGNOFF}`;

    case 'not_ready':
    case 'busy':
      return `${g}

Understood. Timing matters.

If anything changes or the AR situation gets worse over the next few months, feel free to reach back out. I will be easy to find.

${OUTREACH_SIGNOFF}`;

    case 'too_small':
      return `${g}

Many early trial practices are solo or small offices. CollectRx runs insurance follow-up in the background without adding headcount.

If a 15-minute call would help: ${BOOKING_LINK}

${OUTREACH_SIGNOFF}`;

    default:
      return `${g}

Thanks for letting us know. CollectRx helps ${practice} follow up on outstanding insurance claims with less staff time on carrier hold lines. Not a fit for everyone, and that is fine.

If you want a brief walkthrough anyway: ${DEMO_LINK}

${OUTREACH_SIGNOFF}`;
  }
}
