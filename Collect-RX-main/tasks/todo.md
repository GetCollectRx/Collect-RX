# CollectRx Phase 5 — Backend Data Layer
## Voice AI Backend: All tasks the Phase 5 UI depends on

> Sequential build order enforced. Each section must pass before the next begins.

---

## 0 — Project scaffolding
- [ ] `package.json` — deps: express, @prisma/client, prisma, zod, crypto, nodemailer, twilio, vitest, typescript, @types/express, @types/node
- [ ] `tsconfig.json` — strict mode, ES2022, commonjs output, paths alias `@/*`

## 1 — Prisma schema (everything else depends on this)
- [ ] `prisma/schema.prisma` — datasource postgresql, generator client
- [ ] Model `InsuranceClaim` — id, practiceId, carrierId, claimNumber, patientToken, billedAmount, outstandingAmount, daysOutstanding, status, priority, createdAt, updatedAt
- [ ] Model `CallAttempt` — id, claimId, vapiCallId (unique), initiatedAt, completedAt, durationSeconds, outcome, outcomeDetail, repName, referenceNumber, transcriptUrl, carrierBlockDetected
- [ ] Model `CarrierBlockEvent` — id, practiceId, carrierId, blockedAt, resumedAt, resumedBy, notes
- [ ] Model `CallQueue` — id, practiceId, claimId, scheduledFor, priority, attempts, lastAttemptAt, status (PENDING/IN_PROGRESS/COMPLETED/ESCALATED/BLOCKED)
- [ ] `npx prisma migrate dev` (run after schema — or SQL migration file as equivalent)

## 2 — SQL migration (alternative/supplement to prisma migrate)
- [ ] `migrations/insurance-schema.sql` — all 4 tables + indexes + enums (mirrors Prisma)

## 3 — PHI boundary layer
- [ ] `src/services/pii-vault.ts` — tokenize(patientId) → UUID, detokenize(token) → patientId
- [ ] PHI never stored in CallAttempt, CallQueue, InsuranceClaim — only patientToken UUID
- [ ] Unit test: tokenize→detokenize round-trip

## 4 — Vapi / Carrier / Outcome layer
- [ ] `src/vapi/client.ts` — Vapi SDK wrapper: initiateCall(claimId, carrierId, patientToken), getCallStatus(vapiCallId)
- [ ] `src/carriers/adapter.ts` — per-carrier IVR routing config, TELUS TPA pre-check, CARRIER_BLOCK flag check
- [ ] `src/outcome/processor.ts` — classifyOutcome(vapiEvent) → OutcomeType enum (RESOLVED/PENDING/DENIED/ESCALATED/BLOCK_DETECTED/FAILED)

## 5 — Express server
- [ ] `src/server/index.ts` — Prisma singleton, Express app, CORS, JSON body, route mount, error handler
- [ ] Call scheduling guard: Mon–Fri 8am–5pm Eastern only
- [ ] CARRIER_BLOCK check before any call dispatch

## 6 — API routes (10 endpoints)
- [ ] `GET  /api/insurance/claims` — paginated list, filters: carrier, status, aging bucket
- [ ] `GET  /api/insurance/claims/:id` — claim detail + full call history
- [ ] `POST /api/insurance/claims/import` — CSV import via existing `src/claims/importer.js`
- [ ] `POST /api/insurance/queue/trigger/:claimId` — manual call trigger (respects block + scheduling rules)
- [ ] `GET  /api/insurance/queue` — queue snapshot: pending, in-progress, completed today
- [ ] `GET  /api/calls` — full call log with filters (carrier, outcome, date range)
- [ ] `GET  /api/calls/:id` — single call detail (transcript URL, outcome, rep name, reference number)
- [ ] `GET  /api/carriers/health` — per-carrier: acceptance rate, avg hold, resolution rate, block status
- [ ] `POST /api/carriers/:id/unblock` — resume calls after a block event
- [ ] `GET  /api/analytics/insurance` — time saved, dollars recovered, resolution rates, call volume over time

## 7 — Vapi webhook handler
- [ ] `POST /api/webhooks/vapi` — raw body parser (before JSON middleware)
- [ ] HMAC-SHA256 signature validation using `VAPI_WEBHOOK_SECRET`
- [ ] Write `CallAttempt` record on call-end event
- [ ] Detokenize patient token via `piiVault.detokenize()` for practice record updates only (never store)
- [ ] Classify outcome via `outcomeProcessor.classifyOutcome()`
- [ ] Detect carrier block signal → write `CarrierBlockEvent` → suspend all practice calls to that carrier
- [ ] Send SMS/email alert on carrier block (Twilio SMS + nodemailer)
- [ ] Update `CallQueue` status
- [ ] Update `InsuranceClaim` status
- [ ] Idempotency: skip if `vapiCallId` already exists in `CallAttempt`

## 8 — Analytics service
- [ ] `src/services/insurance-analytics.ts`
- [ ] `getTimeSaved(practiceId, dateRange)` — completed calls × 18 min
- [ ] `getDollarsRecovered(practiceId, dateRange)` — sum of resolved claim `outstandingAmount`
- [ ] `getResolutionRateByCarrier(practiceId)` — RESOLVED / total attempts per carrier
- [ ] `getCallVolumeOverTime(practiceId, dateRange)` — calls per day/week bucketed

## 9 — Verification
- [ ] `npm run typecheck` passes (tsc --noEmit)
- [ ] All imports resolve — no missing modules
- [ ] Webhook idempotency test: duplicate vapiCallId is a no-op
- [ ] Carrier block test: block signal fires suspension
- [ ] Analytics: time saved returns correct value for known dataset
- [ ] Update `.claude/reports/_registry.md`

---

---

## GoCardless PAD billing — go-live blockers (backlog, 2026-07-14)
> Integration code is complete and tested (src/server/gocardless/, routes, webhook, scheduler,
> frontend PAD card in PracticeBillingPage.tsx). Blocked on external account setup, not code.

- [ ] Register CollectRx as a formal business entity (if not already) — provincial registration or federal incorporation
- [ ] Open a Canadian business bank account (needed for GoCardless live payouts, not sandbox)
- [ ] Sign up for GoCardless **live** account, select Standard plan ($0.75%+$0.40, capped $3/transaction)
- [ ] Set `GOCARDLESS_ACCESS_TOKEN`, `GOCARDLESS_WEBHOOK_SECRET`, `GOCARDLESS_ENV=production`, `PAD_RECONCILE_ENABLED=1`
- [ ] No active practices as of 2026-07-14 (Dr. Hasan pilot went cold) — no urgency to rush this

## GoCardless PAD billing — unblocked next steps (no bank account needed)
- [ ] Sign up for a free GoCardless **sandbox** account (manage-sandbox.gocardless.com/sign-up) — no business bank account required
- [ ] Use sandbox `GOCARDLESS_ACCESS_TOKEN` to verify the integration end-to-end: create a Billing Request, complete the hosted flow with GoCardless's test bank details, confirm a subscription and webhook fire correctly
- [ ] This also resolves the one remaining unconfirmed detail from research: the exact `GoCardless-Version` header value and webhook event `action` strings, verified against a live (sandbox) response rather than secondary docs
- [ ] Write route-level tests for `src/server/routes/gocardlessRoutes.ts` (auth required, practice-owner required, happy path, validation error) — currently only the pure-logic `decidePadTransactionUpdate` function has test coverage

## Safety invariants (must hold in every file)
- `patientToken` is the ONLY patient identifier in DB tables touching Vapi
- `CARRIER_BLOCK` check fires before every call dispatch — no exceptions
- Calls only Mon–Fri 08:00–17:00 Eastern
- Max 3 attempts per claim
- Claims < 30 days: do not queue
- Claims > 90 days: escalate to human, skip AI

## Hold-park billing test (2026-07-23, redone 2026-07-25 after a concurrency incident)

- [x] Fly autostop fixed: `auto_stop_machines = false` in fly.toml, deployed, confirmed both app machines started with passing health checks, 15 request burst test over 2m24s all returned 200 with no cold start
- [x] Region mismatch confirmed and reported (not changed by this task): fly.toml declares primary_region yyz, worker machines run in yyz, app machines were in iad at first check. Re-checked after redeploying the autostop fix and both app and worker now show yyz, matching primary_region. This was not something this task changed, it shifted on its own between the two checks, most likely as a side effect of the concurrent session's deploys described below. Worth confirming this holds on its own, not treating it as a fix this task made.
- [x] Hold-park TwiML endpoint confirmed wired into src/server/index.ts, logs only call and conference identifiers (no PHI), verified against Twilio's own TwiML Conference reference for attribute correctness
- [x] Vapi vs Twilio webhook control layer resolved, then corrected: the earlier conclusion (Twilio Console webhook is the single control point) was wrong for a Vapi-managed number with no assistant attached. Real answer, confirmed via Twilio's own API: Console's Voice URL was pointed at Vapi's own infrastructure, not our endpoint at all. See tasks/lessons.md, 2026-07-25/26 entry, for the full corrected mechanism.
- [x] Number reuse: user made an informed call to reuse +16139098770 given zero active practices, rather than wait on a dedicated test number
- [x] Twilio API credentials obtained (Standard API Key, not the Auth Token) and stored as Fly secrets, used to directly change the number's Voice URL to our endpoint
- [x] Live test calls placed, five attempts, each one found and fixed a real bug: Vapi/Twilio traffic collision on one URL, the assistant-request interception, Twilio's own hold-music file 502ing, a ws library multi-path bug, and an auto-resume VAD window that was too long for short utterances. Full detail in tasks/lessons.md.
- [x] Billing question answered directly from real call data: Vapi's per-minute cost stops at the transfer moment (confirmed twice, billed minutes matched call duration to the transfer, not the full hold time)
- [ ] Auto-resume trigger recalibrated from real audio diagnostics but not yet confirmed working on a live call
- [ ] Twilio Voice URL for +16139098770 is currently pointed at our test endpoint, not Vapi's inbound handler; needs reverting once testing is done, since it currently can't be answered by any Vapi assistant for a genuine inbound call

### Concurrency incident, 2026-07-25

Partway through this task, a second concurrent Claude Code session (or manual work) was found operating on this same repository directory, committing and switching branches on `main`/`prd`/`feat/faster-load-download-nav` (unrelated brand logo release work) and deploying to the same collect-rx Fly app from a branch still carrying the old fly.toml. That deploy silently reverted `auto_stop_machines` back to true in production and wiped this session's uncommitted local edits to fly.toml, tasks/todo.md, tasks/lessons.md, and deleted the untracked src/webhooks/holdParkTest.ts entirely. All four were redone and the fix redeployed; confirmed live again via `fly config show` and a fresh no-cold-start check. See tasks/lessons.md for the full account. If two sessions are going to touch the same Fly app or the same working directory concurrently again, that needs coordinating up front, not discovered after the fact.

### Review

What was built and confirmed with real live calls: autostop fixed, hold-park TwiML working end to end, hold music self-hosted after Twilio's own default file proved unreliable, an auto-resume listener that dials the assistant back into the parked conference without any new Twilio number or REST credentials, and the actual billing question answered directly from Vapi's own call records (per-minute cost stops at the transfer). The webhook-layer question from the first pass of this task was answered wrong; corrected version with the real mechanism is in tasks/lessons.md.

What is still open: the auto-resume trigger's timing was just recalibrated from real diagnostic data and has not yet been confirmed on a live call, and the production number's Voice URL is currently pointed at the test endpoint rather than Vapi, which needs reverting once testing wraps up. See tasks/lessons.md, 2026-07-25/26 entry, for the full account of every bug found and how each was actually diagnosed rather than guessed at.
