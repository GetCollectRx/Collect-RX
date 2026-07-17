# Pilot engineering backlog — status tracker (52 items)

Last updated: 2026-07-09. **Engineering** = code/docs/CI in repo. **Ops** = run on Fly/dashboards with credentials. **Field** = requires practice Windows PC.

Legend: ✅ Engineering done · 🔧 Ops / deploy · 🏥 Field validation · ⏭ N/A or deferred

## Tier 0 — Pilot blockers

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | E2E AbelDent sync on real Windows PC | 🏥 | Code: `desktop/services/abeldent-sync.js`. Proof requires practice PC. |
| 2 | Service account token per practice | ✅ | `connectorAdminRoutes.ts`, `SyncOpsDashboard.tsx`, migration `20260708200000` |
| 3 | mssql + native driver on practice PC | ✅ | `desktop/scripts/windows-install-mssql.ps1`, `SCHEMA-DISCOVERY-RUNBOOK.md` |
| 4 | Schema discovery runbook | ✅ | `docs/pilot/SCHEMA-DISCOVERY-RUNBOOK.md`, `npm run abeldent:discover` |
| 5 | Sync health → ops alerted | ✅ | `connectorSyncMonitor.ts`, cron `connectorMonitorScheduler.ts`, `alertCatalog` |
| 6 | Idempotent sync | ✅ | `prismaClaimImporter.ts` upsert by `practiceId_claimNumber` |
| 7 | Windows installer shipped | ✅ | CI green on `v1.0.0-pilot`; `CollectRx.Setup.1.0.0.exe` on GitHub Releases |
| 8 | Agent env without hand-editing | ✅ | `%ProgramData%\CollectRx\agent-config.json`, `loadAgentConfig.cjs`, NSIS seeds file |
| 9 | Import → queue → dispatch unattended | ✅ | `pmsImportPipeline.ts` → `syncWorkItemsForPractice`; 🔧 enable Vapi + gates |
| 10 | Redis + worker on Fly | ✅ | `fly.toml` worker process; 🔧 set `REDIS_URL` secret |
| 11 | Vapi webhooks on Fly | 🔧 | `docs/operations/GO-LIVE-ENGINEERING.md` — verify URL |
| 12 | Carrier blocks / practice gates | ✅ | `carrierBlockService.ts`, `queueEngine.ts`; 🔧 pilot practice config |

## Tier 1 — Production ops

| # | Item | Status | Notes |
|---|------|--------|-------|
| 13 | Re-point webhooks to Fly | 🔧 | `GO-LIVE-ENGINEERING.md` §1 |
| 14 | Stripe live (practice SaaS Billing) | 🔧 | §2 |
| 15 | SendGrid SPF/DKIM + event webhook | 🔧 | §3 |
| 16 | Secrets audit/rotate | 🔧 | §4, `SECRETS-GO-LIVE.md` |
| 17 | Fly Postgres encryption at rest | 🔧 | §5 |
| 18 | DB backups + tested restore | 🔧 | §6 |
| 19 | Uptime monitoring | 🔧 | §7 |
| 20 | Sentry DSN on Fly | 🔧 | §8 |
| 21 | Staging on Fly | ✅ | `collectrx-staging-deploy.yml` + `STAGING-DEPLOY.md` |

## Tier 2 — Uncommitted / CI

| # | Item | Status | Notes |
|---|------|--------|-------|
| 22 | Merge desktop package | ✅ | Commit `c03b62f` + this batch |
| 23 | electron/icon.png + builder | ✅ | `electron/icon.png`, `package.json` build |
| 24 | Linux CI job | ✅ | `linux-appimage` job in workflow |
| 25 | GET /api/desktop/releases | ✅ | `desktopReleasesRoutes.ts`; 🔧 `GITHUB_RELEASES_TOKEN` on Fly |
| 26 | Pilot tag → CI .exe | ✅ | Tag `v1.0.0-pilot` pushed; workflow run 28984095404 succeeded |

## Tier 3 — CI / quality

| # | Item | Status | Notes |
|---|------|--------|-------|
| 27 | tsc --noEmit | ✅ | ioredis/bullmq cast in `arQueue.ts`, `workerEntry.ts` |
| 28 | Test suite green | ✅ | 821 passed locally; `REDIS_URL` cleared in vitest |
| 29 | Vite production build | ✅ | `vite.config.ts` target `es2022` |
| 30 | Playwright E2E on CI | ✅ | `collectrx-ci.yml` e2e job |

## Tier 4 — Product engineering

| # | Item | Status | Notes |
|---|------|--------|-------|
| 31 | PRACTICE-ASK.md | ✅ | `docs/pilot/PRACTICE-ASK.md` |
| 32 | INTERNAL-SETUP-RUNBOOK.md | ✅ | `docs/pilot/INTERNAL-SETUP-RUNBOOK.md` |
| 33 | Onboarding checklist agent-first | ✅ | `AdminOnboardingChecklist.tsx` |
| 34 | Admin service token UI | ✅ | Sync ops mint/revoke |
| 35 | Admin connector status panel | ✅ | Sync ops agent table + health |
| 36 | Marketing / landing copy | ✅ | `LandingPage.tsx` hero |
| 37 | Balance.source DENTRIX_SYNC | ⏭ | `Balance` table dropped; no column to fix |
| 38 | docs/adr/ | ✅ | `docs/adr/0001-*.md`, `0002-*.md` |

## Tier 5 — Desktop hardening

| # | Item | Status | Notes |
|---|------|--------|-------|
| 39 | Guided installer config | ✅ | NSIS + `agent-config.json` |
| 40 | Install mssql dependency | ✅ | `windows-install-mssql.ps1` |
| 41 | Agent heartbeat API | ✅ | `POST /api/connector/heartbeat` |
| 42 | Auto-update | ✅ | `latest.yml` + blockmap on tagged Electron releases |
| 43 | Code signing | ✅ doc | `docs/operations/DESKTOP-CODE-SIGNING.md` (unsigned pilot OK) |
| 44 | Offline UX | ✅ | `electron/offline.html` |

## Tier 6 — PMS roadmap

| # | Item | Status | Notes |
|---|------|--------|-------|
| 45 | Dentrix connector spike | ✅ doc | `docs/product/DENTRIX-CONNECTOR-SPIKE.md` |
| 46 | Generic connector pattern | ✅ | AbelDent `schema-map` model documented in epics |
| 47 | Canadian write-back desktop | ✅ | `abeldent-sync.js` polls `/api/connector/writeback-pending` |
| 48 | PMS plan → epics | ✅ | `docs/product/PMS-ENGINEERING-EPICS.md` |

## Tier 7–8 — Integrations & polish

| # | Item | Status |
|---|------|--------|
| 49 | Stripe test→live e2e | 🔧 Ops |
| 50 | SendGrid/Twilio prod | 🔧 Ops |
| 51 | Integration failover UX | ✅ Partial — `opsAlerts.ts`, `opsMonitor.ts` |
| 52 | ClickHouse analytics | ⏭ Optional for pilot |
| P7-05 | k6 load test on Fly | 🔧 |
| P7-07 | a11y pass | 🔧 |
| P1-07 | Archive root `src/` | ⏭ |
| P2-11 | npm audit | 🔧 |

## Engineering complete when

1. ✅ Pushed to `main` — production v25 on Fly
2. ✅ `prisma migrate deploy` on Fly (connector agents migration live)
3. ✅ Tag `v1.0.0-pilot` → Windows `.exe` in GitHub Releases
4. 🔧 Ops checklist in `GO-LIVE-ENGINEERING.md` — **defer until practice signed** (Stripe live, webhooks, Sentry, etc.)
5. 🏥 Field proof: item **#1** on practice PC — **next gate when you have a practice**

## When you have a practice (same-day checklist)

1. **Admin → Sync ops** — mint connector token
2. Send practice `CollectRx.Setup.1.0.0.exe` from [v1.0.0-pilot release](https://github.com/GetCollectRx/Collect-RX/releases/tag/v1.0.0-pilot) or https://www.collectrx.ca/download
3. On-site: `agent-config.json` + `windows-install-mssql.ps1` — see `INTERNAL-SETUP-RUNBOOK.md`
4. Optional before go-live: disable Fly autostop (`auto_stop_machines = false`) for snappier first load
5. Run Tier 1 ops from `GO-LIVE-ENGINEERING.md` if billing/calls/email go live that day
