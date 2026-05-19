# CollectRx — Railway Deployment Guide

This guide walks through exactly what your codebase needs to get from
"Railway 404 train page" to a live app in the browser and a working desktop app.

**Selling to practices / 24×7 for clients (not your Mac):** use the full production layout — web + Postgres + Redis + worker + custom domain — in **[docs/operations/RAILWAY-PRODUCTION.md](../docs/operations/RAILWAY-PRODUCTION.md)**.

---

## What you already have (no changes needed)

| File | Status | Notes |
|------|--------|-------|
| `Dockerfile` | ✅ Correct | Builds Prisma + TS + Vite, starts on port 3000 |
| `railway.toml` | ✅ Correct | Docker builder, health check at `/api/health` |
| `prisma/schema.prisma` | ✅ Ready | PostgreSQL, all models present |
| `prisma/migrations/` | ✅ Ready | Migrations run via `releaseCommand` on each deploy |

---

## Phase A — Create the web service on Railway

### A1 — Create the service

1. Open your Railway project → **New** → **GitHub Repo**
2. Select the same GitHub repo (e.g. `collectrx-platform` or `Collect-RX-main`)
3. Railway will try to detect the build — stop it if it auto-deploys before you set variables

### A2 — Set the root directory (monorepo only)

If your GitHub repo is `collectrx-platform` (the parent folder), go to:
**Service → Settings → Source → Root Directory** and enter `Collect-RX-main`

If the repo is already just `Collect-RX-main`, leave root directory blank.

### A3 — Confirm Docker build

Railway reads `railway.toml` automatically, which already sets:
```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"
```
No changes needed — Railway will use your Dockerfile.

### A4 — Add environment variables

Go to **Service → Variables** and add the following. These are the minimum required to boot:

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | *Reference your Postgres service* | In Railway: click `+ Reference` → select your Postgres → `DATABASE_URL` |
| `NODE_ENV` | `production` | Required — enables prod logging, disables dev shortcuts |
| `JWT_SECRET` | *Random 64-char hex* | Run `openssl rand -hex 32` on your Mac terminal, paste the result |
| `PUBLIC_APP_URL` | `https://YOUR_SERVICE.up.railway.app` | Fill in after step A5; can update after first deploy |
| `ALLOWED_ORIGINS` | `https://YOUR_SERVICE.up.railway.app` | Must match PUBLIC_APP_URL exactly (no trailing slash) |
| `SERVER_URL` | `https://YOUR_SERVICE.up.railway.app` | Same as above |

**Optional but recommended for full functionality:**

| Variable | Value |
|----------|-------|
| `VAPI_API_KEY` | From dashboard.vapi.ai → API Keys |
| `VAPI_PHONE_NUMBER_ID` | From dashboard.vapi.ai → Phone Numbers |
| `VAPI_WEBHOOK_SECRET` | `openssl rand -hex 32` (set same value in Vapi dashboard) |
| `SENDGRID_API_KEY` | From SendGrid dashboard |
| `SENDGRID_FROM_EMAIL` | Your verified sender email |
| `TWILIO_ACCOUNT_SID` | From Twilio console |
| `TWILIO_AUTH_TOKEN` | From Twilio console |
| `TWILIO_FROM_NUMBER` | Your Twilio phone number (`+1…`) |
| `STRIPE_SECRET_KEY` | `sk_test_…` or `sk_live_…` from Stripe dashboard |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from Stripe dashboard |

Leave Twilio/Stripe/Vapi variables unset for now if you haven't configured those integrations yet — the app will still boot and serve the dashboard.

### A5 — Enable public networking

1. Go to **Service → Settings → Networking**
2. Click **Generate Domain** (or add a custom domain)
3. Copy the URL — it looks like `https://collectrx-xxxx.up.railway.app`
4. Go back to **Variables** and update `PUBLIC_APP_URL`, `ALLOWED_ORIGINS`, and `SERVER_URL` to this URL

### A6 — Run database migrations

The app will fail the readiness check (`/api/health/ready`) until migrations run.

**Option 1 (easiest) — Railway one-off shell:**
1. Service → **Deploy** tab → open the most recent deploy
2. Click **Shell** or use the Railway CLI: `railway run npx prisma migrate deploy`

**Option 2 — from your Mac (safe for first deploy):**
```bash
cd /Users/khalidegeh/Desktop/Dentist/collectrx-platform/Collect-RX-main

# Get DATABASE_URL from Railway → Postgres → Connect → Public URL
export DATABASE_URL="postgresql://postgres:PASSWORD@HOST.railway.app:PORT/railway"

npm run db:migrate
```

**Option 3 — add a release phase to railway.toml (runs automatically before each deploy):**
```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/api/health"
healthcheckTimeout = 100
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3

releaseCommand = "npx prisma migrate deploy"
```
This is the most hands-off option — migrations run on every deploy automatically.

### A7 — Verify

Open two URLs in your browser:

1. `https://YOUR_SERVICE.up.railway.app/api/health` → should return `{"status":"ok"}` or similar
2. `https://YOUR_SERVICE.up.railway.app/api/health/ready` → should return OK once migrations are done
3. `https://YOUR_SERVICE.up.railway.app` → should load the CollectRx dashboard UI (React app)

If you see the Railway "404 train" page at step 3 but step 1 works, the SPA static serving
is misconfigured — check that `npm run build` completed in the Docker logs
(`vite build` must run and output to `dist/`).

---

## Phase B — Point the desktop app at your Railway URL

### B1 — Create the dashboard URL file

Open Terminal on your Mac and run:

```bash
mkdir -p ~/Library/Application\ Support/dental-ar-system
echo "https://YOUR_SERVICE.up.railway.app" > ~/Library/Application\ Support/dental-ar-system/dashboard-url.txt
```

Replace `YOUR_SERVICE.up.railway.app` with the actual URL from step A5.
One line, no trailing slash (or with — both work).

### B2 — Use the right build for your Mac

| Mac type | Build to use |
|----------|-------------|
| Apple Silicon (M1/M2/M3/M4) | `mac-arm64/CollectRx.app` or `*-arm64-mac.zip` |
| Intel Mac | `mac/CollectRx.app` or `*-mac.zip` (no `arm64` in the name) |

### B3 — Restart CollectRx

Quit the app fully (Cmd+Q) then reopen it. It reads `dashboard-url.txt` on launch.

**Definition of done:** The Electron window loads your CollectRx dashboard, not a Railway placeholder.

---

## Phase C — Hardening (do after A + B work)

### C1 — Webhook URLs

Once the service is live, update these in external dashboards:

| Service | Setting | Value |
|---------|---------|-------|
| Vapi | Server URL | `https://YOUR_SERVICE.up.railway.app/api/vapi/webhook` |
| Stripe | Webhook endpoint | `https://YOUR_SERVICE.up.railway.app/api/stripe/webhook` |
| Twilio | "A message comes in" | `https://YOUR_SERVICE.up.railway.app/api/twilio/sms` |
| SendGrid | Event Webhook | `https://YOUR_SERVICE.up.railway.app/api/webhooks/sendgrid` |

Also set `TWILIO_SMS_INBOUND_URL` in Railway Variables to the Twilio webhook URL above
(Twilio uses this for signature validation).

### C2 — Background jobs with Redis (recommended for production / clients)

**Required for selling:** reminders, rules, and Phase 6 learning should not depend on your laptop.

1. Add a **Redis** service in Railway
2. Add `REDIS_URL` on **collectrx-web** (reference Redis)
3. Add a second service **collectrx-worker** — same repo, root `Collect-RX-main`, same Dockerfile, **Custom Start Command:** `npm run worker`
4. Copy `DATABASE_URL`, `REDIS_URL`, `NODE_ENV=production`, and integration env (Twilio, Notion for learning, etc.)

See **[docs/operations/RAILWAY-PRODUCTION.md](../docs/operations/RAILWAY-PRODUCTION.md)** for the full diagram and variable list.

Without Redis, rules/reminders/learning run in-process on the web container only — acceptable for a single-instance pilot, not ideal for multi-client production.

### C3 — Practice details

Fill in these variables in Railway for correct reminder message copy:

```
PRACTICE_NAME=Dr. Hasan Dental
PRACTICE_PHONE=+16135551234
PRACTICE_EMAIL=billing@yourpractice.com
PRACTICE_ADDRESS=123 Main Street
PRACTICE_CITY=Ottawa
PRACTICE_PROVINCE=ON
PRACTICE_POSTAL=K1A 0A9
PRIMARY_DENTIST=Dr. Hasan
```

### C4 — CARRIER_BLOCK safety

Review your queue control variables — these prevent runaway AI calls:
```
QUEUE_MIN_DAYS_OUTSTANDING=14   # skip claims under 14 days old
QUEUE_MIN_CLAIM_VALUE=100        # skip claims under $100
QUEUE_MAX_ATTEMPTS_BEFORE_REVIEW=3
QUEUE_MAX_CALLS_PER_RUN=20
```

Keep `TEST_PHONE_OVERRIDE` **deleted** (not blank — deleted) before going live.

---

## Quick reference: minimum Railway Variables checklist

```
DATABASE_URL          → reference Postgres service
NODE_ENV              → production
JWT_SECRET            → openssl rand -hex 32
PUBLIC_APP_URL        → https://YOUR_SERVICE.up.railway.app
ALLOWED_ORIGINS       → https://YOUR_SERVICE.up.railway.app
SERVER_URL            → https://YOUR_SERVICE.up.railway.app
```

**Phase 6 learning loop (Railway):**

```
LEARNING_LOOP_ENABLED=1
NOTION_API_KEY=...
NOTION_LEARNING_DATABASE_ID=...
LEARNING_CRON=0 6 * * *
```

Everything else in `.env.example` is optional until you enable those integrations.
