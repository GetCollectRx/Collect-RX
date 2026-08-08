# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation source of truth (read this first)

This repo has more than one doc claiming to describe "current state." When they conflict, this is the order of authority:

1. **This file** — repo-root overview, monorepo layout, standing rules that apply everywhere.
2. **[`Collect-RX-main/CLAUDE.md`](Collect-RX-main/CLAUDE.md)** — authoritative for anything under `Collect-RX-main/` (commands run from that directory, PRD coding/merge-gate standards, CRTC disclosure rule). If you're working inside `Collect-RX-main/`, that file's rules apply in addition to this one.
3. **[`docs/operations/PATH-TO-DELIVERY.md`](docs/operations/PATH-TO-DELIVERY.md)** — the single live launch-readiness tracker. It is kept current. `OUTSTANDING-FIXES-PRODUCT-READY.md` is a **ticket backlog for reference**, not a status source — its phase-status stamps are historical snapshots and may lag reality; PATH-TO-DELIVERY wins on anything both describe.
4. **Dated documents** (filenames or headers with a specific date, e.g. `*-2026-05-29.md`, `ENGINEERING-AUDIT-*`, `EMAIL_VALIDATION_REPORT.md`) are **point-in-time records**, not living docs. Treat them as history, not instructions — don't follow setup/deploy steps from them without checking they still match this file and PATH-TO-DELIVERY.
5. `EXECUTION_STATE.md` and `ACTIVATION_CHECKLIST.md` are **retired/archived** (see notices at the top of each) — they described a specific July 2026 campaign push that is over. Do not follow their deploy targets or "ready" claims.

If you find this file itself out of date, fix it in the same change — don't leave a second stale copy of the truth.

## What this is

CollectRx automates dental insurance accounts-receivable follow-up for Canadian dental practices. AI voice agents call insurance carriers on behalf of dental offices, check claim status, and handle resolutions — eliminating hours of manual phone work per week.

Six Canadian carriers are supported: Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, TELUS AdjudiCare (~78% of the Canadian private dental market).

Product boundary: **Practice → Insurance AR recovery + practice SaaS Billing only.** Patient/client payment collection (Stripe Connect, pay links) is retired/out of scope — see `docs/operations/PATH-TO-DELIVERY.md`.

---

## Which codebase is canonical

**`Collect-RX-main/` is the canonical, shipping application** (Vite + React frontend, Express + Prisma backend, PostgreSQL). See [ADR 0001](docs/adr/0001-primary-application-stack.md).

The **repository-root** `src/api` + `src/frontend` is a **deprecated prototype** with an in-memory database — not what ships, not the target for new product work. See [`docs/DEPRECATION.md`](docs/DEPRECATION.md). Don't build features there; if you have an idea worth keeping, port it into `Collect-RX-main/`.

This repo is an **npm workspace**: root `package.json` wraps the `Collect-RX-main` workspace. Root-level commands are namespaced (`*:collectrx` or `-w dental-ar-system`); the unnamespaced short forms (`npm run dev`, `npm test`, `npm run lint`, `npm run abeldent:*`, etc.) only exist when you `cd Collect-RX-main` first — see that package's own `CLAUDE.md` for the direct forms.

---

## Architecture: Multi-Tenant SaaS

CollectRx is a **generic platform for any Canadian dental practice**, not a single-practice tool.

**Standing rules:**
- **No hardcoded practice names, emails, or credentials in code** — this includes seed scripts, demos, defaults, and documentation examples
- **Seeds create generic test practices** — practice name is configurable via `SEED_PRACTICE_NAME` env var (default: "CollectRx Demo Practice"); email uses `SEED_PRACTICE_EMAIL` (default: "demo@collectrx-test.local")
- **Real onboarding flow:** user signs up → creates their own practice via UI → 30-day trial (500 min/month, 50 min/day, no card) → imports patient data (CSV or PMS connector) → upgrades to a paid tier via Stripe Billing when ready
- **Fixtures and seeds are for testing system logic**, not for branding a specific practice or pilot demo

This applies retroactively: references to specific-practice language in code (a named clinic, a named owner's machine) should be treated as technical debt and removed or generalized.

---

## Commands (from repo root)

```bash
# Install (root — links the Collect-RX-main workspace)
npm ci

# API + Vite (+ worker + Redis when REDIS_URL is set) — the canonical app
npm run dev

# Typecheck, lint, test, production build — run before PRs
npm run ci:collectrx

# Prisma migrations against Collect-RX-main
npm run db:migrate:collectrx        # deploy
npm run db:migrate:dev:collectrx    # dev
npm run db:seed:collectrx

# Package the Electron desktop app (AbelDent-connected practices only)
npm run build:electron:win
```

CI triggers on version tags: `git tag v1.0.0 && git push origin v1.0.0`

For direct/unnamespaced commands (`npm run dev`, `npm test`, `npm run lint`, `npm run abeldent:discover`, etc.), run them from inside `Collect-RX-main/` — see [`Collect-RX-main/CLAUDE.md`](Collect-RX-main/CLAUDE.md).

---

## Architecture

### Layers

```
Electron shell (thin wrapper — no business logic)
    ↓
React/Vite/Tailwind frontend (Collect-RX-main/src — Dashboard, How it works, Balances, Estimate, Analytics, Outbox, Billing, Admin)
    ↓
Express backend  Collect-RX-main/src/server/index.ts  (Fly.io app `collect-rx`, port 3000)
    ↓
Prisma ORM → PostgreSQL (Fly.io)  +  Redis-backed worker queue (BullMQ) for background jobs
    ↓
Vapi.ai voice agents (4-agent squad via Vapi API)
    ↓
Twilio (telephony — calls to carriers)
```

Two subsystems live alongside the core AR flow and aren't captured above:
- **Billing** (`prisma/schema.prisma`: `BillingTier`, `UsagePeriod`) — trial limits, Core/Growth/Scale tiers via Stripe Billing, overage handling, COGS breaker. Gates call volume the same way CARRIER_BLOCK does — see Critical safety rules below.
- **Marketing/growth engine** (`Collect-RX-main/src/server/marketing/`) — prospect harvesting, email campaign scheduler, AI outreach calls, reply intelligence, referral engine. Self-serve acquisition, separate from the carrier-calling product itself.

### Vapi Voice Squad

Five agents are orchestrated as a squad — they hand off to each other mid-call:

- **IVR_Navigator** — dials carrier IVR, navigates menus to reach claim status; silent, DTMF-only, never converses
- **Hold_Sentinel** — silently waits through hold music/queue messages after IVR navigation completes, hands off to Claims_Agent the moment a live human speaks; never converses
- **Claims_Agent** — speaks with a rep, gathers claim status and reason codes
- **Escalation_Closer** — handles denied/disputed claims
- **Resolution_Closer** — confirms payment, closes the claim

(Corrected 2026-07-30 — this section previously omitted Hold_Sentinel. See `Collect-RX-main/tasks/lessons.md` 2026-07-30 entry.)

The squad receives UUID tokens in metadata — never real patient names, DOBs, or identifiers in metadata. Patient identifiers required for carrier lookup are injected as **ephemeral Vapi call variables** at dispatch time only (Option B — see `Collect-RX-main/docs/compliance/PHI-VAPI-BOUNDARY.md`). Detokenization happens on the backend before the call; PHI is never stored in logs or the database.

### Eligibility Engine (Phase 3)

Lives in `Collect-RX-main/src/services/eligibility/`. Generates pre-treatment cost estimates and reconciles them against actual insurance adjudication (EOB).

```
engine.ts              — orchestrates the estimate pipeline
types.ts               — all TypeScript interfaces and enums
rules/
  carrier-configs.json — carrier benefit rules (coverage %, deductibles, annual max)
  cdt-codes.ts         — 300+ CDT code → tier mappings (preventive/basic/major/ortho)
  deductible.ts        — per-procedure deductible application, preventive waiver
  annual-max.ts        — individual and family annual max tracking
  cob.ts               — COB calculation, birthday rule, TELUS TPA identification
reconciliation.ts      — compare estimate vs. actual, flag variances >$50
```

**Key design rule:** Carrier rules are data, not code. To update a carrier's coverage percentages, deductibles, or waiting periods — edit `carrier-configs.json` only. No code deployment needed.

**Estimate math:** Insurer pays `coverage% × (fee − deductible)`. Deductible is the patient's first-dollar responsibility and reduces the insured base, not the patient total directly. Patient pays `fee − netInsurancePays`.

**TELUS AdjudiCare** is a clearinghouse, not a single insurer. Before routing any IVR call to TELUS, identify the underlying TPA from the group number prefix via `identifyTelusPlan()`. TELUS minimum claim wait is day 21 (vs. day 32 for all other carriers).

### Abeldent Connector (Phase 4)

AbelDent is one supported PMS connector. It is optional. New practices onboard via CSV (see CSV Import below). The AbelDent connector is only active when `ABELDENT_SCHEMA_MAP` is set. The server starts and runs fully without it.

When AbelDent access is available (run from `Collect-RX-main/`):
1. `scripts/discover-schema.cjs` — introspects SQL Server → `schema-discovery.json` (list of tables/columns).
2. `schema-map.example.json` — copy to `schema-map.json`, align names with discovery output.
3. `scripts/sync-query-builder.cjs` — `--validate` checks the map against discovery; `--emit-queries` writes JSON with the exact SQL strings.
4. `desktop/services/abeldent-sync.cjs` — set `ABELDENT_SCHEMA_MAP` to your `schema-map.json`; sync POSTs to the Fly.io API.

### CSV Import (Primary Onboarding Path)

For practices without AbelDent (the majority of new onboarding), CSV is the primary data path. The full pipeline is built:

- `src/server/csv/parseSimple.ts` — parses and validates CSV with column alias mapping
- `src/server/pms/pmsImportPipeline.ts` — parse → validate → Prisma upsert → sync to work queue
- `src/server/pms/pmsRegistry.ts` — `other` (generic CSV) is a valid vendor with `importFamily: 'generic'`, `supportsDesktopConnector: false`

A practice can be fully onboarded via CSV with no desktop app required. The Electron app is only needed for AbelDent-connected practices.

---

## Critical safety rules

### PHI Boundary
PHI (patient names, DOBs, health card numbers) **never crosses to Vapi metadata**. UUID tokens only in metadata. Ephemeral PHI in call `variables` at dispatch time only (see `Collect-RX-main/docs/compliance/PHI-VAPI-BOUNDARY.md`). Detokenization happens server-side before the call. Violating this boundary breaks PHIPA/PIPEDA compliance.

### CARRIER_BLOCK Protocol
If a carrier detects automation, **all calls to that carrier are suspended immediately** — not just the current call. This is the most critical operational safety rule. Any code that touches call scheduling, retry logic, or Vapi webhooks must respect the CARRIER_BLOCK flag in the database before proceeding.

### Call Rules
- Calls only Mon–Fri 8am–5pm Eastern time
- Maximum 3 call attempts per claim
- Claims younger than the carrier's minimum wait do not enter queue (21 days for TELUS AdjudiCare, 32 days for all other carriers — see `carrier-configs.json`)
- Claims over 90 days old: skip AI, escalate to human immediately
- Billing/usage limits (trial caps, overage-pending, payment failure) also pause calling — see the Billing lifecycle section in `docs/operations/PATH-TO-DELIVERY.md`

---

## Database

PostgreSQL on Fly.io, accessed via Prisma. Migrations live in `Collect-RX-main/prisma/migrations/` and are applied with `npm run db:migrate:collectrx` (`prisma migrate deploy`) — not ad-hoc `psql -f`.

Key eligibility tables: `eligibility_snapshots`, `eligibility_estimates`, `estimate_procedures`, `deductible_tracking`, `annual_max_tracking`, `reconciliation_logs`. Billing tables: `UsagePeriod` and the `billingTier` field on the practice model.

---

## Windows build & deployment

The Electron app is packaged as a signed NSIS `.exe` installer for AbelDent-connected practices. CI builds it on `windows-latest` (required for NSIS + code signing). Code signing uses `CSC_LINK` and `CSC_KEY_PASSWORD` secrets. Releases are drafted on GitHub; `electron-updater` delivers future versions automatically on next launch.

Never ship an unsigned build to a pilot practice.

---

## Adding a new carrier

1. Add an entry to `Collect-RX-main/src/services/eligibility/rules/carrier-configs.json` following the existing structure
2. Add the carrier ID to the `Carrier` enum in `Collect-RX-main/src/services/eligibility/types.ts`
3. Add test cases to `tests/eligibility.test.ts` covering the new carrier's deductible, annual max, and coverage tiers
4. Update `CARRIER_NAME_MAP` in `Collect-RX-main/scripts/sync-query-builder.cjs` if the carrier name appears in Abeldent data
