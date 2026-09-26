export interface EmailTemplateData {
  ownerLastName: string;
  practiceName: string;
  city: string;
  bookingLink: string;
  senderPhone: string;
  mailingAddress: string;
}

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function renderTemplate(template: string, data: EmailTemplateData): string {
  let rendered = template;
  rendered = rendered.replace(/{{OwnerLastName}}/g, data.ownerLastName);
  rendered = rendered.replace(/{{PracticeName}}/g, data.practiceName);
  rendered = rendered.replace(/{{City}}/g, data.city);
  rendered = rendered.replace(/{{BookingLink}}/g, data.bookingLink);
  rendered = rendered.replace(/{{SenderPhone}}/g, data.senderPhone);
  rendered = rendered.replace(/{{MailingAddress}}/g, data.mailingAddress);
  return rendered;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const INITIAL_EMAIL_SUBJECT_A = '{{PracticeName}} — stop paying your front desk to sit on hold with insurers';
const INITIAL_EMAIL_SUBJECT_B = 'How much is hold time with Sun Life costing {{PracticeName}}?';
const INITIAL_EMAIL_SUBJECT_C = 'A/R follow-up that doesn\'t tie up your front desk';

const INITIAL_EMAIL_BODY = `<p>Hi Dr. {{OwnerLastName}},</p>

<p>Quick question: how many hours a week does your front desk spend on the phone with Sun Life, Canada Life, and Manulife chasing claim status?</p>

<p>For most Ontario practices it's 5–10 hours — staff on hold instead of with patients. CollectRx replaces that. Our AI voice agents call the carriers for you, check claim status, and flag what needs action, so your team stops waiting on hold. We cover the six major Canadian carriers — about 78% of the private dental market.</p>

<p>The number most owners care about: our Core plan is <strong>$799/month and typically replaces around $3,000/month of front-desk phone time.</strong> You can try it <strong>free for 30 days — no card, no commitment</strong> — and watch recovered A/R show up in your dashboard before you decide anything.</p>

<p>If that's worth a 15-minute look, just reply here or grab a time: {{BookingLink}}</p>

<p>Best,<br>
Khalid Egeh<br>
Founder<br>
&nbsp;<br>
CollectRx<br>
{{MailingAddress}}</p>

<p>khalid@collectrx.ca &middot; {{SenderPhone}}</p>

<p><em>CollectRx sends A/R automation software for Canadian dental practices. If you'd rather not hear from us, reply "unsubscribe" and I won't email again.</em></p>`;

const FOLLOW_UP_EMAIL_SUBJECT = 're: {{PracticeName}} — 30-day free trial, no card';

const FOLLOW_UP_EMAIL_BODY = `<p>Hi Dr. {{OwnerLastName}},</p>

<p>Circling back once. The reason I reached out: the free trial is genuinely zero-risk — no card, and you see recovered claims in the dashboard within the 30 days. If A/R follow-up is eating your front desk's time, it's worth the 15 minutes.</p>

<p>Happy to send a 2-minute demo video instead of a call if that's easier — just say the word.</p>

<p>Khalid Egeh<br>
Founder<br>
&nbsp;<br>
CollectRx<br>
{{MailingAddress}}</p>

<p>khalid@collectrx.ca &middot; {{SenderPhone}} &middot; Reply "unsubscribe" to opt out.</p>`;

function getSubjectVariant(variant: 'a' | 'b' | 'c' = 'a'): string {
  switch (variant) {
    case 'b':
      return INITIAL_EMAIL_SUBJECT_B;
    case 'c':
      return INITIAL_EMAIL_SUBJECT_C;
    default:
      return INITIAL_EMAIL_SUBJECT_A;
  }
}

export function renderEmailTemplate(type: 'initial' | 'follow-up', data: EmailTemplateData): RenderedEmail {
  if (type === 'follow-up') {
    const subject = renderTemplate(FOLLOW_UP_EMAIL_SUBJECT, data);
    const html = renderTemplate(FOLLOW_UP_EMAIL_BODY, data);
    return {
      subject,
      html,
      text: htmlToText(html),
    };
  }

  // Initial email - randomly select subject line variant for A/B testing
  const variant = (['a', 'b', 'c'] as const)[Math.floor(Math.random() * 3)];
  const subject = renderTemplate(getSubjectVariant(variant), data);
  const html = renderTemplate(INITIAL_EMAIL_BODY, data);

  return {
    subject,
    html,
    text: htmlToText(html),
  };
}
