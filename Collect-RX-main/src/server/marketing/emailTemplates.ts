/**
 * Email templates for the outbound partnership outreach cadence.
 *
 * Each step has a subject + HTML body. Personalization tokens:
 *   {{practiceName}}  – prospect practice name
 *   {{city}}          – city (omitted if unknown)
 *   {{senderName}}    – sender display name (env MARKETING_SENDER_NAME)
 *   {{unsubUrl}}      – one-click unsubscribe URL
 *   {{demoUrl}}       – demo booking URL (env MARKETING_DEMO_URL)
 */

export interface EmailStep {
  step: number;
  /** Days after sequence start to send this step. */
  dayOffset: number;
  subject: string;
  html: string;
}

function wrap(body: string, unsubUrl: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
           color: #1a1a1a; background: #fff; margin: 0; padding: 0; }
    .wrap { max-width: 580px; margin: 0 auto; padding: 32px 24px; }
    a { color: #2563eb; }
    .cta { display: inline-block; margin-top: 20px; padding: 12px 24px;
           background: #2563eb; color: #fff !important; border-radius: 6px;
           text-decoration: none; font-weight: 600; }
    .footer { margin-top: 40px; font-size: 12px; color: #888; border-top: 1px solid #eee; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="wrap">
    ${body}
    <div class="footer">
      You are receiving this because your practice was identified as a potential fit for CollectRx.<br/>
      <a href="${unsubUrl}">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`;
}

export function buildEmailSteps(ctx: {
  practiceName: string;
  city: string | null;
  senderName: string;
  demoUrl: string;
  unsubUrl: string;
}): EmailStep[] {
  const { practiceName, city, senderName, demoUrl, unsubUrl } = ctx;
  const cityLine = city ? ` in ${city}` : '';

  return [
    {
      step: 1,
      dayOffset: 0,
      subject: `Recovering uncollected insurance A/R at ${practiceName}`,
      html: wrap(`
<p>Hi,</p>
<p>I'm ${senderName} from <strong>CollectRx</strong> — we build AI-powered follow-up agents that call insurance carriers on behalf of Canadian dental practices to resolve outstanding claims.</p>
<p>For a practice like ${practiceName}${cityLine}, unresolved A/R can silently accumulate to $30–80K per year. Our AI squad works Mon–Fri to follow up with Sun Life, Canada Life, Manulife, Green Shield, RBC, and TELUS — so your staff don't have to.</p>
<p>Worth a 20-minute look?</p>
<a class="cta" href="${demoUrl}">Book a quick demo →</a>
<p style="margin-top:24px;">Best,<br/>${senderName}</p>
      `, unsubUrl),
    },
    {
      step: 2,
      dayOffset: 3,
      subject: `Quick question — how does ${practiceName} handle insurance follow-up today?`,
      html: wrap(`
<p>Hi again,</p>
<p>Wanted to follow up quickly. I'm curious: does ${practiceName}${cityLine} have a dedicated person calling carriers, or does it fall to whoever has time?</p>
<p>I ask because most offices we talk to spend 4–8 hours a week on hold with carriers — time that could go back to patient care.</p>
<p>CollectRx automates those calls entirely. Happy to show you how it works in 20 minutes.</p>
<a class="cta" href="${demoUrl}">See a quick demo →</a>
<p style="margin-top:24px;">Best,<br/>${senderName}</p>
      `, unsubUrl),
    },
    {
      step: 3,
      dayOffset: 7,
      subject: `How a dental office saved 8 hrs/week on insurance A/R`,
      html: wrap(`
<p>Hi,</p>
<p>Sharing a quick story: a single-dentist practice we onboarded was spending ~8 hours a week calling insurance carriers. Within 3 weeks of turning on CollectRx, their office manager reclaimed that time — claims were resolved faster and A/R aging dropped noticeably.</p>
<p>We support all six major Canadian carriers out of the box, and setup takes less than a day.</p>
<p>If this sounds relevant for ${practiceName}${cityLine}, I'd love to walk you through it.</p>
<a class="cta" href="${demoUrl}">Book 20 minutes →</a>
<p style="margin-top:24px;">Best,<br/>${senderName}</p>
      `, unsubUrl),
    },
    {
      step: 4,
      dayOffset: 14,
      subject: `Last note from CollectRx`,
      html: wrap(`
<p>Hi,</p>
<p>I don't want to clog your inbox — this will be my last note unless you'd like to connect.</p>
<p>If automating insurance follow-up is ever on the radar for ${practiceName}${cityLine}, we're happy to show you what CollectRx can do. No obligation, no pressure.</p>
<a class="cta" href="${demoUrl}">Book a demo any time →</a>
<p style="margin-top:24px;">Wishing you a smooth A/R season,<br/>${senderName}</p>
      `, unsubUrl),
    },
  ];
}

export const EMAIL_CADENCE_TOTAL_STEPS = 4;
