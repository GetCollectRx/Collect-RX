# TO DO — remaining open items (verified against repo 2026-07-19)

Instructions for the agent working this list: work top to bottom within a section. Each task lists the files involved and a done-when. Do NOT touch anything in the "Human / ops only" section. No live vendor credentials are available — everything here must be provable with local tests or CI config alone. Canonical app code lives in `Collect-RX-main/` (a subdirectory of this repo root — all paths below are relative to repo root and were verified to exist; if one is missing, search before creating anything).

## Execution decisions (pre-answered — do not re-ask)

- **Order:** A → B → C → D, stop after D. Section E only when Khalid directs; section F never.
- **Deletions in A are approved**, with the guardrails written into each task (diff/grep first). Nothing else gets deleted opportunistically.
- **Proof standard:** `npm test` + lint by default. Run the dev server only for runtime-observable changes: CSP (confirm login → dashboard loads with header present), runbook pages, Day-30 dashboard page.
- **Section B:** add the CI step AND triage findings — never land a red gate. Trivial CVE upgrades yes; non-trivial ones documented in `docs/security/npm-audit-exceptions.md`.
- **Section D:** full features with mocked transports (no live keys exist). Email/SMS: real metrics from seeded data, transport mocked in tests, jobs gated behind env flags.
- **Carrier JSON migration:** update all tests referencing the hardcoded literals, but values must not change (TELUS day 21, others day 32) — tests assert them via the JSON config path.
- **Commits:** one commit per task. NEVER push to remote — Khalid pushes.
- **Skips:** none in A–D. If the Stripe webhook E2E needs deep signature plumbing, do it last within C rather than blocking Redis/axe.

## A. Quick cleanups (do first, ~1 hour total)

- [ ] **Delete duplicate test file with space in name**
  `Click-main/tests/phase3/estimateCalculator.test 2.ts` is an accidental copy. Diff it against `estimateCalculator.test.ts` in the same folder; if identical or stale, delete it. (Ignore the copy under `.claude/worktrees/` — that dir is not part of the repo.)
  Done when: no `* 2.ts` files remain outside `.claude/`.

- [ ] **Verify and remove deprecated Vapi webhook handler**
  `Collect-RX-main/src/server/index.ts:105` imports the live handler from `../webhooks/vapi`. `Collect-RX-main/src/server/vapi/vapiWebhook.ts` may be the deprecated one (see comment at `index.ts:67`). Grep for all imports of `vapiWebhook.ts`; if only tests/comments reference it, delete it and fix references.
  Done when: one Vapi webhook handler in tree, `npm test` green.

## B. Security quick wins (code, no credentials needed)

- [ ] **Enable CSP** — `Collect-RX-main/src/server/index.ts:193` has `contentSecurityPolicy: false` in the helmet config. Replace with an explicit directives object appropriate for an API + Vite SPA (default-src 'self'; allow the frontend's needs — check what the served renderer actually loads before writing directives). Follow the standing rule: check current helmet docs for the canonical CSP config first.
  Done when: CSP header present, app still loads (login → dashboard) in dev, tests green.

- [ ] **npm audit gate in CI** — add an `npm audit --omit=dev --audit-level=high` step to `.github/workflows/collectrx-ci.yml`. If existing CVEs fail it, triage: upgrade where trivial, otherwise record documented exceptions in a `docs/security/npm-audit-exceptions.md` and use an ignore mechanism (e.g. `better-npm-audit` or audit-level tuning) rather than skipping the gate.
  Done when: CI has a failing-on-new-high-CVE audit step.

- [ ] **Semgrep SAST in CI** — a parked config exists at `docs/_parking/ci-collectrx.yml`. Port the Semgrep job into `.github/workflows/collectrx-ci.yml` (use `returntocorp/semgrep-action` or `semgrep ci` with default rulesets `p/typescript`, `p/owasp-top-ten`). Triage any findings; suppress with inline comments only with justification.
  Done when: Semgrep job runs in CI on PRs.

## C. CI coverage gaps

- [ ] **Redis/BullMQ paths in CI** — `REDIS_URL` is cleared in the vitest setup, so worker/queue code is never exercised. Add a `services: redis` container to the CI workflow and a test job (or vitest project) that runs the BullMQ worker paths against it. Keep the default unit-test job Redis-free.
  Done when: at least one queue enqueue→process test runs in CI against real Redis.

- [ ] **Stripe Billing webhook E2E in CI** — verify whether Playwright/e2e covers the Stripe webhook path (practice SaaS billing only — patient pay is out of scope, removed). If not, add an integration test that POSTs a signed test-mode webhook payload (use Stripe's signature scheme with a test secret from env/fixture) to the webhook route and asserts idempotency (same event twice → one state change).
  Done when: webhook happy path + replay test green in CI.

- [ ] **axe accessibility checks in Playwright** — add `@axe-core/playwright` to the e2e suite for the login and claims/dashboard pages (not payment pages — none exist). Fail on WCAG A/AA violations; document any justified exclusions.
  Done when: axe assertions run in the e2e job.

## D. Product gaps (code exists partially; these are real feature work)

- [ ] **Carrier rules → JSON only** — `Collect-RX-main/src/carriers/adapter.ts` still hardcodes per-carrier behavior (`minWaitDays: 32` etc. at lines ~75-86) while `carriers/*.json` also exists. Move `minWaitDays`, IVR hints, and other per-carrier constants into the JSON configs and make `adapter.ts` read them, so mid-pilot carrier tweaks need no deploy. Per project rules: carrier rules are data, not code. Keep TELUS day-21 vs others day-32 behavior identical; add/extend tests locking those values.
  Done when: no per-carrier literals in adapter.ts, all carrier tests green.

- [ ] **Weekly pilot report email** — PRD requires a weekly automated report to the practice owner (calls placed, claims resolved, revenue recovered). The roi-proof / practice-time-savings agents run on cron but never email anyone. Build a scheduled job in `Collect-RX-main/src/server/agents/scheduledAgents.ts` (or a sibling service) that assembles those metrics per practice and sends via the existing SendGrid email service. Recipient = practice owner email from the Practice record — no hardcoded names/emails (multi-tenant rule). Gate behind an env flag since no practice is live yet.
  Done when: job renders + sends (test-mode/mock transport in tests), covered by a unit test.

- [ ] **Assumption validation dashboard (Day 30/60/90)** — no `assumptionValidation`/day-30 code paths exist. Build an API endpoint + simple frontend page reporting: carrier acceptance rate, resolution rate (target ≥60%), ROI vs subscription, per the Phase 7 PRD acceptance criteria. Reuse existing analytics queries where possible.
  Done when: endpoint returns the three metrics from seeded data; page renders them.

- [ ] **Carrier block → SMS alert integration test** — `carrierBlockService` exists but there is no dedicated end-to-end test proving a CARRIER_BLOCK event triggers the operator SMS path. Write an integration test that fires a block event and asserts the Twilio client (mocked) is called with the alert. Do not place real calls.
  Done when: test green; any wiring gaps it exposes are fixed.

- [ ] **Pilot runbook pages in-app** — go-live checklist, practice FAQ, rollback procedure exist only as docs/agent prompts. Surface them as read-only in-app pages (Admin section). Generic content only — no practice-specific names (multi-tenant rule).
  Done when: pages render from the doc content; lint/tests green.

## E. Larger builds (only start when directed — each is multi-day)

- [ ] **Dentrix file-drop watcher** (EPIC-45, ~5-8 days) — no watcher code exists (no chokidar/file-drop anywhere). Dentrix has no LAN SQL; design: desktop service watches an export folder and POSTs parsed rows to `/api/connector/claims/import`, reusing `pmsImportPipeline.ts` and `parseExportRows.ts` (Dentrix row parsing already partially exists there). Register vendor properly in `pmsRegistry.ts`.

- [ ] **Open Dental MySQL connector** (EPIC-46, ~10-15 days) — same pattern as AbelDent connector (schema-map + desktop worker) with a MySQL driver instead of MSSQL. Only registry/type stubs exist today.

- [ ] **Write-back payload templates** (EPIC-47 follow-up, ~3 days) — desktop currently runs raw `payload.sql` on-prem. Replace with structured templates (table, fields, values) validated against the schema map, so write-back is vendor-agnostic and safer.

## F. Human / ops only — DO NOT attempt as an agent

- Tag `v1.0.1-pilot` + push (repo has `v1.0.0-pilot` only; tagging triggers CI release — Khalid must decide timing)
- ITRANS 2 / CDAnet Tx23 live gateway (`cdanetTx23Client.ts` is an `itrans_unconfigured` scaffold — needs real credentials)
- Canada Life providerConnect live proof (needs credentials)
- IVR nav-test / squad navigation validation (paid Twilio calls — operator-run: `IVR_KILL_TEST_CONFIRM_PAID_TWILIO=1 npm run ivr:nav-test -- --carrier sun_life`)
- Telus TPA config expansion (needs verified real phone numbers)
- BAAs/DPAs, pen test scheduling, counsel review of Terms/Privacy/collections copy
- Sentry DSN, uptime alerts, backup restore drill, Fly secrets rotation
- AbelDent schema discovery (needs a practice Windows machine)
- Anything requiring live SendGrid/Twilio/Stripe/Vapi keys

## Already verified complete (do not redo)

- Production deploy workflow (`collectrx-prod-deploy.yml`) and staging deploy
- `fly 2.toml` deleted; `tasks/todo.md` retired; root `src/` duplicate stack archived
- `stripeConnect` stub removed from admin routes
- Password-reset tokens hashed (`PasswordResetToken.tokenHash` in schema)
- Voice-dispatch schema fields present: `Practice.npi`, `Practice.taxId`, `InsuranceClaim.submittedAt`, `expectedAmount`, `treatmentCodes`
- `docs/operations/PATH-TO-DELIVERY.md` exists
- trialEndsAt backfill (staging + prod), legal pack, DNS certs — per recent commits
