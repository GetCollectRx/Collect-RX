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

## Safety invariants (must hold in every file)
- `patientToken` is the ONLY patient identifier in DB tables touching Vapi
- `CARRIER_BLOCK` check fires before every call dispatch — no exceptions
- Calls only Mon–Fri 08:00–17:00 Eastern
- Max 3 attempts per claim
- Claims < 30 days: do not queue
- Claims > 90 days: escalate to human, skip AI
