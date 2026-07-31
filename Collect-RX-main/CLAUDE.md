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

# Run the backend server (Express on port 3000)
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

# Abeldent schema discovery (requires access to AbelDent SQL Server and `npm install mssql`)
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

## Seeding (Multi-Tenant)

Both `db:seed` and `demo:seed` create generic, reusable test practices — not specific to any pilot or demo.

**Baseline seed (empty practice):**
```bash
npm run db:seed
# Creates "CollectRx Demo Practice" with login only (no claims)
```

**Demo seed (rich insurance data):**
```bash
npm run demo:seed
# Creates "CollectRx Demo Practice" with 60+ claims across all statuses, carriers, and recovery routes
```

**Customization via environment variables:**
```bash
SEED_PRACTICE_NAME="My Clinic" npm run demo:seed
SEED_PRACTICE_EMAIL="admin@myclinic.local" npm run demo:seed
SEED_PRACTICE_PASSWORD="custom_password" npm run demo:seed
```

**Test call (Vapi agent test script):**
```bash
node test-call.js
# Dials your phone with a dummy claim, using "CollectRx Demo Practice" as the practice name
```

Customize practice info for test calls:
```bash
VAPI_PRACTICE_NAME="My Clinic" node test-call.js
VAPI_PRACTICE_ADDRESS="123 Main St, Toronto" node test-call.js
VAPI_PRACTICE_PHONE="416-555-0100" node test-call.js
```

---

## Branch strategy & PRD coding standards

### Branch flow

```
feature/* → dev (CI gate: typecheck + tests) → prd (strict gate: all checks below)
```

- **`dev`** — integration branch. Feature branches merge here. CI must pass.
- **`prd`** — production. Only receives merges from `dev`. Every item below must be true before touching prd-bound code.

**Enforcement:** these rules aren't just documentation. `.githooks/pre-push` (installed automatically via `npm install`'s `prepare` script) runs the same audit/typecheck/lint/test/build sequence as CI's `verify` job before every push — a violation should never reach GitHub in the first place. CI's `verify` job is the backstop of record if the local hook is bypassed (`git push --no-verify`) or its checks drift out of sync with CI's.

**Standing rule for any coding agent working in this repo:** keep `.githooks/pre-push` in lockstep with `.github/workflows/collectrx-ci.yml`'s `verify` job. Whenever that job's steps, env vars, or thresholds change, update the hook in the same PR — a gate out of sync with CI produces false negatives (blocks nothing real) or false positives (blocks pushes CI would accept), and either erodes trust in the gate until `--no-verify` becomes a habit instead of an emergency escape hatch. Before calling the gate "matches CI," prove it against real branch state, not a dry-run summary: run it against a branch with a known-current CI-blocking condition and confirm it fails at the right step for the right reason; run it against that condition's fix and confirm it passes end-to-end, not just the one step that changed. A step that "passes" only because it silently didn't run (wrong working directory, wrong workspace command, a skipped step) is a false pass — confirm the actual reason for green, not just the exit code. If a step needs something the local machine doesn't have (a live Postgres, Docker), don't silently skip it — name it explicitly as "CI still catches this," here and in the hook's own header comment. When the PRD standards above change, check whether the change needs a corresponding automated check or is enforced some other way (code review, a type system guarantee) — a rule that exists only as prose drifts from what's actually enforced.

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
- Vapi `metadata` carries UUID tokens only — never patient names, DOBs, or health card numbers.
- PHI needed for carrier lookup crosses only as ephemeral Vapi call `variables` at dispatch time (Option B — see `docs/compliance/PHI-VAPI-BOUNDARY.md`): detokenized server-side in `initiateCall()`, never stored, never logged, deleted from Vapi post-call.
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
Express backend  src/server/index.ts  (Fly.io app `collect-rx`, port 3000)
    ↓
Prisma ORM → PostgreSQL (Fly.io)
    ↓
Vapi.ai voice agents (4-agent squad via Vapi API)
    ↓
Twilio (telephony — calls to carriers)
```

### Vapi Voice Squad

Five agents are orchestrated as a squad — they hand off to each other mid-call:

- **IVR_Navigator** — dials carrier IVR, navigates menus to reach claim status; silent, DTMF-only, never converses
- **Hold_Sentinel** — silently waits through hold music/queue messages after IVR navigation completes, hands off to Claims_Agent the moment a live human speaks; never converses
- **Claims_Agent** — speaks with a rep, gathers claim status and reason codes, delivers the CRTC disclosure (`docs/compliance/crtc-disclosure-decision.md`)
- **Escalation_Closer** — handles denied/disputed claims requiring radiographic or clinical documentation
- **Resolution_Closer** — confirms payment, closes everything else

(Corrected 2026-07-30 — this section previously omitted Hold_Sentinel. See `tasks/lessons.md` 2026-07-30 entry for how that was found.)

The squad receives UUID tokens in `metadata` — never PHI there. Patient identifiers required for carrier lookup are injected as ephemeral Vapi call `variables` at dispatch time only (Option B — see `docs/compliance/PHI-VAPI-BOUNDARY.md`); piiVault detokenizes server-side before the call, and nothing PHI-bearing is stored or logged.

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

Abeldent Local Plus is dental practice management software running on SQL Server at the practice site.

1. `scripts/discover-schema.cjs` — introspects SQL Server → `schema-discovery.json` (list of tables/columns).
2. `schema-map.example.json` — copy to `schema-map.json`, align names with discovery output.
3. `scripts/sync-query-builder.cjs` — `--validate` checks the map against discovery; `--emit-queries` writes JSON with the exact SQL strings.
4. `desktop/services/abeldent-sync.js` — set `ABELDENT_SCHEMA_MAP` to your `schema-map.json`; sync POSTs to the Fly.io API.

---

## Critical safety rules

### PHI Boundary
PHI (patient names, DOBs, health card numbers) **never crosses to Vapi metadata** — UUID tokens only there. Identifiers carriers require to locate a claim are injected as **ephemeral Vapi call variables** at dispatch time only (Option B — decision record in `docs/compliance/PHI-VAPI-BOUNDARY.md`): detokenized server-side in `initiateCall()`, never written to any DB table or log, recording disabled, and deleted from Vapi after the call. Violating this boundary breaks PHIPA/PIPEDA compliance.

### CARRIER_BLOCK Protocol
If a carrier detects automation, **all calls to that carrier are suspended immediately** — not just the current call. This is the most critical operational safety rule. Any code that touches call scheduling, retry logic, or Vapi webhooks must respect the CARRIER_BLOCK flag in the database before proceeding.

### Call Rules
- Calls only Mon–Fri 8am–5pm Eastern time
- Maximum 3 call attempts per claim
- Claims under 30 days old: do not enter queue
- Claims over 90 days old: skip AI, escalate to human immediately

### CRTC Compliance — AI Disclosure
CollectRx calls are ADAD non-solicitation (CRTC UTR Part IV Rule 4). Disclosure of automated nature, practice name, and callback number is mandatory within 10 seconds of a live representative answering. The compliance decision, canonical disclosure script, and list of invalid Validation Playbook language are recorded in `docs/compliance/crtc-disclosure-decision.md`. Any instruction to sound human or evade identification is invalid for Canadian operations.

---

## Database

PostgreSQL on Fly.io, accessed via Prisma. Schema migrations for the eligibility engine are in `migrations/eligibility-schema.sql` — run directly against the database via `fly postgres connect` or `psql $DATABASE_URL -f migrations/eligibility-schema.sql`.

Key tables: `eligibility_snapshots`, `eligibility_estimates`, `estimate_procedures`, `deductible_tracking`, `annual_max_tracking`, `reconciliation_logs`.

---

## Windows build & deployment

The Electron app is packaged as a signed NSIS `.exe` installer for AbelDent-connected practices. CI builds it on `windows-latest` (required for NSIS + code signing). Code signing uses `CSC_LINK` and `CSC_KEY_PASSWORD` secrets. Releases are drafted on GitHub; `electron-updater` delivers future versions automatically on next launch.

Never ship an unsigned build to the pilot site.

---

## Adding a new carrier

1. Add an entry to `src/services/eligibility/rules/carrier-configs.json` following the existing structure
2. Add the carrier ID to the `Carrier` enum in `src/services/eligibility/types.ts`
3. Add test cases to `tests/eligibility.test.ts` covering the new carrier's deductible, annual max, and coverage tiers
4. Update `CARRIER_NAME_MAP` in `scripts/sync-query-builder.js` if the carrier name appears in Abeldent data
