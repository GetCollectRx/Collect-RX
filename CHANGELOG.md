# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Phase 2 foundation: npm workspace for **Collect-RX-main**, `docker-compose` Postgres, Prisma **PostgreSQL** + baseline migration, CI (typecheck, lint, test, build), ESLint, Vitest smoke test, and documentation for database, releasing, and npm audit triage.
- Top-level `npm run dev` runs the **canonical** CollectRx app; `npm run dev:prototype` runs the legacy root Node entry.
- Weekly pilot-report email to practice owners, a Day 30/60/90 assumption-validation dashboard, and in-app pilot runbook pages (go-live checklist, FAQ, rollback).
- Automated email campaign system for practice-onboarding outreach, including CASL-compliant sender identity, unsubscribe/reply handling, and a send scheduler.
- Axe accessibility checks in the Playwright E2E suite, Redis/BullMQ test coverage in CI, a Stripe webhook idempotency test, and a carrier-block SMS alert integration test.
- Pre-push git hook (`.githooks/pre-push`) mirroring CI's `verify` job (typecheck/lint/test/build) so PRD-standard violations are caught before a push, not after.
- Vapi squad sync/diff tooling and `AGENT_RUNTIME_SECRET` wired into environment checks.
- New CollectRx shield brand logo rolled out across the web app, desktop app, and icons (v1.0.2).

### Changed

- **Vite 6** in Collect-RX-main to align with Storybook 8 peer ranges (removes the need for `--legacy-peer-deps` for a standard install).
- Prisma `datasource` is **PostgreSQL** via `DATABASE_URL` (replacing committed SQLite `file:./dev.db` for production alignment).
- Carrier dispatch rules moved out of `adapter.ts` into data-driven `carrier-configs.json`, consistent with "carrier rules are data, not code."
- Comprehensive WCAG A/AA color-contrast and accessibility fixes across the landing page, login, and app UI.
- Infra references migrated from Railway to Fly.io across code, docs, and `.env.example`.
- Marketing/outreach sender identity (name, full name, email) is now configurable via `MARKETING_OUTREACH_SENDER_NAME` / `_FULL_NAME` / `_EMAIL`, replacing hardcoded literals in the email templates.

### Fixed

- PHI: GCM auth-tag length now enforced on decryption; CDCP case tenant identity now sourced from server rows instead of Vapi payloads; pre-visit dispatch corrected `patientId`/token separation and deferred TELUS Tx23.
- Removed an unauthenticated `email-events` webhook route and brought `/api/campaigns` under the API auth gate.
- Repaired an invalid email-campaign Prisma migration that was blocking every deploy.
- Removed the reset-token leak endpoint and its dead token helper.
- `CARRIER_BLOCK` scanner now also matches Claims_Agent's own refusal phrases, and its live-transcript and end-of-call phrase lists are reconciled into one source instead of drifting independently.
- Marketing campaign sends now refuse without a real CASL sender identity and drop off-list prospects.
- Cleared npm audit findings for production dependencies (axios, fast-uri, others); removed explicit `any` types and duplicate imports flagged by lint; switched `node-cron` to an ES import.
- TELUS AdjudiCare claims now respect their carrier-specific 21-day minimum wait instead of the generic 30-day floor, with the underlying TPA identified and gated before IVR dispatch.
- Claims older than 90 days now generate a practice-facing escalation notification when they age out of the AI queue instead of failing silently.
- Weekly pilot-report and recovery-metrics revenue figures now come from verified `ClaimRecoveryEvent` payment confirmations instead of raw billed amount.
- Added a foreign key from `InsuranceClaim.practiceId` to `Practice`, closing a gap where orphaned claims could survive practice deletion.
- Fixed a carrier-timeout config key mismatch (`CARRIER_TIMEOUTS` used kebab-case keys against a snake_case `CarrierId` enum, so per-carrier timeouts silently fell back to defaults).
- Fixed the pre-visit `IVR_Navigator` prompt so it no longer voices a spoken disclosure message before a human answers.
- Fixed carrier call-quality reporting (`avgAttempts`) always showing 1.0 regardless of actual attempt counts.
- Forensic logger's PHI scrubber now serializes `Error` objects (name/message/stack) explicitly instead of via generic property enumeration, which had been dropping error detail.
- Wired `Hold_Sentinel`'s webhook/`analysisPlan` into the Vapi squad config so calls that end while it holds the line are still reported.
- Added an explicit anti-impersonation instruction to `Escalation_Closer`/`Resolution_Closer` prompts, matching `Claims_Agent`.
- Deleted confirmed-dead code: the never-mounted legacy `handleVapiWebhook` handler and the unused `outcomeClassifier.ts` keyword classifier.

### Security

- Pre-visit token boundary hardened: patient identifiers and tokens no longer share a payload path.
- CASL-compliant footer and working reply path enforced on all scheduler-sent marketing emails.
- All real PHI-detokenization call sites now emit a `PhiAccessEvent` audit log entry.

## [0.0.0] - 2026-04-22

- Changelog and releasing policy introduced; prior work untracked here.
