# Email Service (P4-01) — SendGrid Integration & CASL Compliance

CollectRx email service provides production-ready prospect outreach with CASL compliance, template rendering, bounce tracking, and compliance logging.

## Quick Start

### 1. Configuration (Environment Variables)

```bash
# SendGrid credentials (required for production)
SENDGRID_API_KEY=SG.xxxxxxxxxxxxx
SENDGRID_FROM_EMAIL=marketing@collectrx.ca
SENDGRID_FROM_NAME=CollectRx

# Webhook signature verification (required in production)
SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY=<Ed25519 public key from SendGrid dashboard>

# Optional: CASL mailing address override
CASL_MAILING_ADDRESS="CollectRx\n145 King Street West, Suite 200\nToronto, ON M5H 1A8\nCanada"

# Optional: email sending behavior
MARKETING_IDEMPOTENT=1              # prevent duplicate sends within 24 hours (default)
MARKETING_IDEMPOTENT=0              # disable idempotency (testing only)
EMAIL_BATCH_DELAY_MS=100            # stagger batch sends (ms)
```

### 2. Wire Up Webhook Handler

In `src/server/index.ts`, mount the SendGrid webhook:

```typescript
import { handleSendGridWebhook } from './routes/webhooks/sendgridWebhook.js';
import { db } from './db.js';

app.post('/api/webhooks/sendgrid', (req, res) =>
  handleSendGridWebhook(req, res, db),
);
```

### 3. Send Your First Email

```typescript
import { sendCampaignEmail, type EmailTemplate } from '../services/emailService.js';
import { db } from '../db.js';

// Define template
const template: EmailTemplate = {
  id: 'welcome-001',
  name: 'Welcome Email',
  subject: 'Welcome {{OwnerFirstName}}!',
  htmlBody: `
    <h1>Welcome to CollectRx, {{OwnerFirstName}}</h1>
    <p>{{PracticeName}} in {{PracticeCity}} can save ~8 hours/week on insurance follow-ups.</p>
    <p><a href="{{BookingLink}}">Schedule a demo</a></p>
  `,
  textBody: `Welcome to CollectRx, {{OwnerFirstName}}

{{PracticeName}} in {{PracticeCity}} can save ~8 hours/week.

Schedule: {{BookingLink}}`,
  requiredFields: ['OwnerFirstName', 'PracticeName', 'PracticeCity', 'BookingLink'],
};

// Prepare merge data
const mergeData = {
  OwnerFirstName: 'John',
  OwnerLastName: 'Smith',
  PracticeName: 'Smith Family Dental',
  PracticeCity: 'Toronto',
  PracticeProvince: 'ON',
  BookingLink: 'https://calendly.com/collectrx/demo?id=p123',
  UnsubscribeLink: 'https://collectrx.ca/unsubscribe?token=abc123',
};

// Send
const result = await sendCampaignEmail(
  db,
  prospectId,
  campaignId,  // optional
  template,
  mergeData,
);

console.log(result);
// { success: true, messageId: 'VJ23a34...' }
// OR
// { success: false, error: 'Invalid email address' }
```

## Templates

Templates are reusable email designs with merge fields ({{...}} syntax).

### Template Structure

```typescript
interface EmailTemplate {
  id: string;                    // unique identifier
  name: string;                  // display name
  subject: string;               // email subject (can include merge fields)
  htmlBody: string;              // HTML template (SafeHTML in production)
  textBody: string;              // plaintext fallback
  requiredFields: string[];      // merge fields that must be provided
  unsubscribeUrl?: string;       // optional override for CASL footer
}
```

### Common Merge Fields

| Field | Example | Required | Notes |
|-------|---------|----------|-------|
| `{{OwnerFirstName}}` | John | Yes | Prospect's first name |
| `{{OwnerLastName}}` | Smith | No | Prospect's last name |
| `{{PracticeName}}` | Smith Family Dental | Yes | Practice name from prospect record |
| `{{PracticeCity}}` | Toronto | Yes | City from prospect record |
| `{{PracticeProvince}}` | ON | Yes | Province (use 2-letter code) |
| `{{BookingLink}}` | https://calendly.com/... | Yes | Prospect-specific booking URL |
| `{{UnsubscribeLink}}` | https://collectrx.ca/unsubscribe?t=... | No | CASL-required unsubscribe link |

### Example: Multi-Step Sequence

**Step 1: Initial Outreach (Day 0)**

```typescript
const step1 = {
  id: 'sequence-001',
  name: 'Initial Outreach',
  subject: '{{PracticeName}}} could save 8 hours/week',
  htmlBody: `<p>Hi {{OwnerFirstName}},</p>...`,
  textBody: `Hi {{OwnerFirstName}},\n...`,
  requiredFields: ['OwnerFirstName', 'PracticeName'],
};
```

**Step 2: Value Prop Follow-Up (Day 3)**

```typescript
const step2 = {
  id: 'sequence-002',
  name: 'Follow-up: Value Prop',
  subject: 'How {{PracticeName}} automates insurance claims',
  htmlBody: `<p>Hi {{OwnerFirstName}},</p>...`,
  textBody: `Hi {{OwnerFirstName}},\n...`,
  requiredFields: ['OwnerFirstName', 'PracticeName'],
};
```

**Step 3: Booking (Day 7)**

```typescript
const step3 = {
  id: 'sequence-003',
  name: 'Book a Demo',
  subject: '{{OwnerFirstName}}, last chance for a demo this week',
  htmlBody: `<a href="{{BookingLink}}">Book a 15-min demo</a>`,
  textBody: `Book: {{BookingLink}}`,
  requiredFields: ['OwnerFirstName', 'BookingLink'],
};
```

## Sending Campaigns

### Single Prospect

```typescript
const result = await sendCampaignEmail(db, prospectId, campaignId, template, mergeData);
if (result.success) {
  console.log(`Sent email (message ID: ${result.messageId})`);
} else {
  console.error(`Failed: ${result.error}`);
}
```

### Batch Send (Rate-Limited)

```typescript
import { sendBatchCampaignEmails } from '../services/emailService.js';

const prospects = await db.prospect.findMany({
  where: { campaignId: 'camp-123', stage: 'engaged' },
});

const batch = prospects.map(p => ({
  prospectId: p.id,
  mergeData: {
    OwnerFirstName: p.contactName?.split(' ')[0] || 'there',
    PracticeName: p.practiceName,
    PracticeCity: p.city || '',
    PracticeProvince: p.province || '',
    BookingLink: `https://calendly.com/collectrx/demo?id=${p.id}`,
    UnsubscribeLink: `https://collectrx.ca/unsubscribe?token=${p.id}`,
  },
}));

const results = await sendBatchCampaignEmails(db, batch, campaignId, template);
const succeeded = results.filter(r => r.success).length;
console.log(`Sent ${succeeded}/${batch.length} emails`);
```

### With Scheduling (via BullMQ/Cron)

```typescript
// In worker or scheduled job:
export async function sendMarketingSequenceStep(prospectId: string, step: number) {
  const prospect = await db.prospect.findUnique({ where: { id: prospectId } });
  if (!prospect || prospect.optOutAt) return;

  const templates = [step1Template, step2Template, step3Template];
  const template = templates[step - 1];

  const mergeData = buildMergeData(prospect);
  const result = await sendCampaignEmail(db, prospectId, undefined, template, mergeData);

  if (result.success) {
    // Schedule next step in 3 days
    await scheduleJob(`sequence-step-${step + 1}`, {
      prospectId,
      step: step + 1,
      runAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });
  }
}
```

## CASL Compliance

CollectRx emails comply with **Canada's Anti-Spam Legislation (CASL)** and **CAN-SPAM** (US).

### Required Elements (Automatically Added)

1. **Unsubscribe Link** — placed in email header + HTML footer
2. **Mailing Address** — displayed in footer (from `CASL_MAILING_ADDRESS` env)
3. **Clear Sender Identification** — `{{SENDGRID_FROM_NAME}} <{{SENDGRID_FROM_EMAIL}}>`

### Automatic List-Unsubscribe Header

```
List-Unsubscribe: <https://collectrx.ca/unsubscribe?token=abc123>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

This allows email clients (Gmail, Outlook, Apple Mail) to show a prominent **Unsubscribe** button.

### Unsubscribe Handling

When a prospect clicks **Unsubscribe** or **Mark as Spam**:

1. SendGrid sends webhook event: `{"event": "unsubscribe", "email": "..."}`
2. Handler receives event at `POST /api/webhooks/sendgrid`
3. `markEmailEvent()` sets `prospect.optOutAt = now()`
4. Future sends for that prospect are rejected with "opted out" error

### Best Practices

- **Always provide an unsubscribe link** — even if manually unsubscribed
- **Honor opt-outs immediately** — do not retry sending after CASL unsubscribe
- **Use honest subject lines** — no misleading headers or sender names
- **Include your mailing address** — required by law
- **Track consent** — maintain list of opted-in vs opted-out
- **Segment audiences** — only send to prospects who have engaged (replies, opens, clicks)

## Tracking & Analytics

### Email Events

The service automatically logs all email events:

| Event | When | Example |
|-------|------|---------|
| `sent` | Email delivered to SendGrid | Initial send |
| `opened` | Prospect opens email | Read receipt |
| `clicked` | Prospect clicks a link | Engaged |
| `replied` | Prospect replies to email | Very engaged |
| `bounced` | Email delivery failed (hard/soft) | Invalid address |
| `unsubscribed` | Prospect clicks unsubscribe | Opt-out |
| `marked_spam` | Prospect marks as spam | Opt-out + reputation risk |
| `deferred` | Temporary delivery delay | Will retry |

### View Engagement Metrics

```typescript
import { getProspectEngagement } from '../services/emailService.js';

const engagement = await getProspectEngagement(db, prospectId);
console.log(engagement);
// {
//   opens: 3,
//   clicks: 1,
//   bounces: 0,
//   unsubscribes: 0,
//   lastEventAt: 2025-07-21T14:30:00.000Z
// }
```

### Query Events

```typescript
const events = await db.emailCampaignEvent.findMany({
  where: {
    prospectId,
    eventType: 'clicked',
  },
  select: {
    eventTimestamp: true,
    metadata: true,
  },
  orderBy: { eventTimestamp: 'desc' },
});

for (const event of events) {
  const meta = JSON.parse(event.metadata || '{}');
  console.log(`Clicked: ${meta.linkClicked}`);
}
```

## Bounce & Complaint Handling

### Hard Bounces (Permanent)

- **Cause**: Invalid address, closed account, domain error
- **Action**: Immediately stop sending to this email
- **DB update**: `prospect.emailBounceReason = "Permanent bounce: ..."`

### Soft Bounces (Temporary)

- **Cause**: Mailbox full, server down, rate limiting
- **Action**: Retry after 24–48 hours (handled by SendGrid)
- **DB update**: Logged but prospect remains eligible for retry

### Complaint (Marked as Spam)

- **Cause**: Prospect reports email as spam
- **Action**: Immediately opt-out (same as unsubscribe)
- **DB update**: `prospect.optOutAt = now()`

### Auto-Handled Events

```typescript
// When SendGrid webhook arrives:
await markEmailEvent(db, prospectId, 'bounced', {
  bounceType: 'Permanent',
  bounceReason: 'Invalid recipient',
});
// → Sets prospect.emailBounceReason
// → Future sends to this prospect are blocked

await markEmailEvent(db, prospectId, 'unsubscribed');
// → Sets prospect.optOutAt
// → All future sends blocked (honored CASL unsubscribe)
```

## Error Handling & Idempotency

### Duplicate Sends (24-Hour Window)

By default, the service prevents duplicate sends within 24 hours:

```typescript
// First send at 10:00 AM: ✅ succeeds
await sendCampaignEmail(db, prospectId, campaignId, template, data);

// Second send at 2:00 PM (same day): ❌ rejected
// { success: false, error: 'Already sent today (idempotent)' }
await sendCampaignEmail(db, prospectId, campaignId, template, data);

// Third send at 10:05 AM (next day): ✅ succeeds
await sendCampaignEmail(db, prospectId, campaignId, template, data);
```

To disable idempotency (testing only):

```bash
MARKETING_IDEMPOTENT=0 npm run dev
```

### Invalid Email Addresses

```typescript
const result = await sendCampaignEmail(db, prospectId, campaignId, template, data);
// { success: false, invalidEmail: true, error: 'Invalid email address' }
```

### Network Errors

```typescript
const result = await sendCampaignEmail(db, prospectId, campaignId, template, data);
// { success: false, error: 'SendGrid API timeout' }
```

All errors are logged to console and `EmailCampaignEvent` table for audit trail.

## Logging & Compliance

### Log Format (JSON)

```json
{
  "level": "info",
  "msg": "Email sent successfully",
  "time": "2025-07-21T14:30:00.000Z",
  "prospectId": "p-123",
  "campaignId": "camp-456",
  "templateId": "welcome-001",
  "messageId": "VJ23a34..."
}
```

### Enable JSON Logging

```bash
LOG_JSON=1 npm start
```

### Redaction

Emails and phone numbers are automatically redacted from logs:

```json
{
  "email": "[redacted:email]",
  "phone": "[redacted:phone]"
}
```

## Testing

### Unit Tests

```bash
npm test tests/emailService.test.ts
```

Tests cover:
- Template rendering with merge fields
- Missing required fields detection
- Email validation
- CASL compliance (unsubscribe, address)
- Event type mapping
- Idempotency
- Engagement metrics

### Integration Test (with DB)

```typescript
// In a test file with DATABASE_URL set:
import { db } from '../src/server/db.js';

const prospect = await db.prospect.create({
  data: {
    email: 'test@example.com',
    practiceName: 'Test Dental',
    contactName: 'John Doe',
  },
});

const result = await sendCampaignEmail(
  db,
  prospect.id,
  undefined,
  templateObject,
  mergeDataObject,
);

expect(result.success).toBe(true);
expect(result.messageId).toBeDefined();
```

### Local SendGrid Testing

1. Set `SENDGRID_WEBHOOK_SIGNATURE_VERIFY=0` in `.env` (dev only)
2. Manually call webhook endpoint:

```bash
curl -X POST http://localhost:3000/api/webhooks/sendgrid \
  -H "Content-Type: application/json" \
  -d '[{
    "event": "opened",
    "email": "user@example.com",
    "timestamp": 1234567890
  }]'
```

## Production Checklist

- [ ] `SENDGRID_API_KEY` configured in Fly.io secrets
- [ ] `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY` set to actual Ed25519 key
- [ ] SendGrid webhook endpoint configured: `https://your-domain/api/webhooks/sendgrid`
- [ ] `SENDGRID_FROM_EMAIL` + `SENDGRID_FROM_NAME` set to company email
- [ ] `CASL_MAILING_ADDRESS` customized with real address
- [ ] `MARKETING_IDEMPOTENT=1` (default, prevents duplicates)
- [ ] Monitoring: check `EmailCampaignEvent` table for bounces/complaints
- [ ] SendGrid dashboard: monitor sender reputation (bounce rate < 2%, complaint rate < 0.1%)
- [ ] DNS: SPF, DKIM, DMARC records configured for sending domain
- [ ] Monitor logs for webhook processing failures

## References

- SendGrid Docs: https://docs.sendgrid.com
- CASL: https://www.canada.ca/business/marketing/regulations/casl
- CAN-SPAM: https://www.ftc.gov/tips-advice/business-center/guidance/can-spam-act-compliance-guide-business
- Email Best Practices: https://support.sendgrid.com/hc/en-us/articles/200181728-List-Unsubscribe-Header
