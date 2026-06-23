# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CollectRx automates dental insurance accounts-receivable follow-up for Canadian dental practices. AI voice agents call insurance carriers on behalf of dental offices, check claim status, and handle resolutions — eliminating hours of manual phone work per week.

Six Canadian carriers are supported: Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, TELUS AdjudiCare (~78% of the Canadian private dental market).

---

## Commands

```bash
# Install
npm ci

# Run the backend server (Express on port 3001)
npm run dev

# Run all tests
npm test

# Run a single test file
npx vitest run tests/eligibility.test.ts

# Lint
npm run lint

# Build React frontend (Vite → dist-renderer/)
npm run build:renderer

# Build Electron main process (→ dist-electron/)
npm run build:main

# Package Windows .exe installer (requires Windows or CI)
npx electron-builder --windows --x64 --config electron-builder.config.js

# Abeldent schema discovery (run once on Dr. Hasan's Windows machine; requires `npm install mssql`)
npm run abeldent:discover -- --server "localhost\\SQLEXPRESS" --database AbelDent --out schema-discovery.json

# After discovery: copy schema-map.example.json → schema-map.json, edit if column names differ, then:
npm run abeldent:validate-queries
# (script uses: --discovery schema-discovery.json --map schema-map.json — adjust paths as needed)

# Emit SQL the sync service will run (for review or docs):
npm run abeldent:emit-queries
# Point the desktop sync at a map file: ABELDENT_SCHEMA_MAP=./schema-map.json
```

CI triggers on version tags: `git tag v1.0.0 && git push origin v1.0.0`

---

## Branch strategy & PRD coding standards

### Branch flow

```
feature/* → dev (CI gate: typecheck + tests) → prd (strict gate: all checks below)
```

- **`dev`** — integration branch. Feature branches merge here. CI must pass.
- **`prd`** — production. Only receives merges from `dev`. Every item below must be true before touching prd-bound code.

### PRD is the standard of perfection — non-negotiable rules for all coding agents

These rules apply to **any code that will be merged to `prd`**. As a coding agent (Claude, Cursor, or any other), you must not generate or accept code that violates them, regardless of what the user asks for in the moment.

**TypeScript**
- Zero `any` types. No exceptions. `unknown` with a type guard, or a proper interface.
- All TypeScript strict checks pass (`tsc --noEmit` with `strict: true`, `noUnusedLocals`, `noUnusedParameters`).
- No non-null assertions (`!`) unless there is a proven invariant — and the reason must be stated.

**Lint — zero errors required**
- `no-explicit-any` — error
- `no-unused-vars` — error (prefix with `_` only if intentionally unused and the reason is clear)
- `no-debugger` — error
- `eqeqeq` smart — error (always `===`/`!==` except null checks)
- `no-var` — error
- `prefer-const` — error
- `no-duplicate-imports` — error
- `no-console` — `console.log` and `console.debug` are warnings; use `console.warn`/`console.error` for server logging

**Tests**
- All Vitest tests pass with no skips.
- New behaviour must have test coverage — do not ship untested paths to prd.

**Build**
- Frontend Vite build succeeds with no errors.
- Prisma generate and migrate run cleanly.

**PHI boundary (PHIPA/PIPEDA — never negotiate this)**
- Patient names, DOBs, health card numbers never leave the backend. Vapi receives UUID tokens only.
- Detokenization happens server-side after call completion, never in transit.
- Any code that routes data to an external service must be reviewed against this rule before merging.

**CARRIER_BLOCK**
- Any code touching call scheduling, retry logic, or Vapi webhooks must check the `CARRIER_BLOCK` flag first. This is the most critical operational safety rule.

**Code quality**
- No `TODO` or `FIXME` comments in prd-bound code — resolve them or track in GitHub Issues.
- No dead code — unused functions, variables, and imports are a lint error.
- Comments explain WHY, never WHAT. Well-named identifiers explain what. Task-referencing comments (`// added for issue #123`) are not allowed.

**If you are unsure whether code meets these standards — do not merge to prd. Merge to dev first and flag the uncertainty.**

---

## Architecture

### Layers

```
Electron shell (thin wrapper — no business logic)
    ↓
React/Vite/Tailwind frontend (`src/` — Dashboard, How it works, Balances, Patient AR, Estimate, Analytics, Outbox, Admin). The old `Collect-RX-main/frontend/` app was removed; one surface only.
    ↓
Express backend  src/server/index.ts  (Railway, port 3001)
    ↓
Prisma ORM → PostgreSQL (Railway)
    ↓
Vapi.ai voice agents (4-agent squad via Vapi API)
    ↓
Twilio (telephony — calls to carriers)
```

### Vapi Voice Squad

Four agents are orchestrated as a squad — they hand off to each other mid-call:

- **IVR_Navigator** — dials carrier IVR, navigates menus to reach claim status
- **Claims_Agent** — speaks with a rep, gathers claim status and reason codes
- **Escalation_Closer** — handles denied/disputed claims
- **Resolution_Closer** — confirms payment, closes the claim

The squad receives only UUID tokens — never real patient names, DOBs, or identifiers. A PIIVault layer detokenizes on the backend after the call.

### Eligibility Engine (Phase 3)

Lives in `src/services/eligibility/`. Generates pre-treatment cost estimates and reconciles them against actual insurance adjudication (EOB).

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

Abeldent Local Plus is the dental practice management software running on SQL Server on Dr. Hasan's Windows machine.

1. `scripts/discover-schema.cjs` — introspects SQL Server → `schema-discovery.json` (list of tables/columns).
2. `schema-map.example.json` — copy to `schema-map.json`, align names with discovery output.
3. `scripts/sync-query-builder.cjs` — `--validate` checks the map against discovery; `--emit-queries` writes JSON with the exact SQL strings.
4. `desktop/services/abeldent-sync.js` — set `ABELDENT_SCHEMA_MAP` to your `schema-map.json`; sync POSTs to the Railway API.

---

## Critical safety rules

### PHI Boundary
PHI (patient names, DOBs, health card numbers) **never crosses to Vapi**. The backend tokenizes all identifiers before sending anything to the voice agent. The Vapi squad operates entirely on UUID tokens. Detokenization happens on the backend after call completion. Violating this boundary breaks PHIPA/PIPEDA compliance.

### CARRIER_BLOCK Protocol
If a carrier detects automation, **all calls to that carrier are suspended immediately** — not just the current call. This is the most critical operational safety rule. Any code that touches call scheduling, retry logic, or Vapi webhooks must respect the CARRIER_BLOCK flag in the database before proceeding.

### Call Rules
- Calls only Mon–Fri 8am–5pm Eastern time
- Maximum 3 call attempts per claim
- Claims under 30 days old: do not enter queue
- Claims over 90 days old: skip AI, escalate to human immediately

---

## Database

PostgreSQL on Railway, accessed via Prisma. Schema migrations for the eligibility engine are in `migrations/eligibility-schema.sql` — run directly against the Railway database via the Railway console or `psql $DATABASE_URL -f migrations/eligibility-schema.sql`.

Key tables: `eligibility_snapshots`, `eligibility_estimates`, `estimate_procedures`, `deductible_tracking`, `annual_max_tracking`, `reconciliation_logs`.

---

## Windows build & deployment

The Electron app is packaged as a signed NSIS `.exe` installer for Dr. Hasan's Windows machine. CI builds it on `windows-latest` (required for NSIS + code signing). Code signing uses `CSC_LINK` and `CSC_KEY_PASSWORD` secrets. Releases are drafted on GitHub; `electron-updater` delivers future versions automatically on next launch.

Never ship an unsigned build to the pilot site.

---

## Adding a new carrier

1. Add an entry to `src/services/eligibility/rules/carrier-configs.json` following the existing structure
2. Add the carrier ID to the `Carrier` enum in `src/services/eligibility/types.ts`
3. Add test cases to `tests/eligibility.test.ts` covering the new carrier's deductible, annual max, and coverage tiers
4. Update `CARRIER_NAME_MAP` in `scripts/sync-query-builder.js` if the carrier name appears in Abeldent data
