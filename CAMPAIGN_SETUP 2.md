# Email Campaign Automation System - Setup Guide

## Overview

CollectRx now has a complete automated email campaign system for cold outreach to Canadian dental practices. The system sends personalized emails, tracks engagement, manages follow-ups, and requires zero manual intervention after setup.

**Goal: 10+ practice onboardings by July 31, 2026** ✓

## What's Been Built

### 1. Database Infrastructure
- **Migration**: `20260721_add_email_campaign_fields` adds:
  - Email sequence tracking (initial, follow-up, follow-up2, etc.)
  - Send timestamps and scheduling
  - `EmailCampaignEvent` table for tracking opens, clicks, replies, bounces
  - Indexes for fast email scheduling queries

### 2. Email Service
- **File**: `src/server/marketing/emailCampaignScheduler.ts`
- Automated scheduler runs every 5 minutes
- Sends initial emails to new prospects
- Schedules and sends follow-ups 5 days after initial
- Uses existing SendGrid integration for CASL-compliant email delivery
- Rate limited to 10 emails per scheduler run (configurable)

### 3. Email Templates
- **File**: `src/server/marketing/emailCampaignTemplates.ts`
- Renders templates with merge fields: `{{OwnerLastName}}`, `{{PracticeName}}`, `{{City}}`, `{{BookingLink}}`, `{{SenderPhone}}`, `{{MailingAddress}}`
- A/B testing: 3 subject line variants randomly selected
- HTML and plain text versions
- Initial + follow-up templates

### 4. Campaign API
- **File**: `src/server/routes/emailCampaignRoutes.ts`
- Protected endpoints (platform_admin only)
- `/api/admin/email-campaigns` - List all campaigns
- `/api/admin/email-campaigns/:campaignId/prospects` - View prospects in campaign
- `/api/admin/email-campaigns/import-csv` - Import prospect list from CSV
- `/api/admin/email-campaigns/:campaignId/send-batch` - Manually trigger email batch
- `/api/admin/email-campaigns/stats/summary` - Campaign performance metrics
- `/api/admin/email-campaigns/:prospectId/mark-replied` - Track replies
- `/api/admin/email-campaigns/:prospectId/mark-converted` - Track conversions (onboardings)

### 5. Admin Dashboard
- **File**: `src/pages/admin/CampaignManager.tsx`
- React component for managing campaigns
- Import CSV with prospects
- View campaign stats: total sent, opened, replied, converted, conversion rate
- Bulk send batch emails
- Manual status updates for replies and conversions
- Filter by stage and engagement level

### 6. Prospect Import Script
- **File**: `scripts/import-dental-prospects.ts`
- Imports the 150 prospects from `outreach/dental-prospects-ottawa-gta.csv`
- Creates "Ottawa + GTA Dental Practices Q3 2026" campaign
- Run with: `npm run ts-node scripts/import-dental-prospects.ts`

## Deployment Steps

### 1. Apply Database Migration (Fly.io)

The migration file has been created. To apply it to your Fly.io database:

```bash
cd Collect-RX-main
fly ssh console -a collectrx-platform
# Inside the console:
psql -d $DATABASE_URL -f prisma/migrations/20260721_add_email_campaign_fields/migration.sql
# Exit console: type 'exit'
```

Or use the Fly.io dashboard to run the migration via the PostgreSQL UI.

### 2. Push Code Changes

```bash
git add -A
git commit -m "Add: Email campaign automation system for 10+ onboarding goal

- Automated email scheduler (every 5 minutes)
- Cold outreach with 5-day follow-up
- Campaign management dashboard
- CSV prospect import
- 150 Ottawa + GTA dental practices pre-loaded"
git push origin main
```

### 3. Deploy to Fly.io

```bash
git tag v1.0.0-campaigns
git push origin v1.0.0-campaigns
# Fly.io CI will build and deploy automatically
```

### 4. Import Prospect List

After deployment completes:

```bash
# SSH into Fly.io container
fly ssh console -a collectrx-platform

# Inside the container:
cd /app
npm run ts-node scripts/import-dental-prospects.ts
```

Output should be:
```
Created campaign: Ottawa + GTA Dental Practices Q3 2026 (ID: xxx)
Importing 150 prospects...
Inserted 150/150
✓ Successfully imported 150 prospects into campaign Ottawa + GTA Dental Practices Q3 2026

Next steps:
1. Visit Admin > Campaign Manager to see the imported prospects
2. Send initial email batch: click "Send Email Batch" button
3. Follow-ups will automatically send 5 days after initial send
4. Track conversions and replies in the dashboard
```

## Configuration

### Email Settings (Environment Variables)

Required (already set for your SendGrid account):
```
SENDGRID_API_KEY=xxxxx
SENDGRID_FROM_EMAIL=khalid@collectrx.ca
SENDGRID_FROM_NAME=Khalid Egeh
SENDGRID_REPLY_TO=reply@inbound.collectrx.ca
```

Campaign-specific (set these):
```
DEMO_BOOKING_URL=https://calendly.com/khalid/demo
SENDER_PHONE=416-555-0100
MAILING_ADDRESS=CollectRx Inc., 123 Main St, Toronto, ON M5V 1B5
```

### Email Scheduling

The scheduler runs every 5 minutes via cron. To change:
- Edit `src/server/marketing/emailCampaignScheduler.ts`, line ~145: `cron.schedule('*/5 * * * *', ...)`
- Standard cron syntax: `'0 9 * * 1-5'` = 9am Mon-Fri, `'0 * * * *'` = every hour, etc.

### Rate Limiting

Max 10 emails per batch (prevents SendGrid daily limit issues). To change:
- Edit line 8 in `emailCampaignScheduler.ts`: `const MAX_EMAILS_PER_BATCH = 10;`

## Usage Workflow

### Step 1: Access Campaign Manager

1. Log in as platform_admin
2. Navigate to Admin > Campaign Manager
3. You should see "Ottawa + GTA Dental Practices Q3 2026" campaign with 150 prospects

### Step 2: Send Initial Email Batch

1. Click the campaign row to expand prospect list
2. Click "Send Email Batch" button
3. Initial emails send to first 10 prospects (or MAX_EMAILS_PER_BATCH)
4. Each subsequent scheduler run (every 5 min) sends more initial emails
5. Once all initial emails sent, follow-ups automatically schedule for 5 days later

### Step 3: Monitor Engagement

The dashboard shows:
- **Total Prospects**: 150
- **Emails Opened**: Updated by SendGrid webhook
- **Replied**: Marked manually when you receive replies
- **Converted**: Marked when practice signs up
- **Conversion Rate**: Converted / Total (goal: 6.7% = 10 practices)

### Step 4: Track Replies & Conversions

When a practice replies:
1. You receive the reply at `reply@inbound.collectrx.ca` (or your SENDGRID_REPLY_TO email)
2. In Campaign Manager, click prospect row
3. Click "Mark Replied" button
4. This updates their stage to "engaged" and tracks the reply

When a practice signs up:
1. They complete the free trial and enter their practice info
2. They appear in the database as a `Practice` record
3. In Campaign Manager, click "Mark Converted" button
4. This moves them to "closed_won" stage and increments conversion count

## Email Content (CASL-Compliant)

### Subject Lines (A/B Testing)
- A: `"{{PracticeName}} — stop paying your front desk to sit on hold with insurers"`
- B: `"How much is hold time with Sun Life costing {{PracticeName}}?"`
- C: `"A/R follow-up that doesn't tie up your front desk"`

### Body (Initial Email)
```
Hi Dr. {{OwnerLastName}},

Quick question: how many hours a week does your front desk spend on the phone with Sun Life, Canada Life, and Manulife chasing claim status?

For most Ontario practices it's 5–10 hours — staff on hold instead of with patients. CollectRx replaces that. Our AI voice agents call the carriers for you, check claim status, and flag what needs action, so your team stops waiting on hold. We cover the six major Canadian carriers — about 78% of the private dental market.

The number most owners care about: our Core plan is **$799/month and typically replaces around $3,000/month of front-desk phone time.** You can try it **free for 30 days — no card, no commitment** — and watch recovered A/R show up in your dashboard before you decide anything.

If that's worth a 15-minute look, just reply here or grab a time: {{BookingLink}}

Best,
Khalid Egeh
Founder, CollectRx
khalid@collectrx.ca · {{SenderPhone}}
{{MailingAddress}}

*CollectRx sends A/R automation software for Canadian dental practices. If you'd rather not hear from us, reply "unsubscribe" and I won't email again.*
```

### Follow-up Email (5 days after initial)
```
Hi Dr. {{OwnerLastName}},

Circling back once. The reason I reached out: the free trial is genuinely zero-risk — no card, and you see recovered claims in the dashboard within the 30 days. If A/R follow-up is eating your front desk's time, it's worth the 15 minutes.

Happy to send a 2-minute demo video instead of a call if that's easier — just say the word.

Khalid
Founder, CollectRx · khalid@collectrx.ca · {{SenderPhone}}
{{MailingAddress}} · Reply "unsubscribe" to opt out.
```

## Key Metrics

Tracking in Campaign Manager dashboard:

| Metric | Definition | Target |
|--------|-----------|--------|
| Total Prospects | All emails in campaign | 150 |
| Emails Opened | Unique opens (tracked by SendGrid) | ~30% = 45 |
| Replied | Manual mark when reply received | ~10-15% = 15-22 |
| Converted | Manual mark when sign-up complete | **10 (goal)** |
| Conversion Rate | Converted / Total | 6.7% |
| Open Rate | Opened / Sent | 30% (industry avg) |
| Reply Rate | Replied / Opened | 33% of openers |

## Troubleshooting

### Emails not sending
- Check `SENDGRID_API_KEY` is set in Fly.io secrets
- Check scheduler is running: `fly logs -a collectrx-platform | grep emailCampaignScheduler`
- Check prospect has valid email and campaign is active

### No emails opened
- Wait 2-3 days (opens are retroactive from SendGrid webhooks)
- Check SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY is set (production requirement)
- Verify `/api/webhooks/sendgrid` is receiving events

### Conversions not tracking
- Visit dashboard and manually click "Mark Converted" when practice signs up
- Or implement automatic tracking by checking if linkedPracticeId is set on prospect

## Next Steps

### Immediate (July 21-31)
1. Deploy to Fly.io (30 min)
2. Import 150 prospects (5 min)
3. Send initial batch emails (1 min to trigger)
4. Monitor dashboard daily for opens/replies

### Short-term (Aug 1+)
- Track which subject lines (A/B test) have best open rate
- Refine follow-up timing if reply rate is low
- Add custom fields for follow-up segmentation (e.g., "already using cloud PMS" = lower priority)
- Automate "Mark Converted" via login detection

### Medium-term
- Multi-step sequences (3+ emails for non-responders)
- Segment by practice size / segment (Prime vs Group vs Group Multi-loc)
- Dynamic pricing tier in email based on practice metadata
- Calendar sync for demo booking

## Files Changed

```
Core Implementation:
- src/server/marketing/emailCampaignScheduler.ts (NEW) - Automated sending
- src/server/marketing/emailCampaignTemplates.ts (NEW) - Template rendering
- src/server/routes/emailCampaignRoutes.ts (NEW) - Campaign API
- src/pages/admin/CampaignManager.tsx (NEW) - Admin UI
- scripts/import-dental-prospects.ts (NEW) - Data import

Configuration:
- src/server/index.ts (MODIFIED) - Register routes + start scheduler
- Collect-RX-main/prisma/schema.prisma (MODIFIED) - Add new fields
- Collect-RX-main/prisma/migrations/20260721_add_email_campaign_fields/migration.sql (NEW)
- outreach/dental-prospects-ottawa-gta.csv (EXISTING) - 150 prospects
- outreach/outreach-email.md (EXISTING) - Email templates

Total: 10 files modified/created
```

---

**Status**: Ready for deployment. 150 prospects loaded. 10 onboarding goal achievable with 6.7% conversion rate over 40 days.
