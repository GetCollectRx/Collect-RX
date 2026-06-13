# Practice partnerships — deploy checklist

Outbound pipeline: harvest prospects, 4-email cadence, inbound reply handling, Vapi sales calls, referral asks after closed won.

## 1. Database

```bash
cd Collect-RX-main
npx prisma migrate deploy
```

Creates `prospects` and `prospect_activities` tables.

## 2. Required environment variables

| Variable | Purpose |
|----------|---------|
| `SENDGRID_API_KEY` | Send cadence + reply emails |
| `SENDGRID_FROM_EMAIL` | Verified sender (e.g. billing@collectrx.ca) |
| `SENDGRID_FROM_NAME` | Display name (default CollectRx) |
| `MARKETING_LOOP_ENABLED` | `1` to run automated cadence (default on) |
| `MARKETING_DEMO_LINK` | CTA link in emails (default collectrx.ca early access) |

## 3. Recommended variables

| Variable | Purpose |
|----------|---------|
| `MARKETING_ALERT_EMAIL` | Hot lead email alerts |
| `SLACK_MARKETING_WEBHOOK_URL` | Slack hot lead alerts |
| `GOOGLE_PLACES_API_KEY` | Prospect harvester |
| `VAPI_SALES_ASSISTANT_ID` | Outbound qualification calls |
| `VAPI_API_KEY` | Already required for claim calls |
| `VAPI_PHONE_NUMBER_ID` | Outbound caller ID |
| `GEMINI_API_KEY` | Reply classification + call summaries (optional; heuristics fallback) |
| `MARKETING_AUTO_REPLY_POSITIVE` | `false` to suggest-only on positive replies |
| `MARKETING_SOCIAL_PROOF_ENABLED` | `true` when you have a permitted reference |
| `MARKETING_SOCIAL_PROOF_LINE` | One sentence for email 4 (e.g. named practice quote) |

With `REDIS_URL` set, cadence runs via BullMQ (`MARKETING_TICK_MS`, default hourly). Without Redis, in-process cron runs (`MARKETING_CRON`, default hourly).

## 4. SendGrid webhooks

### Event webhook (opens, clicks, bounces)

- URL: `https://YOUR_API/api/webhooks/sendgrid`
- Enable: Open, Click, Bounce, Spam Report, Unsubscribe
- Verification: `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY`

Prospect emails include `customArgs.prospect_id` for stage advancement.

### Inbound parse (replies)

- URL: `https://YOUR_API/api/webhooks/sendgrid-inbound`
- Configure inbound parse on your reply subdomain in SendGrid
- Replies are classified; unsubscribe and positive intents auto-reply using locked templates

## 5. Vapi sales qualifier

1. Create assistant in Vapi dashboard (or reuse minimal assistant ID)
2. Set `VAPI_SALES_ASSISTANT_ID`
3. System prompt and first message are overridden per call from `salesCallScript.ts`
4. Webhook: same `/api/webhooks/vapi` as claim calls; metadata `callType: sales_qualifier`

See `vapi-sales-prompt.md` for voice rules reference.

## 6. Dry run (before volume)

1. Log in as platform admin → **Partnerships**
2. **Add prospect manually** with your own email
3. Open prospect → **Email preview** (verify copy)
4. Click **Run cadence tick** (or wait for scheduler)
5. Confirm email in inbox (branded layout, no em dashes)
6. Reply "interested" → confirm auto-reply + hot lead alert
7. Reply "unsubscribe" → confirm opt-out

## 7. Stage flow

`new` → `contacted` (email 1) → `engaged` (opens/clicks/replies) → `qualified` (sales call) → `demo_booked` → `closed_won` / `closed_lost` / `opted_out`

**Closed won** starts referral sequence (day 14 and 30) on cadence tick.

## 8. CASL

Read `CASL-OUTREACH.md` before cold outreach at scale.

## 9. Admin API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/partnerships/stats` | Pipeline counts |
| GET | `/api/admin/partnerships/prospects` | List |
| POST | `/api/admin/partnerships/prospects` | Manual add |
| GET | `/api/admin/partnerships/prospects/:id/email-preview?step=1` | Preview cadence |
| POST | `/api/admin/partnerships/prospects/:id/pause-sequence` | Pause cadence |
| POST | `/api/admin/partnerships/prospects/:id/opt-out` | Manual opt-out |
| POST | `/api/admin/partnerships/sequence/tick` | Manual cadence run |
| GET | `/api/admin/partnerships/outreach-voice` | Capability catalog |
