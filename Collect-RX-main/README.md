# CollectRx — Dental A/R execution

Web application for dental practices to run **rules-based** patient A/R workflows: stages, messaging, and payment collection, with a full **audit trail** in the app database.

**Architecture decision (which codebase is “the product”):** see [`docs/adr/0001-primary-application-stack.md`](../docs/adr/0001-primary-application-stack.md) in the repo root. This folder (`Collect-RX-main/`) is the **canonical** app. The UI is a **single** Vite + React app under `src/` (port 5173). A legacy second React app under `Collect-RX-main/frontend/` was **removed** — do not reintroduce a duplicate UI. The repo root `src/api` + `src/frontend` stack (if present) is a separate **prototype** (in-memory API).

**MVP and non-goals (v1):** [`docs/product/MVP-SCOPE.md`](../docs/product/MVP-SCOPE.md).

## 🎯 Overview

This system sits alongside the practice's PMS (practice management software — e.g. AbelDent, Dentrix, ClearDent — which remains the system of record) and provides automated execution of A/R collection workflows:
- **Rules Engine**: Automatically advances balances through collection stages based on time and amount thresholds
- **Automated Messaging**: Sends progressive messages (friendly → firm) as balances age
- **Payment Collection**: Provides payment links and tracks all payment events
- **Complete Auditability**: Every stage transition, message, and payment is recorded

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Windows, Mac, or Linux

### Setup (3 minutes)

```bash
# 0. From repository root: install workspaces (PostgreSQL must be running separately unless you use Docker)
cd .. && npm install && cd Collect-RX-main

# 1. Environment — `.env` is not in git (secrets). Copy the template to create it:
cp .env.example .env
# Set DATABASE_URL to your PostgreSQL (e.g. Fly Postgres) and JWT_SECRET
# Optional: from repo root, `docker compose up -d` if you want Postgres in Docker instead

# 2. Prisma client + migrations (PostgreSQL; do not use db:push in prod — use migrate deploy)
npm run db:generate
npm run db:migrate:dev

# 3. Seed database with practice, patients, and initial balances
npm run db:seed

# 4. Start the application (runs both backend and frontend)
npm run dev
```

### Desktop app (Electron)

The desktop app is a **thin shell** around the same React UI — plus a system tray icon and AbelDent sync on Windows. It is **not** a separate codebase.

```bash
# From Collect-RX-main/ (or repo root: npm run dev:electron)
npm run dev:electron
```

This starts the API, Vite, and opens a **CollectRx** window with the green desktop connector banner. Minimize closes to tray; double-click the tray icon to reopen.

If `electron` fails to open with `app is undefined`, your shell may have **`ELECTRON_RUN_AS_NODE=1`** set (Cursor/CI sometimes does). The `dev:electron` script unsets it automatically; or run:

```bash
env -u ELECTRON_RUN_AS_NODE npm run dev:electron
```

**Package installers** (output in `dist-electron/`):

```bash
npm run build:mac:arm64   # Apple Silicon .app + zip
npm run build:mac         # Intel + Apple Silicon
npm run build:win         # Windows NSIS .exe (best on Windows)
```

Packaged builds load `https://www.collectrx.ca` by default. For local testing of a built `.app`, create `~/Library/Application Support/dental-ar-system/dashboard-url.txt` with one line: `http://localhost:5173` (and run `npm run dev` separately).

Download page: `/download` in the web app. CI: [`.github/workflows/collectrx-electron-installers.yml`](../.github/workflows/collectrx-electron-installers.yml).

Log in at the app URL using the **seeded practice** credentials — the login is whatever `SEED_PRACTICE_PASSWORD` was set to when you ran `db:seed` (`src/server/seed.ts` has no default; it requires the var). For a one-command path from the repo root, use `npm run dev` in the **platform** root (see [../README.md](../README.md)).

**CollectRx demo practice (`npm run demo:seed`):** Creates the generic demo practice with realistic AR and pre-visit data that walks through the call-to-resolution loop — one live call, a practice gate, a recall-due claim, and a high-value aging Manulife claim. Login is `demo@collectrx-test.local` / whatever you set `SEED_PRACTICE_PASSWORD` to — there is **no default password**; the script requires it (min 8 chars) and exits without one:

```bash
SEED_PRACTICE_PASSWORD=your_own_password npm run demo:seed
```

Re-run with `npm run demo:seed -- --reset` to wipe and reseed. See [docs/architecture/call-to-resolution.md](docs/architecture/call-to-resolution.md).

**Automated tests (P7):** `npm test` (Vitest: unit + API/Stripe mock integration). **When something breaks:** `npm run diagnose` prints a subsystem report (typecheck → env → DB → tests → optional live smoke). **Notify on-call:** `npm run diagnose -- --alert` with `OPS_ALERTS_ENABLED=1` (SMS/email/Slack with impact + fixes). See [../docs/operations/BREAKAGE-DIAGNOSIS.md](../docs/operations/BREAKAGE-DIAGNOSIS.md) and [../docs/operations/OPS-ALERTS.md](../docs/operations/OPS-ALERTS.md). E2E: `npm run build` then `npm start` (port 3000), set `E2E_PRACTICE_ID` from `npm run e2e:print-id` after a seed, then `npm run e2e` (Playwright). Details, k6 load example, and i18n decision: [../docs/operations/PHASE7-QA.md](../docs/operations/PHASE7-QA.md), [../docs/product/I18N-DECISION.md](../docs/product/I18N-DECISION.md).

**Background jobs (P8):** With **`REDIS_URL`** in `.env`, `npm run dev` auto-starts Redis (Docker) and the BullMQ **worker** alongside API + Vite — no second terminal. Without Redis, rules run in-process. See [../docs/operations/PHASE8-BACKGROUND.md](../docs/operations/PHASE8-BACKGROUND.md).

**AbelDent / Windows (Phase 4):** On the practice PC, `npm install mssql`, run **`npm run abeldent:discover -- --server "HOST\\INSTANCE" --database AbelDent --out schema-discovery.json`**, copy **`schema-map.example.json`** → **`schema-map.json`**, edit mismatches, then **`npm run abeldent:validate-queries`**. Set **`ABELDENT_SCHEMA_MAP`** for the packaged sync service (see `.env.example`). Windows `.exe` builds in CI: [../.github/workflows/collectrx-electron-installers.yml](../.github/workflows/collectrx-electron-installers.yml).

### Stripe test mode (practice SaaS Billing)

CollectRx uses Stripe Billing for the **practice subscription** only (Practice → Insurance product — no patient/client payment collection).

1. Set **`STRIPE_SECRET_KEY`** to a [test](https://docs.stripe.com/keys#test-live-modes) key (`sk_test_...`) and **`STRIPE_WEBHOOK_SECRET`** to a signing secret (`whsec_...`).

2. **Local webhooks:** install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and run:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Use the `whsec_` value the CLI prints as **`STRIPE_WEBHOOK_SECRET`** while that process is running (or create a [fixed endpoint](https://docs.stripe.com/webhooks#test-webhook) in the Dashboard for a public tunnel URL in staging/prod).

3. Open **`/billing`** in the app, start Checkout for a plan, and complete with a [test card](https://docs.stripe.com/testing) (e.g. `4242 4242 4242 4242`).

4. Confirm the webhook updates subscription state and that replaying the same event does **not** double-apply (idempotency via processed Stripe events).

**Operator e2e (test mode) checklist:**

- [ ] `STRIPE_SECRET_KEY` is `sk_test_...` and `STRIPE_WEBHOOK_SECRET` matches the active listener (CLI `whsec_` or Dashboard endpoint).
- [ ] `stripe listen --forward-to <host>:3000/api/stripe/webhook` (or equivalent) is running or the Dashboard endpoint is reachable.
- [ ] Practice Checkout / Customer Portal from **`/billing`** works with a test card.
- [ ] Replaying the same Billing webhook does not corrupt subscription state.

The application will be available at:
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000

## 📋 Demo Script (5 minutes)

Follow these steps to see the system in action:

### Step 1: View Dashboard (30 seconds)
1. Open http://localhost:5173 in your browser
2. You'll see the dashboard with:
- Total open A/R amount
- Aging buckets (0-30, 31-60, >60 days)
- Balance counts by stage

### Step 2: Watch the Rules Engine (1 minute)
1. Check your terminal where you ran `npm run dev`
2. Watch for log messages like:
```
📨 Balance xxx → NOTIFIED
📨 Balance xxx → REMINDER_1
⚠️ Balance xxx → ESCALATED + STAFF_REVIEW
```
3. The rules engine runs every 60 seconds and automatically processes balances based on:
- **CREATED** → Immediately send NOTIFIED message
- **NOTIFIED** (5+ days old) → Send REMINDER_1
- **REMINDER_1** (10+ days old) → Send REMINDER_2
- **REMINDER_2** (20+ days old OR ≥$500) → ESCALATED

### Step 3: View Message Outbox (1 minute)
1. Click **"Message Outbox"** in the navigation
2. You'll see all messages sent by the rules engine
3. Messages show progressive tone ladder:
- **NOTIFIED**: Friendly reminder
- **REMINDER_1**: Neutral follow-up
- **REMINDER_2**: Firm notice
- **ESCALATED**: Policy-based final notice

### Step 4: Simulate Patient Response (2 minutes)
1. In the Message Outbox, find any message with response buttons
2. Click **"💰 Pay Now"** to simulate a payment
- Balance immediately closes
- Payment event is recorded
- Stage advances to CLOSED
3. Try **"⚠️ Dispute"** on another message
- Balance status changes to IN_DISPUTE
- Stage advances to STAFF_REVIEW

### Step 5: View Balance Details (1 minute)
1. Click **"Balances"** in navigation
2. Click **"View Details"** on any balance
3. See complete timeline showing:
- All stage transitions
- All messages sent with full text
- All payment events
- Full audit trail

### Step 6: Generate More Balances (30 seconds)
1. Click **"Admin"** in navigation
2. Set number of balances (e.g., 20)
3. Click **"🔄 Generate Synthetic Balances"**
4. Return to Dashboard to see updated totals
5. Watch terminal logs as rules engine processes new balances

## 🏗️ Architecture

### Tech Stack
- **Backend**: Node.js, Express, TypeScript
- **Database**: SQLite with Prisma ORM
- **Frontend**: React, TypeScript, Vite
- **Styling**: CSS (no frameworks for simplicity)

### Project Structure
```
dental-ar-system/
├── prisma/
│ └── schema.prisma # Database schema
├── src/
│ ├── server/
│ │ ├── index.ts # Express API server
│ │ ├── rulesEngine.ts # Rules evaluation logic
│ │ ├── messageTemplates.ts # Message templates with tone ladder
│ │ └── seed.ts # Database seeding
│ ├── pages/
│ │ ├── Dashboard.tsx # Main dashboard with stats
│ │ ├── Balances.tsx # Balance list with filters
│ │ ├── BalanceDetail.tsx # Balance timeline view
│ │ ├── Outbox.tsx # Message outbox with response simulation
│ │ ├── Admin.tsx # Admin tools
│ │ └── PaymentPage.tsx # Payment portal
│ ├── App.tsx # Main React app
│ ├── App.css # Styles
│ └── main.tsx # React entry point
├── package.json
└── README.md
```

### Database Schema

**Core Entities:**
- `Practice`: Dental practice information
- `Patient`: Synthetic patient data (no PHI)
- `Balance`: Patient balances from PMS sync
- `BalanceState`: Stage history for each balance
- `OutreachEvent`: All messages sent
- `PaymentEvent`: All payments received
- `RuleSet` / `Rule`: Configurable automation rules

## 🔐 Security & Privacy

- **Authentication:** Practice-scoped **login** (hashed password in DB; session via **httpOnly** cookie in normal configuration). See `src/server` auth routes and `LoginPage` for current behavior. Per-user accounts and password reset are tracked in the product backlog (e.g. P3-01, P3-02 in `OUTSTANDING-FIXES-PRODUCT-READY.md`).
- **Dev / demo data:** Seeded patients are **synthetic** (e.g. A01, A02) in typical dev setups—treat as non-production.
- **Communications & payments:** Many flows are still **simulated** or use **test** keys until real integrations and compliance work are complete.
- **Local vs production:** Default README steps assume **localhost**; production requires TLS, strong secrets, and a managed database (see root `docs/ENVIRONMENT-MATRIX.md`).

## 🎨 Key Features

### 1. Rules Engine
- Evaluates all open balances every 60 seconds
- Deterministic stage progression
- Configurable thresholds and timing
- Automatic message sending

### 2. Message Templates
Implements tone ladder appropriate for medical collections:
- **NOTIFIED**: "This is a friendly reminder..."
- **REMINDER_1**: "We wanted to follow up..."
- **REMINDER_2**: "Immediate payment is required..."
- **ESCALATED**: "IMPORTANT NOTICE - Per our practice policy..."

### 3. Dashboard
- Real-time A/R totals
- Aging analysis (0-30, 31-60, >60 days)
- Stage distribution
- Filterable balance list

### 4. Complete Audit Trail
Every action is recorded:
- Stage transitions with timestamps
- Messages sent with full text
- Patient responses (simulated)
- Payment events

### 5. PMS Integration Simulator
- CSV upload ready (not implemented in POC)
- Button to generate synthetic balances
- Simulates "balance created after visit" workflow

## 🔧 Configuration

### Default Rules
The system includes a default rule set (see `src/server/seed.ts`):

1. **Balance Created** → Send NOTIFIED immediately
2. **5 days since NOTIFIED** → Send REMINDER_1
3. **10 days since REMINDER_1** → Send REMINDER_2
4. **20 days since REMINDER_2 OR ≥$500** → ESCALATED + STAFF_REVIEW

### Modifying Rules
Rules are stored in the database and can be edited via the API:
```typescript
PUT /api/rules/:id
{
"conditions": { "days": 7 },
"actionParams": { "templateKey": "REMINDER_1" }
}
```

## 📊 API Endpoints

### Dashboard
- `GET /api/dashboard/stats?practiceId=xxx` - Get dashboard statistics

### Balances
- `GET /api/balances?practiceId=xxx&stage=xxx&minAmount=xxx` - List balances with filters
- `GET /api/balances/:id` - Get balance detail with timeline

### Outreach
- `GET /api/outreach?practiceId=xxx` - List all outreach events
- `POST /api/outreach/:id/respond` - Simulate patient response

### Payments
- `POST /api/pay/:balanceId` - Process payment

### Admin
- `POST /api/admin/generate-balances` - Generate synthetic balances
- `GET /api/practices` - List practices
- `GET /api/rules?practiceId=xxx` - Get rule sets
- `PUT /api/rules/:id` - Update rule

## 🧪 Testing Scenarios

### Scenario 1: New Balance
1. Generate a balance through Admin
2. Watch it immediately receive NOTIFIED message
3. View message in Outbox

### Scenario 2: Aging Balance
1. Use seed data which includes balances 0-45 days old
2. Watch older balances automatically progress through stages
3. Observe tone ladder in messages

### Scenario 3: High-Value Balance
1. Seed includes some $500+ balances
2. These escalate faster per the amount threshold rule
3. See ESCALATED stage even if not 20 days old

### Scenario 4: Payment Flow
1. Click payment link in message
2. Complete payment
3. View updated balance status and timeline

### Scenario 5: Dispute Handling
1. Simulate dispute response in Outbox
2. Balance moves to IN_DISPUTE
3. Stage advances to STAFF_REVIEW

## 💡 Current limitations (not yet “production complete”)

Intentional or in-progress gaps:

1. **Integrations:** Full **PMS** sync (Dentrix, AbelDent, or other systems), production **SMS/email**, and **payment processor** paths are not all wired for production; see `SCREENS-API-DATA-MAP` and Phase 3–4 in `OUTSTANDING-FIXES-PRODUCT-READY.md`.
2. **Identity:** **Practice shared login** today; per-user accounts, RBAC, and password reset are backlog items unless explicitly in scope.
3. **Single-practice focus:** Data model can represent more; **UI** often assumes one practice per deployment.
4. **PMS import:** **CSV** path / UI not fully productized; Admin “generate” supports demos.
5. **Rules engine:** Runs in the **Node** process (not a distributed queue yet).
6. **UI/UX:** Pilot-ready v1 shell (CollectRx green, Inter, dark mode, shared components); Lighthouse and stakeholder sign-off tracked in Phase 5 PRD.
7. **Some UI routes** call APIs not yet on this server (e.g. certain benefits / patient-balance list routes)—see the screens map doc.

## 🚀 Production Considerations

For production deployment, you would need:

1. **Real Integrations**:
- PMS API or HL7 integration (Dentrix, AbelDent, or other systems, depending on the practice)
- Twilio for SMS
- SendGrid for email
- Stripe/Square for payments

2. **Authentication & Authorization**:
- User accounts with roles
- Practice/office level permissions
- Audit log access controls

3. **Scalability**:
- Move to PostgreSQL
- Distributed task queue (Bull/BullMQ)
- Multiple worker processes

4. **Compliance**:
- HIPAA compliance measures
- Encrypted data at rest and in transit
- Comprehensive audit logs
- BAA agreements with all vendors

5. **UX Improvements**:
- Real-time updates via WebSocket
- CSV upload UI
- Advanced rule builder
- Reporting and analytics

## 📝 License

MIT License - This is demonstration code for evaluation purposes.

## 🤝 Support

This POC demonstrates the core concept of an A/R execution engine. For questions or to discuss production implementation, please contact the development team.

---

**Built with ❤️ to improve dental practice A/R management**
