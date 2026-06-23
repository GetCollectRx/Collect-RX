# CollectRx Railway Deployment Checklist

Complete these steps before the first production deployment, and re-verify after
any major infrastructure change.

---

## 1. Railway environment variables

Set each variable in the Railway dashboard under your service > Variables.
Variables marked **REQUIRED** will cause startup failures or broken features if missing.

### Core application

| Variable | Required | Example / Notes |
|----------|----------|-----------------|
| `NODE_ENV` | REQUIRED | `production` |
| `DATABASE_URL` | REQUIRED | Set automatically by Railway Postgres plugin |
| `JWT_SECRET` | REQUIRED | Random 64-char hex string. Generate: `openssl rand -hex 32` |
| `PUBLIC_APP_URL` | REQUIRED | `https://your-app.railway.app` (no trailing slash) |
| `PUBLIC_API_BASE_URL` | REQUIRED | Same as PUBLIC_APP_URL unless API is on a separate service |

### SendGrid (outbound email + inbound parse)

| Variable | Required | Example / Notes |
|----------|----------|-----------------|
| `SENDGRID_API_KEY` | REQUIRED | `SG.xxxxxxxxxxxx` from SendGrid dashboard |
| `SENDGRID_FROM_EMAIL` | REQUIRED | `khalid@collectrx.ca` |
| `SENDGRID_FROM_NAME` | REQUIRED | `Khalid` (display name in inbox) |
| `SENDGRID_REPLY_TO` | REQUIRED | `reply@inbound.collectrx.ca` |
| `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY` | optional | From SendGrid > Settings > Mail Settings > Event Webhook. Enables open/click/bounce tracking. |

### Marketing cadence

| Variable | Required | Example / Notes |
|----------|----------|-----------------|
| `MARKETING_LOOP_ENABLED` | **REQUIRED** | Set to `1` in Railway before first production deploy. This starts the in-process email cron (`startMarketingLoopInProcess` in `src/server/marketing/marketingScheduler.ts`). The scheduler runs on every tick unless this variable is **exactly** `0` (string). Any other value, including `1` or unset, keeps the loop enabled. Use `0` only on staging if you want to disable outbound cadence without removing other marketing routes. |
| `MARKETING_CRON` | optional | Cron schedule for email tick. Default: `0 * * * *` (hourly). Cold emails only send Tue–Thu 9–10am **prospect local time** (see send window below). Recommended: keep hourly so the tick catches each province's window. |
| `MARKETING_SEND_WINDOW_DISABLED` | optional | Set to `1` on staging to bypass Tue–Thu 9–10am gate (manual `/sequence/tick` testing). Leave unset in production. |
| `MARKETING_SEND_HOUR_START` | optional | Local hour start (default `9`) |
| `MARKETING_SEND_HOUR_END` | optional | Local hour end exclusive (default `10`) |
| `MARKETING_DEMO_LINK` | REQUIRED | `https://collectrx.ca/demo` |
| `MARKETING_BOOKING_LINK` | REQUIRED | `https://calendly.com/collectrx/pilot-setup` |
| `MARKETING_MAILING_ADDRESS` | REQUIRED | Your PO Box once registered. Example: `PO Box 12345, Toronto, ON M5V 0A1` |
| `MARKETING_SITE_URL` | optional | `https://www.collectrx.ca` |
| `MARKETING_LOGO_URL` | optional | `https://www.collectrx.ca/og-image.png` |
| `MARKETING_ALERT_EMAIL` | optional | Where hot-lead alerts go. e.g. `khalid@collectrx.ca` |
| `MARKETING_AUTO_REPLY_POSITIVE` | optional | `1` to auto-advance stage on positive reply detection |
| `MARKETING_LEARNING_ENABLED` | optional | `1` to run the weekly ML score-tuning cycle |
| `MARKETING_LEARNING_CRON` | optional | Default: `0 3 * * 1` (3am Monday) |
| `MARKETING_SOCIAL_PROOF_ENABLED` | optional | `1` only after you have real results to cite |
| `MARKETING_SOCIAL_PROOF_LINE` | optional | e.g. `"3 Ontario practices run CollectRx today."` |
| `MARKETING_PRACTICE_TEMP_PASSWORD` | optional | Temp password auto-assigned when a prospect converts to a Practice account |

### Demo booking webhook (Calendly)

| Variable | Required | Example / Notes |
|----------|----------|-----------------|
| `MARKETING_DEMO_WEBHOOK_SECRET` | REQUIRED | Random string used to verify Calendly webhook signatures. Generate: `openssl rand -hex 24` |

### Vapi (AI voice calls)

| Variable | Required | Notes |
|----------|----------|-------|
| `VAPI_API_KEY` | REQUIRED for voice | From dashboard.vapi.ai |
| `VAPI_PHONE_NUMBER` | REQUIRED for voice | E.164 format: `+14165550100` |
| `VAPI_PHONE_NUMBER_ID` | REQUIRED for voice | Vapi phone number UUID |
| `VAPI_SALES_ASSISTANT_ID` | optional | Vapi assistant UUID for sales outreach calls |
| `VAPI_WEBHOOK_SECRET` | optional | For verifying Vapi event webhooks |

### HubSpot (optional CRM sync)

| Variable | Required | Notes |
|----------|----------|-------|
| `HUBSPOT_ACCESS_TOKEN` | optional | Private app token from HubSpot > Settings > Integrations |
| `HUBSPOT_PIPELINE_ID` | optional | HubSpot deal pipeline ID to sync prospect stages into |
| `HUBSPOT_DEAL_STAGE_MAP` | optional | JSON map of ProspectStage -> HubSpot stage ID |

### Slack (optional ops alerts)

| Variable | Required | Notes |
|----------|----------|-------|
| `SLACK_MARKETING_WEBHOOK_URL` | optional | Incoming webhook URL for hot-lead and escalation alerts |

### Twilio (optional SMS)

| Variable | Required | Notes |
|----------|----------|-------|
| `TWILIO_ACCOUNT_SID` | optional | |
| `TWILIO_FROM_NUMBER` | optional | E.164 format |
| `TWILIO_SMS_INBOUND_URL` | optional | Public URL Railway exposes for inbound SMS |

### DNCL (Canada's Do Not Call List)

| Variable | Required | Notes |
|----------|----------|-------|
| `DNCL_CHECK_URL` | optional | CRTC DNCL API endpoint if using live check |
| `DNCL_CHECK_API_KEY` | optional | |
| `DNCL_STRICT` | optional | `1` to block prospects on DNCL from email too (default: phone only) |
| `DNCL_PHONE_LIST_PATH` | optional | Local file path for offline DNCL list |

### Stripe (optional billing)

| Variable | Required | Notes |
|----------|----------|-------|
| `STRIPE_SECRET_KEY` | optional | `sk_live_...` |

### Observability

| Variable | Required | Notes |
|----------|----------|-------|
| `EARLY_ACCESS_NOTIFY_EMAIL` | optional | Email that receives early-access signups from the website |
| `ESCALATION_STAFF_PHONE` | optional | Phone number for escalation voice ring |
| `EMAIL_UNSUBSCRIBE_SECRET` | optional | Secret for generating signed unsubscribe tokens (CASL) |
| `PLATFORM_DEV_PASSWORD` | optional | Dev-only seed password |
| `PLATFORM_DEV_PASSWORD_HASH` | optional | bcrypt hash of the above |

---

## 2. Database migration

After deploying, run the Prisma migration to add the trial onboarding columns:

```bash
# From your Railway shell or via Railway CLI:
npx prisma migrate deploy
```

This applies all pending migrations including:
- `20260618000000_trial_onboarding` — adds `trial_started_at` and `trial_sequence_step`
  to the `prospects` table.

---

## 3. Calendly webhook registration

**Status: Pending — requires your Calendly login.**

Direct URL: https://calendly.com/app/integration/webhooks

1. Log in to Calendly
2. Go to Integrations > Webhooks > **New Webhook**
3. Set **Subscriber URL** to:
   ```
   https://collectrx.ca/api/demo-booking/webhook
   ```
4. Select events: **invitee.created**, **invitee.canceled**
5. Calendly will generate and display a **signing key** — copy it
6. In Railway > Collect-RX > Variables, add:
   ```
   MARKETING_DEMO_WEBHOOK_SECRET = <paste signing key from Calendly>
   ```
7. Click Deploy in Railway

Note: Calendly generates the signing key on their end. You cannot pre-set it. You must copy their generated key into Railway after step 5.

---

## 4. SendGrid Inbound Parse (reply detection)

This enables automatic reply detection so the sequence stops when a prospect replies.

**Status: Pending — requires Cloudflare and SendGrid logins.**

### Step 1: Add MX record in Cloudflare

collectrx.ca DNS is confirmed on Cloudflare (nameservers: heidi.ns.cloudflare.com, damon.ns.cloudflare.com).

1. Log in to https://dash.cloudflare.com
2. Select the collectrx.ca zone
3. Go to DNS > Records > **Add record**
4. Fill in:
   | Field | Value |
   |-------|-------|
   | Type | MX |
   | Name | inbound |
   | Mail server | mx.sendgrid.net |
   | Priority | 10 |
   | TTL | Auto |
5. Click **Save**

DNS propagation takes 5-30 minutes.

### Step 2: Register the subdomain in SendGrid

1. Log in to https://app.sendgrid.com
2. Go to Settings > Inbound Parse
3. Click **Add Host & URL**
4. Fill in:
   - **Receiving Domain**: `inbound.collectrx.ca`
   - **Destination URL**: `https://collectrx.ca/api/sendgrid/inbound`
5. Leave "POST the raw, full MIME message" unchecked (the router handles parsed JSON)
6. Click **Add**

### Step 3: Verify

Send a test email to `reply@inbound.collectrx.ca` from any address.
Within 30 seconds you should see a `reply_detected` event in the prospect activity log.

---

## 5. RCDSO scraper setup

Before running the scraper, confirm you have Python 3.10+ installed:

```bash
cd scripts/rcdso-scraper
pip install -r requirements.txt

# Calibration run (dumps raw HTML to confirm selectors are correct):
python3 scrape.py --dump-html

# Full scrape (all cities in cities.txt):
python3 scrape.py --output prospects.csv

# Import into CollectRx (get API token from your admin login):
export COLLECTRX_API_URL=https://your-app.railway.app
export COLLECTRX_API_TOKEN=eyJ...
python3 import_csv.py --file prospects.csv --min-score 60
```

**SELECTOR CALIBRATION**: If the RCDSO site has updated its HTML since this was written,
run `python3 scrape.py --dump-html` and inspect the output. Update the selectors in
`scrape.py` under `parse_results_page()` to match the current markup.

---

## 6. First-run sequence of operations

Run these in order on first launch:

1. Deploy to Railway with all REQUIRED env vars set (including `MARKETING_LOOP_ENABLED=1`)
2. Run `npx prisma migrate deploy` via Railway shell
3. Register Calendly webhook (step 3 above)
4. Set up SendGrid Inbound Parse MX record (step 4 above)
5. Create your admin account via the app signup flow, then set its role to `platform_admin` directly in the database:
   ```sql
   UPDATE "users" SET role = 'platform_admin' WHERE email = 'khalid@collectrx.ca';
   ```
6. Run the RCDSO scraper and import prospects (step 5 above)
7. Trigger the first email tick manually:
   ```
   POST https://collectrx.ca/api/partnerships/sequence/tick
   Authorization: Bearer <your-admin-token>
   ```
8. Verify one email arrives in your SendGrid activity feed

---

## 7. PO Box (CASL requirement)

The `MARKETING_MAILING_ADDRESS` env var is set to `PO Box [TBD], Toronto, ON` until
you register a PO Box. Update it as soon as you have the address.

Canada Post PO Box registration: [canadapost.ca](https://www.canadapost-postescanada.ca)
A basic Toronto PO Box is approximately $100-160/year.

Once registered, update the variable in Railway and redeploy (or the change takes effect
on next email send without redeployment since it reads from env at runtime).
