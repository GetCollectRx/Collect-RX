# Outstanding Work for a Production-Ready Product

> **Status source note:** The phase "Status" lines below are point-in-time snapshots (oldest from 2026-04-22) and do not reflect work done since — including the Stripe Billing/trial-tier system and the marketing/growth-engine (email campaigns, prospect harvesting) under `Collect-RX-main/src/server/marketing/`, neither of which has phase entries here. For **current** launch-readiness status, use [`docs/operations/PATH-TO-DELIVERY.md`](docs/operations/PATH-TO-DELIVERY.md) — it's kept live. Treat this file as a ticket backlog for reference, not a status report.

**Product intent:** The target is a **complete, deployable** CollectRx—something you can run in **staging and production** with a supported database, CI, secrets, monitoring, and compliance work appropriate to handling healthcare-adjacent data. This backlog is **not** “how to stay a demo”; it is the ordered work to get from the current codebase to that bar. (Some copy in older READMEs may still say “POC”; treat this document as the north star.)

**Launch order (A→G):** [docs/operations/PATH-TO-DELIVERY.md](docs/operations/PATH-TO-DELIVERY.md) — Practice → Insurance only; no patient/client payment collection.

**Purpose:** Backlog of **ticket-sized** tasks, grouped by **phase**. Phases are sequential in priority: finish Phase 1 decisions before large Phase 2–3 build-outs; Phase 4+ can overlap once the core path is defined.

**Ticket format:** Each item is sized for a single issue/PR (roughly **0.5–3 days** unless marked **[L]** for larger epics to split further).

> **Context:** The repo currently mixes two stacks (`Collect-RX-main/` Prisma + Vite vs root `src/api` + `src/frontend`). **Phase 1** must resolve what ships as the product.

---

## Phase 1 — Product & architecture decisions

*Goal: Agree what “the product” is, which codebase is canonical, and what MVP scope is.*

**Status (2026-04-22):** P1-01 through P1-07 have deliverables in-repo: [docs/product/MVP-SCOPE.md](docs/product/MVP-SCOPE.md), [docs/adr/0001-primary-application-stack.md](docs/adr/0001-primary-application-stack.md), [docs/product/SCREENS-API-DATA-MAP.md](docs/product/SCREENS-API-DATA-MAP.md), [docs/ENVIRONMENT-MATRIX.md](docs/ENVIRONMENT-MATRIX.md), [README.md](README.md) (root), [Collect-RX-main/README.md](Collect-RX-main/README.md), and [docs/DEPRECATION.md](docs/DEPRECATION.md) with [src/README.md](src/README.md) and [.github/ISSUE_TEMPLATE/non_canonical_stack.md](.github/ISSUE_TEMPLATE/non_canonical_stack.md).

| ID | Task | Definition of done |
|----|------|-------------------|
| P1-01 | **Name the shipping product and MVP** | Doc (1–2 pages): target user, 3 must-have outcomes, explicit non-goals for v1. |
| P1-02 | **Choose primary stack (or two products)** | ADR: either “Collect-RX-main only” or “root `src` only” or “two products with names X/Y”; list what happens to the other tree (archive, delete, or extract package). |
| P1-03 | **Map screens → APIs → data** | Spreadsheet or doc: every major UI route, backing endpoint, and data store; mark **missing** or **mock**. |
| P1-04 | **Environment matrix** | Table: `local` / `staging` / `prod` — URL, DB, feature flags, which integrations are live vs mock. |
| P1-05 | **Update root README: remove stale POC claims** | README matches reality (auth, stacks, how to run); “POC only” only where true. |
| P1-06 | **Update Collect-RX-main README** | Same as P1-05 for that package; link to ADR from P1-02. |
| P1-07 | **Deprecate path for non-canonical code** | Issue template + `README` section: “We are not taking PRs for `X` until Y”; or delete/move folder per ADR. |

---

## Phase 2 — Foundation (repo, build, database, CI)

*Goal: One way to run, one deploy story, professional database lifecycle.*

**Status (2026-04-22):** P2-01–P2-12 are implemented: npm **workspace** with `npm run dev` → Collect-RX-main, **Vite 6** (no mandatory `--legacy-peer-deps`), **PostgreSQL** + `prisma/migrations`, **docker-compose** Postgres, [docs/DATABASE.md](docs/DATABASE.md), [`.github/workflows/ci-collectrx.yml`](.github/workflows/ci-collectrx.yml) (typecheck, lint, test, build + migrate against CI Postgres), [docs/RELEASING.md](docs/RELEASING.md) + [CHANGELOG.md](CHANGELOG.md), [docs/NPM-AUDIT.md](docs/NPM-AUDIT.md), expanded [Collect-RX-main/.env.example](Collect-RX-main/.env.example). Staging/prod `DATABASE_URL` is operator-specific — see [docs/ENVIRONMENT-MATRIX.md](docs/ENVIRONMENT-MATRIX.md).

| ID | Task | Definition of done |
|----|------|-------------------|
| P2-01 | **Single `package.json` or documented monorepo** | Clear top-level `npm`/`pnpm` scripts; one command starts app + API for the canonical stack. |
| P2-02 | **Resolve peer-deps / lockfile (Collect-RX)** | No mandatory `--legacy-peer-deps` for dev install; or document why and track upgrade ticket. |
| P2-03 | **Typecheck in CI** | `tsc --noEmit` (and frontend build) on PR for canonical packages. |
| P2-04 | **Lint in CI** | ESLint (or Biome) on PR; fix or grandfather with ticket IDs. |
| P2-05 | **Target PostgreSQL for production** | Prisma `datasource` for prod; env `DATABASE_URL` documented. |
| P2-06 | **Introduce Prisma `migrate` workflow** | Replace ad-hoc `db push` in deploy docs with `migrate deploy`; add first baseline migration. |
| P2-07 | **Staging database** | Hosted Postgres + `DATABASE_URL` for staging; only anonymized or synthetic data. |
| P2-08 | **Local dev with Postgres (optional path)** | `docker-compose` or docs for local Postgres matching prod. |
| P2-09 | **CI: run unit tests** | Minimal Jest/Vitest job; at least 1 test that runs green. |
| P2-10 | **Version tagging / changelog policy** | Semantic version tags or release notes process for user-visible changes. |
| P2-11 | **Address root `npm audit` findings** | Triage: fix, bump, or documented exception per CVE. |
| P2-12 | **Document required env vars** | `.env.example` (no secrets) for canonical app; list each var with one-line purpose. |

---

## Phase 3 — Core product journeys (end-to-end)

*Goal: Login → see real data → take primary actions without mocks blocking.*

**Status (2026-04-24) — Phase 3 (P3) is** **COMPLETE** for in-scope work: engineering deliverables, or items **deferred/closed in docs** (see [Appendix C](#appendix-c--phase-3-p3-01-to-p3-42-completion-review) for P3-01 through P3-42). **Follow-ups (non-blockers):** practice SaaS Billing test-mode e2e on your host (see Collect-RX-main README Stripe section); automated Billing webhook coverage is **P7**. Patient pay / Connect (P3-20–P3-23) are **retired**.

### 3A — Auth & tenant

| ID | Task | Definition of done |
|----|------|-------------------|
| P3-01 | **Per-user model (or explicit v1 stay on practice login)** | Doc + optional schema: if per-user, add `User` and roles; if not, document that v1 is practice shared login only. |
| P3-02 | **Password reset flow** (if user accounts) | Request reset → email link → new password; tokens expire. |
| P3-03 | **Rate limit login endpoints** | 429 with backoff; metrics or logs on blocks (no PII in logs). |
| P3-04 | **Session expiry UX** | Friendly message + redirect to login when 401/403; no infinite spinners. |
| P3-05 | **Practice switcher (if multi-tenant in v1)** | User with access to N practices can switch; API enforces membership. |

### 3B — UI routes vs backend

| ID | Task | Definition of done |
|----|------|-------------------|
| P3-10 | **Audit: implement or remove `/api/benefits` calls** | All `PreTreatmentEstimate` fetches hit existing, secured routes; or feature-flag page off. |
| P3-11 | ~~**Audit: `/api/patients/balances` / PatientAR**~~ | **RETIRED** with patient-pay scope — insurance claims / CSV AR only. |
| P3-12 | **Replace “mocked” analytics widgets** | `Analytics.tsx` / `Dashboard.tsx` use real data or show “not configured” with no fake numbers. |
| P3-13 | **Wire admin settings “Save” to API** | Persisted fields; success/error toasts. |
| P3-14 | **Consistent error/empty/loading states** | Shared component or pattern; 3+ key pages updated. |

### 3C — Money movement (minimal real path)

> **Retired (2026-07-14):** Patient pay / Stripe Connect (P3-20–P3-23) are out of product scope. CollectRx is Practice→Insurance only. Practice SaaS billing uses Stripe Billing (+ optional GoCardless PAD), not Connect.

| ID | Task | Definition of done |
|----|------|-------------------|
| P3-20 | ~~Stripe: patient Checkout path~~ | **RETIRED** — no patient payment collection. |
| P3-21 | ~~Idempotent patient payment webhook~~ | **RETIRED** — platform Billing webhooks remain for practice subscriptions. |
| P3-22 | ~~Patient pay link~~ | **RETIRED**. |
| P3-23 | ~~Patient receipt / confirmation~~ | **RETIRED**. |

### 3D — PMS / data in

| ID | Task | Definition of done |
|----|------|-------------------|
| P3-30 | **CSV import: upload + validate** | File upload, column mapping, row-level errors returned to user. |
| P3-31 | **Import: idempotency** | Re-import same file doesn’t duplicate; key strategy documented. |
| P3-32 | **Long-term: PMS integration plan** [L] | Epics: vendor, protocol, BAA, timeline (can be doc-only in this phase). |

### 3E — Eligibility (if in scope)

| ID | Task | Definition of done |
|----|------|-------------------|
| P3-40 | **Persist eligibility snapshots per `eligibility` TODOs** | DB tables + write path from engine; migrations included. |
| P3-41 | **Unit tests for money-affecting rules** | Deductible, max, COB with edge cases. |
| P3-42 | **Reconciliation persist + replay** | `reconcile` results stored; can re-run and compare. |

---

## Phase 4 — Integrations (production configurations)

*Goal: Real providers, not mocks; production-safe keys and webhooks.*

| ID | Task | Definition of done |
|----|------|-------------------|
| P4-01 | **SendGrid: production API key + sender domain** | SPF/DKIM/DMARC verified; bounces to monitoring or inbox. |
| P4-02 | **Unsubscribe + preference compliance** | Footer links, honored in API; law checklist reviewed by compliance. |
| P4-03 | **Twilio: prod numbers + opt-out keywords** | STOP/HELP; rate limits; logging without message body. |
| P4-04 | **Stripe: practice SaaS Billing** | Practice subscription Checkout/Portal; test + prod keys separated. ~~Connect~~ retired (no patient pay). |
| P4-05 | **Vapi: webhook HMAC + replay table** | Signature verification; store event idempotency; rotate secrets procedure documented. |
| P4-06 | **AWS SSM / secrets runbook** | How keys are loaded in staging/prod; who can rotate; break-glass. |
| P4-07 | **Abeldent / Dentrix (if v1): connector spike** [L] | Time-boxed: prove read path or file drop; out-of-scope clearly marked if not. |
| P4-08 | **Failover behavior** | If Twilio/SendGrid/Stripe down, user-visible status + retries in queue. |

**Go-live (Phase 4 “done”):** The **product** is go-live ready when you complete the **operator** column in [docs/operations/PHASE4-GO-LIVE.md](docs/operations/PHASE4-GO-LIVE.md) (DNS, live keys, webhooks, counsel) and **Admin → Integrations** shows the expected config for your practice.

**Code + runbooks (2026-04-22):** [PHASE4-INTEGRATIONS.md](docs/operations/PHASE4-INTEGRATIONS.md), [SECRETS-GO-LIVE.md](docs/operations/SECRETS-GO-LIVE.md). **P4-01** — Event Webhook `POST /api/webhooks/sendgrid` (Ed25519 if key set), bounce/drop/spam → `emailOptOutAt`. **P4-02** — `emailOptOutAt`, one-click `GET /api/public/email-unsubscribe`, `List-Unsubscribe` footers. **P4-03** — Twilio path where SMS is used. **P4-04** — practice SaaS Billing: `GET /api/admin/integrations` + Admin readout (keys present), `/billing` Checkout/Portal, Billing webhooks — **not** Connect/patient pay. **P4-05** — Vapi webhook HMAC + idempotency. **P4-06** — secrets runbook. **P4-07** — [PMS-INTEGRATION-PLAN.md](docs/product/PMS-INTEGRATION-PLAN.md); **scope and go-live inclusion are a program decision**. **P4-08** — send retry + Admin status; see [PHASE4-INTEGRATIONS](docs/operations/PHASE4-INTEGRATIONS.md#p4-08-retry--failures) (queue is Phase 6/8).

---

## Phase 5 — Security, privacy, compliance

*Goal: Meet bar for PHI/payments; defensible in audit.*

| ID | Task | Definition of done |
|----|------|-------------------|
| P5-01 | **Data classification doc** | What is PHI, where stored, retention defaults. |
| P5-02 | **Encryption at rest** | DB encryption or disk-level; documented for prod. |
| P5-03 | **Field-level encryption (if required)** | High-sensitivity fields encrypted in application layer; key in KMS. |
| P5-04 | **Audit log: who read/changed what** | Append-only or tamper-evident; admin query path. |
| P5-05 | **BAA / DPA with vendors** | SendGrid, Twilio, Stripe, Vapi, hosting, DB: signed or in progress. |
| P5-06 | **HIPAA gap review** [L] | External or internal checklist; open issues tracked. |
| P5-07 | **Canada: PIPEDA / provincial** | Jurisdiction, breach process, if applicable. |
| P5-08 | **Collections law content review** | Message templates reviewed for timing, frequency, disclosure. |
| P5-09 | **PCI scope document** | Hosted fields vs redirect; who touches PAN. |
| P5-10 | **SAST in CI** | CodeQL, Semgrep, or equivalent on default branch. |
| P5-11 | **Annual pen test (PHI)** | Report + remediation plan for “must fix” items. |
| P5-12 | **CSRF policy for cookie auth** | Doc + tests if using cross-site frontends. |

**Status (P5, in-repo + operator):** Master index: [docs/compliance/PHASE5-COMPLIANCE.md](docs/compliance/PHASE5-COMPLIANCE.md). **P5-01 / P5-02 / P5-03 / P5-07–09 / P5-12** — compliance docs in `docs/compliance/` (linked from that index). **P5-04** — `AuditLog` + `GET /api/admin/audit-log` + Admin “Audit log” + writes for admin, rules, import, synthetic data, patient A/R actions, public email unsubscribe. **P5-10** — Semgrep `p/ci` in [.github/workflows/ci-collectrx.yml](.github/workflows/ci-collectrx.yml) (with existing quality job). **P5-05 / P5-06 / P5-11** — templates and trackers; **executed** BAAs, completed HIPAA review, and pen test reports are **operator/legal** (not in git). **P5-08** — review template + code pointers; counsel sign-off is out of band.

---

## Phase 6 — Platform operations & reliability

*Goal: On-call can sleep; customers see status.*

| ID | Task | Definition of done |
|----|------|-------------------|
| P6-01 | **Structured logging** | JSON logs; PII/PHI redaction rules. |
| P6-02 | **Error tracking (e.g. Sentry)** | Server + client DSN; sampling in prod. |
| P6-03 | **Metrics: golden signals** | Latency, errors, traffic; dashboard link. |
| P6-04 | **Uptime check + alert** | Health endpoint; alert if down > N min. |
| P6-05 | **DB backups + tested restore** | Runbook: restore to staging; RPO/RTO written. |
| P6-06 | **Runbook: deploy & rollback** | One-pager: commands, k8s/PM2, feature flags. |
| P6-07 | **Runbook: failed webhook replay** | Steps to safely replay after fix. |
| P6-08 | **Staging = prod parity** | Same env shape; smoke test after each prod deploy. |
| P6-09 | **Status page (optional v1)** | Or clear in-app / email comms for incidents. |
| P6-10 | **On-call rotation (if SLA)** | Schedule + escalation; or explicit “no 24/7” in terms. |

**Status (P6, eng + operator):** [PHASE6-OPS.md](docs/operations/PHASE6-OPS.md). **P6-01** — JSON `logLine` + request access log (prod default); PII/phone [redact](Collect-RX-main/src/server/observability/logger.ts) + unit tests. **P6-02** — optional `@sentry/node` + `@sentry/react` when `SENTRY_DSN` / `VITE_SENTRY_DSN` set; `ErrorBoundary` reports if client active. **P6-03** — `GET /api/health/metrics` (in-process) + Sentry/APM in prod. **P6-04** — `GET /api/health` (liveness) + `GET /api/health/ready` (DB, **503** if down). **P6-05…P6-10** — runbooks and checklists in that doc; **backups, alerts, on-call, status page** are **host/ops** to execute; document “no 24/7” in your terms if applicable.

---

## Phase 7 — Quality assurance & load

**Status (P7, 2026-04-22):** **P7-01 / P7-02 / P7-03 / P7-04 / P7-07 / P7-08** are implemented in-repo. **P7-05** — sample k6 script + how to use + tie-in to P6 metrics ([PHASE7-QA.md](docs/operations/PHASE7-QA.md)). **P7-06** — webhook **burst/scale** guidance documented there (load generator on vendor hooks is an operator/perf exercise). **E2E on CI:** [`.github/workflows/ci-collectrx.yml`](.github/workflows/ci-collectrx.yml) (seed → build → Playwright). **i18n:** [I18N-DECISION.md](docs/product/I18N-DECISION.md).

| ID | Task | Definition of done |
|----|------|-------------------|
| P7-01 | **E2E: login + dashboard** | Playwright: happy path on CI. |
| P7-02 | **E2E: payment webhook path** | Stripe CLI or mock server in CI. |
| P7-03 | **API integration tests** | Key routes return expected codes; auth cases. |
| P7-04 | **Reproducible test fixtures** | Seed or factory; not only manual `db:seed`. |
| P7-05 | **Load test: read-heavy API** [L] | k6 or similar; report p95, errors under target RPS. |
| P7-06 | **Load test: webhook burst** | Voice/SMS spike handling documented. |
| P7-07 | **Accessibility pass: critical flows** | Fix WCAG 2.1 A issues on login, balances, pay. |
| P7-08 | **i18n decision** | “English only v1” or add framework + one extra locale in pilot. |

---

## Phase 8 — Background processing & scale

*Goal: Outgrow single Node process without rewriting.*

**Status (2026-04-25):** **P8-01** — [ADR 0002](docs/adr/0002-background-jobs-bullmq-redis.md) (BullMQ + Redis). **P8-02** — `npm run worker` ([workerEntry](Collect-RX-main/src/server/workerEntry.ts)); API registers repeatables when `REDIS_URL` is set, else in-process [rules + reminder](Collect-RX-main/src/server/index.ts). **P8-03** — `GET /api/health/queue` (depth when Redis) + [PHASE8-BACKGROUND.md](docs/operations/PHASE8-BACKGROUND.md) (alerts). **P8-04** — `ReminderSendLedger` + idempotency in [reminderEngine](Collect-RX-main/src/server/patients/reminderEngine.ts). Run `prisma migrate deploy` for the new table.

| ID | Task | Definition of done |
|----|------|-------------------|
| P8-01 | **Queue technology choice** | Redis + Bull (or cloud queue); ADR. |
| P8-02 | **Move rules/reminder execution to worker** | Horizontally scaled workers; no duplicate sends (locks). |
| P8-03 | **Job dashboard or metrics** | Queue depth visible; alert on age. |
| P8-04 | **Idempotent send pipeline** | Same “send reminder” job can’t double-email on retry. |

---

## Phase 9 — Polish & GTM

| ID | Task | Definition of done |
|----|------|-------------------|
| P9-01 | **In-app help / “What is this?” for key terms** | Tooltips or help drawer on 3+ screens. |
| P9-02 | **Legal: Terms, Privacy, cookie banner** | Published; linked in app and signup. |
| P9-03 | **Admin onboarding checklist** | New practice: import → verify → go live. |
| P9-04 | **Sales/support one-pager** | What the product does / doesn’t do; handoff to CS. |
| P9-05 | **Changelog for customers** | Public or email-friendly release notes process. |

**Phase 9 status (done in app):** In-app help via `HelpTip` on Dashboard, Insurance AR, and Pre-Treatment Estimate (`HelpTip.tsx`). Terms and Privacy at `/legal/terms` and `/legal/privacy`; `CookieBanner` in `App.tsx` with consent key `crx_cookie_consent_v1`. Sign-in and sidebar link to Terms, Privacy, product one-pager (`/product`, `ProductOnePager.tsx`), and customer changelog (`/changelog`, `customerChangelog.ts` + `Changelog.tsx`). Admin shows `AdminOnboardingChecklist` for the current practice. Index for routes and changelog updates: [PHASE9-GTM.md](docs/product/PHASE9-GTM.md). Legal copy is a template — counsel review before production.

---

## Phase 10 — Manual UX / dev-experience audit (2026-08-06)

*Goal: Everything this repo's docs and UI promise, verified by actually running the app end to end — not just by CI passing.*

**Status (2026-08-06):** Triggered by a live walkthrough — Postgres + Redis stood up locally, a generic demo practice seeded, and every core screen driven in a real browser as a practice owner. Found the primary local dev workflow (`npm run dev`) completely broken and one revenue page crashing outright; both were invisible to CI because CI runs the production build, not the dev server. The escalations gap it surfaced (P10-03) turned out not to be a seed-only artifact: auditing real code (P10-04) found the same desync live in production on the two backend paths that actually escalate a claim — including the primary post-call routing path, which had never had a test written against it. **P10-01–P10-04 are fixed** (commit `9baec99` + follow-up on `claude/app-testing-requirements-3s2x8o`). **P10-05 onward are net-new backlog** from this pass, not yet done. This phase only covers the core practice-owner AR loop (dashboard, claims, claim detail, escalations, pre-visit, pre-treatment estimate, billing, settings, CSV import) — front-desk, admin, and several other surfaces are explicitly untested (see P10-08–P10-10).

| ID | Task | Definition of done |
|----|------|-------------------|
| P10-01 | ~~**Dev-mode crash: `lazy` used before its import in `App.tsx`**~~ | **Fixed.** `npm run dev` rendered a blank white screen on every route (`Cannot access 'lazy' before initialization`) because `lazy(...)` was called at module scope above `import { lazy, ... } from 'react'`. Vite's dev-mode CJS-interop transform doesn't hoist that the way real ESM does. Production builds were unaffected. Reordered the import. |
| P10-02 | ~~**Dev-mode crash: Billing page `process is not defined`**~~ | **Fixed.** `src/billing/tiers.ts` read `process.env.STRIPE_*` at module scope but is imported by client bundles (Landing, ProductOnePager, and `SubscriptionUsageCard` on `/billing`). Vite's production build shims `process.env` to `{}` for the browser, masking it; the dev server doesn't. Guarded with a `typeof process !== 'undefined'` check. |
| P10-03 | ~~**Demo seed: escalated claims missing from the Escalations page**~~ | **Fixed.** `seed-demo.ts` set `claim.status = 'ESCALATED'` on 6 claims but never wrote a matching `call_escalations` row — the table the dedicated `/escalations` page actually queries. Page showed "No open escalations" for a practice with $12,100 across 6 escalated claims, visible everywhere else in the UI. Added the missing rows to the seed. |
| P10-04 | ~~**Audit real code paths for the claim-status / `call_escalations` desync**~~ | **Confirmed real — two separate gaps found and fixed, not one.** Audited every `insurance_claims.status` write site in `src/server` for whether an `ESCALATED` transition also writes `call_escalations`: **(1)** `settleBlockedCandidate()` in `queueEngine.ts` shared one switch case for the `ESCALATE_OVER_90` and `MAX_ATTEMPTS` dispatch-guard codes — both set status to `ESCALATED`, but `createEscalation()` was gated to `MAX_ATTEMPTS` only, so the documented "claims over 90 days old → escalate to human" rule silently skipped it. **(2)** `applyRecoveryAfterCall()` in `recoveryLoopService.ts` — the primary path that routes a claim after a **real completed carrier call** (appeal required, CDCP reconsideration, two-fruitless-attempts ladder, financial-outcome-held — see `claimRouter.ts`'s decision table) — wrote `insurance_claims.status` and `claim_recovery_actions` on every `ESCALATED` decision but never touched `call_escalations` at all; this is the highest-volume real-world path to `ESCALATED` and had zero prior test coverage. Fixed both with the same dedupe-then-create pattern as the existing `MAX_ATTEMPTS` code. Verified each fix by confirming its new regression test fails against the pre-fix code and passes after (`tests/frontDesk/queueEngine.dispatch.test.ts`, new `tests/recovery/recoveryLoopService.escalation.test.ts`). Typecheck, lint, and the full `frontDesk`/`recovery`/`phase-5` suites (179 tests) green. Other `ESCALATED`-adjacent code checked and confirmed safe: `transitionClaimRecovery.ts` (never writes `ESCALATED` — its one dynamic-status branch always resolves to `RESOLVED`), `manualDispatchCompensation.ts` (restores pre-dispatch state, not a new escalation), `claimFailureReview.ts` / `productImprovementAgent.ts` (read-only queries), `vapiWebhook.ts` / `claimsValidatorWebhook.ts` / `overdueActionEscalation.ts` (already call `createEscalation()` correctly), `mapOutcomeToClaimStatus` (defined, unused elsewhere). |
| P10-05 | **Fix `Collect-RX-main/README.md` demo credentials** | README states the demo login is `demo@collectrx-test.local` / `CollectRx2026!`. `seed-demo.ts` has **no default password** and throws (`"SEED_PRACTICE_PASSWORD is required (min 8 chars) — no default password."`) if it isn't set. Anyone following the README's own Quick Start hits a hard failure, not that login. Update the doc to state a `SEED_PRACTICE_PASSWORD` must be set (matching the root README, which already gets this right), or add a real dev-only default gated to non-production. |
| P10-06 | **One-command local bootstrap (`npm run setup`)** | No script currently takes a clean clone to a running app. Getting there today means: reading `.env.example`'s comments, reconciling a Postgres port mismatch by hand (see P10-07), generating `JWT_SECRET`/`PHI_ENCRYPTION_KEY` yourself, and picking your own seed password. New script should check for Docker, run `docker compose up -d` if available (else prompt for an existing `DATABASE_URL`), generate missing secrets into `.env`, run migrate + seed, and print the login it just created. DoD: one command, no manual secret generation, no silent port mismatch. |
| P10-07 | **Reconcile `.env.example` `DATABASE_URL` port vs. native Postgres default** | `.env.example` defaults to port `5433` (assumes `docker compose up -d`), but a native `apt`/Homebrew Postgres install defaults to `5432` with nothing to flag the mismatch — `prisma migrate dev` just fails to connect with a generic error. Either have `scripts/dev.mjs` detect and warn on a connection failure with the likely fix, or make the port choice unmissable before first migrate. |
| P10-08 | **Audit front-desk role screens** | `/console` (Live Console) and `/history` (Call History) — not walked in this pass. Same rigor as P10-01–03: log in as `front_desk`, drive every screen, confirm role-scoped URLs actually block other routes (not just hide nav links). |
| P10-09 | **Audit Admin / platform-admin screens** | `/admin`, `/admin/health`, `/admin/users`, `/admin/break-glass`, `/admin/integrations`, `/admin/staff`, `/admin/partnerships`, `/admin/partnerships/:id` — not walked in this pass. Break-glass in particular should leave a verifiable audit trail. |
| P10-10 | **Audit AR Command Center, Group Dashboard, CDCP 2026, and report pages** | `/ar-command-center`, `/group-dashboard`, `/pre-visit` (CDCP deadlines / adjudication graph / KPIs tabs), `/reports/aging`, `/reports/carriers`, `/reports/queue` — rendered but not exercised with real interaction in this pass. |
| P10-11 | **Audit claim-detail sub-features not exercised** | The "Denial & documentation" evidence checklist and "Export evidence pack (JSON)" button, and the Claims list's "Blocked gates" / "Denials & docs" / "Needs human" tab filters — seen rendered empty but not exercised end-to-end with data that populates them. |
| P10-12 | **Sweep for other dual-source-of-truth tables like `call_escalations`** | The P10-03/P10-04 bug pattern — a page reads a narrow side table that isn't guaranteed to stay in sync with the claim's primary status — may repeat elsewhere (e.g. `work_queue` vs `insurance_claims.status`, `call_attempts.outcome` vs claim status). Worth a deliberate audit rather than finding each instance by accident, one broken page at a time. |

**How P10-01–03 were found:** local Postgres 16 + Redis, `npm run demo:seed`, and a real Chromium session (Playwright) driven through login → dashboard → work queue → claims → claim detail → escalations → pre-visit → pre-treatment estimate (filled and generated a real result) → billing → settings → CSV import (uploaded and previewed the sample template). CI never catches P10-01/02 because it runs the production build (`npm run start` / `vite preview`), not `npm run dev` — the two have materially different module-resolution behavior for `process.env` and import ordering.

---

## Appendix A — Epics to split (too large for one ticket)

- **[L] P1-02** may spawn: migrate data model, re-point CI, move env, and redirect docs.
- **[L] P3-22** ~~patient pay links~~ — **retired** (Practice→Insurance only).
- **[L] P3-32** full PMS integration: multi-quarter; keep spike separate.
- **[L] P5-06** HIPAA: often many sub-tasks after assessment.
- **[L] P5-11** pen test: scheduling + full remediation pass.
- **[L] P10-09/P10-10** admin + secondary-surface audit: several unrelated screens bundled under two IDs for tracking; split per screen once triaged.

---

## Appendix B — Original theme mapping (for traceability)

| Original theme (summary doc) | Phases above |
|------------------------------|--------------|
| Product & experience | P1, P3, P9 |
| Engineering & architecture | P2, P8 |
| Integrations | P3C–D, P4 |
| Security & privacy (beyond current hardening) | P3A, P5 |
| Compliance & legal | P5 |
| Operations & reliability | P6, P4-08 |
| Quality assurance | P7 |
| Documentation & handover | P1, P2-12, P1-05/06, P6 runbooks |

---

## Appendix C — Phase 3 (P3-01 to P3-42) completion review

*Scope: only IDs that appear in Phase 3 subsections above (3A–3E). Numbers between these (e.g. P3-06) were not listed as deliverables in this roadmap.*

| ID | Verdict | Evidence / notes |
|----|---------|-------------------|
| **P3-01** | **Complete (v1 doc)** | [AUTH-MODEL-V1.md](docs/compliance/AUTH-MODEL-V1.md): v1 = per-practice shared login; no `User` table. |
| **P3-02** | **Deferred (N/A v1)** | No per-user accounts → password reset not implemented; same doc. |
| **P3-03** | **Complete** | `POST /api/auth/login`: `express-rate-limit` — 30 attempts / 15 min (`Collect-RX-main/src/server/index.ts`); 429 + `standardHeaders`. Optional backlog: metrics on blocks (P6). |
| **P3-04** | **Complete** | [apiFetch.ts](Collect-RX-main/src/lib/apiFetch.ts) dispatches `crx:session-expired` on 401. |
| **P3-05** | **Deferred (N/A v1)** | [AUTH-MODEL-V1.md](docs/compliance/AUTH-MODEL-V1.md): single practice per env; no switcher. |
| **P3-10** | **Complete** | `PreTreatmentEstimate` → `/api/benefits/...` via `createBenefitsApiRouter` on protected `/api`. |
| **P3-11** | **Retired / superseded** | Patient A/R balances UI removed with patient-pay scope. Insurance claims / CSV AR are the product path. |
| **P3-12** | **Complete** | Dashboard/Analytics: real data or honest empty/error via `DataState` + APIs (no mock KPIs). |
| **P3-13** | **Complete** | Admin carrier settings: `GET`/``PUT` `/api/admin/settings` + UI save. |
| **P3-14** | **Complete** | `DataState` on all six main data pages including **Pre-Treatment** ([PreTreatmentEstimate.tsx](Collect-RX-main/src/pages/PreTreatmentEstimate.tsx)): shared `loading` shell; `res.ok` / toasts; **benefits** errors inline in the right panel (not full-page) so the form stays usable. |
| **P3-20** | **Retired** | Patient Checkout path removed — Practice→Insurance only. Practice SaaS Billing lives under P4-04 / `/billing`. |
| **P3-21** | **Retired** | Patient payment webhook path removed. Platform Billing webhooks remain in `stripe/billing.ts`. |
| **P3-22** | **Retired** | Patient pay links / public pay tokens removed. |
| **P3-23** | **Retired** | Patient receipt / thank-you flow removed. |
| **P3-30** | **Complete** | CSV upload, [header aliases](Collect-RX-main/src/server/csv/parseSimple.ts), row `errors` + Admin panel; `400` empty file. |
| **P3-31** | **Complete** | [upsertBalances](Collect-RX-main/src/server/patients/balances.ts) + [CSV-IMPORT-IDEMPOTENCY.md](docs/product/CSV-IMPORT-IDEMPOTENCY.md). |
| **P3-32** | **Complete (doc epic)** | [PMS-INTEGRATION-PLAN.md](docs/product/PMS-INTEGRATION-PLAN.md). |
| **P3-40** | **Complete** | `POST /api/eligibility/estimate` writes `prisma.eligibilityEstimateLog.create(...)` ([eligibility.ts:116](Collect-RX-main/src/routes/eligibility.ts#L116)) into the `EligibilityEstimateLog` model ([schema.prisma:346](Collect-RX-main/prisma/schema.prisma#L346)); `GET /api/eligibility/status/:patientId/:carrier` reads the latest row and returns it as `lastEstimate` ([eligibility.ts:154-181](Collect-RX-main/src/routes/eligibility.ts#L154-L181)). |
| **P3-41** | **Complete** | [eligibility.test.ts](Collect-RX-main/tests/eligibility.test.ts) (deductible, annual max, COB, reconciliation flags, + P3-41 edge cases); [vitest.config](Collect-RX-main/vitest.config.ts) includes `tests/`. |
| **P3-42** | **Complete** | `EligibilityReconcileLog` + `POST/GET` reconcile history; [ELIGIBILITY-RECONCILE-LOG.md](docs/product/ELIGIBILITY-RECONCILE-LOG.md). |

**Review summary:** 19/19 in-scope P3 rows are **done in code** or **intentionally deferred/operator-only** as above. Automated browser E2E and production Stripe dry-runs are tracked under **P7** / release ops, not a Phase 3 code gap.

---

## CSV-first AR expansion (Phases 1–5) — Implemented

Migration `20260712213000_csv_ar_expansion`, rollout runbook [`Collect-RX-main/docs/csv-ar-rollout.md`](Collect-RX-main/docs/csv-ar-rollout.md).

| Capability | Status |
|------------|--------|
| `CSV_FIRST` recovery mode + EMR outbox skip | Done |
| Organization-scoped DSO APIs + PHI access events | Done |
| Denial hub (CSV import gates, evidence attestations, submissions, evidence-pack export) | Done |
| EOB CSV import + underpayment detection + submission-quality gate | Done |
| Pre-visit appointment CSV ingest | Done |
| Carrier intelligence practice feed + group lesson review | Done |
| AR command center inbox + managed recovery queue APIs/UI | Done |
| Compliance workspace (PHI access query + export bundle) | Done |
| Feature flags + unit tests (`tests/csv-ar-expansion.test.ts`) | Done |

**Operator:** Run migration on staging; verify RLS tests with Postgres before production enable.

---

## Deferred post-v1 — Optional encrypted evidence vault

The Denial & Documentation Recovery Hub initially uses staff attestations, carrier reference numbers, and PMS-held documents. It does **not** store clinical attachments in CollectRx.

**Post-v1 enhancement:** Add an opt-in, tenant-isolated evidence vault for clinical attachments and insurer submission packages.

- Store files in a Canadian-region private object store using short-lived upload/download URLs; never store files in PostgreSQL.
- Encrypt files at rest, retain only tenant-scoped metadata/checksums in CollectRx, and audit every upload, view, export, and deletion.
- Never send attachments or their contents to Vapi or cross-practice carrier learning.
- Require documented retention/deletion controls, vendor agreement review, and PHI threat modeling before enabling the feature for any practice.

---

*Last updated: Phase 10 (manual UX/dev-experience audit, 2026-08-06) + Phase 9 (GTM & polish) + Phase 8 (background jobs) + Phase 7 + Phase 3 review matrix (Appendix C). Re-number tickets in your issue tracker; keep this file as a roadmap outline.*
