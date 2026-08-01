# Agent Audit Backlog — 2026-08-01

> **Source:** a full static/code-level run of all 29 agents in [`agents/README.md`](../../agents/README.md) against the codebase (no live DB/Vapi/Stripe credentials were available for that run). Each ticket below traces to a specific finding, file, and line. This is a **ticket backlog**, not a status tracker — for current launch-readiness, see [`PATH-TO-DELIVERY.md`](PATH-TO-DELIVERY.md).

**Ticket format:** ID, one-line task, definition of done, evidence. Status is updated in place as items are fixed — `[ ]` open, `[x]` done, with the fixing commit noted.

---

## P0 — Regulatory/safety/financial exposure in shipping code

| ID | Task | Status |
|----|------|--------|
| AA-01 | Log all real PHI detokenization call sites to `PhiAccessEvent` | [x] `b6ce362` |
| AA-02 | Fix Incident Response runbook kill-switch SQL (both `agents/` copies) | [x] |
| AA-03 | Fix `weeklyPilotReport.ts` to report verified recovered amounts, not billed amount | [x] |
| AA-04 | Create a `CallEscalation` (+ notify practice) when a claim auto-escalates past 90 days | [x] |
| AA-05 | Add FK constraint from `insurance_claims.practiceId` to `Practice` | [x] |
| AA-06 | Fix `CARRIER_TIMEOUTS` key mismatch (kebab-case vs. `CarrierId` enum) | [x] |
| AA-07 | Enforce per-carrier minimum wait (TELUS 21d / others 32d), wire TPA into AR dispatch | [x] |
| AA-08 | Fix pre-visit `IVR_Navigator` disclosure_message (must resolve empty) | [x] |
| AA-09 | Fix `avgAttempts` metric (currently always `1.0`) | [x] |
| AA-10 | Fix forensic logger dropping `Error.message`/`.stack` | [x] |

### AA-01 — PHI detokenization logging gap
**Finding:** Only 2 of 6 real `piiVault.detokenize()` call sites write a `PhiAccessEvent` row. Unlogged: `src/server/preVisit/preVisitDispatch.ts:69`, `src/server/preVisit/electronicPreVisit.ts:45,88`, `src/server/services/priorityEngine.ts:51`.
**Definition of done:** every call site above writes an `appendPhiAccessEvent` row with an accurate `operation` value before/around using the plaintext PHI; no plaintext PHI is used without a corresponding audit row.

### AA-02 — Incident Response runbook is unexecutable
**Finding:** `agents/incident-response.md:19` (kill-switch) references `Practice.queuePaused`, which doesn't exist (`PracticeDeskState` does, per-practice). `agents/incident-response.md:53-59` (carrier-block scoping) references `"Call"`/`CARRIER_BLOCK`, neither of which exist (`CallAttempt.carrierBlockDetected` does). `agents/incident-response.md:90-93` references `callQualityBreakdown->>'crtc_disclosure'`, which doesn't exist anywhere.
**Definition of done:** all three SQL snippets, in both `agents/incident-response.md` and `Collect-RX-main/agents/incident-response.md`, execute against the real schema.

### AA-03 — Client-facing revenue-recovered bug — FIXED
**Finding:** `src/server/reports/weeklyPilotReport.ts:61-65` summed `claim.billedAmount` for any `RESOLVED`-outcome call attempt and called it "Revenue recovered" — no link to actual payment verification. Currently inert only because `WEEKLY_PILOT_REPORT_ENABLED` is unset.
**Fix:** `buildWeeklyPracticeMetrics` now sums `ClaimRecoveryEvent.amountRecoveredCents` for `PAYMENT_VERIFIED_SYNC`/`MANUAL_PAYMENT_CONFIRMED` events in the report window, instead of `billedAmount`.
**Related bug found and fixed in the same pass:** `recoveryMetrics.ts` (all three dollar/count aggregations) and `claimRecoverySummary.ts` only counted `PAYMENT_VERIFIED_SYNC`, silently missing every `MANUAL_PAYMENT_CONFIRMED` claim — this fed the live practice dashboard's "Recovered 7d" tile (`dashboardRoutes.ts` → `LivingPipelineFlow.tsx`), so manually-closed claims were invisible there too, not just in the (currently-disabled) weekly email. Both now use a shared `VERIFIED_PAYMENT_EVENT_TYPES` list. Tests updated: `tests/weeklyPilotReport.test.ts` (new assertion pins the event-type filter), `tests/phase-5/recovery-golden-path.test.ts` (in-memory fake Prisma updated to support `{ in: [...] }` filters).

### AA-04 — Silent 90-day escalation — FIXED
**Finding:** `src/server/frontDesk/queueEngine.ts:139-173` (`settleBlockedCandidate`) set claim/queue status to `ESCALATED` for both `MAX_ATTEMPTS` and `ESCALATE_OVER_90`, but only called `createEscalation` for `MAX_ATTEMPTS`. Same gap in the manual-trigger path, `src/routes/insurance.ts:499-512`.
**Fix:** both paths now create a `CallEscalation` row (deduped like `MAX_ATTEMPTS` already was) and send a `CLAIM_AGED_OUT` practice notification (new type added to `PracticeNotification`) for the `ESCALATE_OVER_90` case. New test added: `tests/frontDesk/queueEngine.dispatch.test.ts` ("escalates a >90-day head claim to a human...").
**Known gap:** `routes/insurance.ts` has no existing test harness at all (no test file imports it) — the fix there mirrors the now-tested `queueEngine.ts` logic exactly, verified by typecheck/lint, but isn't independently covered by a route-level test. Building that harness is a bigger, separate investment — tracked as AA-32 below rather than bolted on here.

### AA-05 — Missing FK constraint — FIXED
**Finding:** `prisma/schema.prisma:611` (`InsuranceClaim.practiceId`) and ~10 sibling tables (`ClaimRecoveryAction`, `ClaimRecoveryEvent`, `ClaimEvidenceItem`, `CallQueue`, `PhiAccessEvent`, etc.) carry a denormalized `practiceId` with no `@relation` to `Practice`.
**Fix:** added the `InsuranceClaim.practice`/`Practice.insuranceClaims` relation to `prisma/schema.prisma` and migration `20260801000000_insurance_claims_practice_fk` (`ON DELETE RESTRICT ON UPDATE CASCADE`, added `NOT VALID` then validated in a separate statement so a large production table doesn't take a long exclusive lock during deploy). Sibling tables are tracked separately, not bundled into this one migration.
**Verified for real, not just written:** spun up a local Postgres 16 instance (this sandbox has the binary — no Docker needed) and actually ran `prisma migrate deploy` end-to-end against it. First attempt **failed** — a real orphaned `insurance_claims` row already existed, produced by the shared test helper `cleanupPracticeWithUsers()` (`tests/factories/practice.ts`), which deleted `User` rows and the `Practice` but never the claims a test had created, silently succeeding because there was no FK to stop it. This is precisely the failure mode AA-05 exists to prevent, caught in the act. Fixed the helper to delete `CallQueue`/`CallAttempt` (the two tables with `ON DELETE RESTRICT` against `insurance_claims`) and the claims themselves before the practice. Reset to a clean DB, reapplied all 61 migrations cleanly, ran the full suite (`npm test`, matching CI's Postgres setup) twice — 1364 passed / 8 skipped both times — and confirmed zero orphaned or leftover `insurance_claims` rows afterward. Also manually confirmed the constraint rejects a direct orphaned INSERT.

### AA-06 — Carrier timeout key mismatch — FIXED
**Finding:** `src/billing/tiers.ts:131-139` (`CARRIER_TIMEOUTS`) used kebab-case keys (`'rbc-insurance'`); `prisma/schema.prisma`'s `CarrierId` enum is snake_case (`rbc`). `src/vapi/client.ts:43-46` (`maxCallDurationSeconds`) does a direct lookup that only ever matched `manulife`, silently falling back to the 30-min default for every other carrier — truncating RBC's intended 45-min ceiling.
**Fix:** `CARRIER_TIMEOUTS` keys now match the `CarrierId` enum exactly (`rbc`, `sun_life`, `canada_life`, `green_shield`, `telus_adjudicare`, `manulife`). `tests/billingCatalog.test.ts` previously asserted the *old, wrong* keys and passed only because both sides of the lookup were consistently wrong — updated it to assert real enum values, which is what actually exercises the bug. Also fixed the same stale kebab-case carrier list, and a missing `Hold_Sentinel` in the squad roster, in `scheduledAgents.ts`'s `buildVapiSquadContext` (feeds the vapi-squad-auditor agent's LLM context — cosmetic but the same recurring "4-agent squad" mistake CLAUDE.md already had to correct once).

### AA-07 — TELUS wait rule + TPA wiring — FIXED
**Finding:** `src/carriers/adapter.ts:348-357` applied a flat 30-day floor to every carrier; the per-carrier `minWaitDayForClaims` from `carrier-configs.json` (32 for 5 carriers, 21 for TELUS) was read but never enforced (the code comment admitted it was "informational only"). Separately, TPA resolution was only called from the pre-visit estimate flow, never from `queueEngine.ts`'s AR-calling dispatch.
**Fix:** `validateDispatch`'s step 5 now gates on `CARRIER_CONFIGS[carrierId].minWaitDays` (carrier-specific) instead of a hardcoded 30; the redundant TELUS-only check is gone. `queueEngine.ts` now calls `identifyTelusPlan()` right after PHI resolution (where `subscriberId`/`groupPolicyNumber` are already available) for `telus_adjudicare` claims, and defers dispatch (`TELUS_TPA_UNRESOLVED`, 4h) if the TPA can't be identified or confidence is low. New tests added to `tests/phase-5/carrier-adapter.test.ts` (day-boundary behavior per carrier) and `tests/frontDesk/queueEngine.dispatch.test.ts` (TPA-unresolved defers, TPA-resolved dispatches). Also renumbered `validateDispatch`'s step comments, which had drifted (a missing step-3 label and a duplicate "7.") independent of this bug.

### AA-08 — Pre-visit disclosure leak risk — FIXED
**Finding:** `docs/compliance/crtc-disclosure-decision.md:47` requires `disclosure_message` to resolve empty for any IVR-navigator agent. The main claims squad does this correctly (`vapi-squad-config.json` hardcodes `firstMessage: ""`, not a variable at all). The pre-visit squad didn't: `src/vapi/client.ts:454-457` (`initiatePreVisitCall`) populated `disclosure_message` with a full sentence, and `vapi-previsit-config.json`'s `PreVisit_IVR_Navigator` spoke it immediately on connect — contradicting its own "silent, DTMF-only" system prompt. Note: this landed on an IVR machine, not a live rep, so it was never a confirmed live CRTC violation, but it broke this exact documented verification gate.
**Fix:** mirrored the main squad's pattern exactly. `PreVisit_IVR_Navigator.firstMessage` is now a literal `""` (`firstMessageMode: "assistant-waits-for-user"`), not a variable reference at all — it can no longer be made to speak by a bad variable value. The real disclosure text moved to `PreVisit_Agent.firstMessage` as a hardcoded template (same style as `Claims_Agent`), with a new `call_purpose` variable supplying just the reason-for-call clause. New tests in `tests/vapiClient.test.ts` pin both the runtime variable behavior and the config file's structure directly.

### AA-09 — Dead `avgAttempts` metric — FIXED
**Finding:** `src/server/services/platformReports.ts:130-133` incremented `agg.total` and `agg.attempts` identically on every `CallAttempt` row, so `attempts/total` was mathematically always `1`.
**Fix:** `computeCarrierStats` now groups attempts by `claimId`, sorts each claim's attempts chronologically, and — for claims that reached `RESOLVED` in the window — counts attempts up to and including the first resolution. `avgAttempts` is the average of that count across resolved claims, not a per-attempt-row ratio. Claims that never resolved in the window are correctly excluded from the average rather than dragging it toward 1. No test coverage existed for `platformReports.ts` at all — added `tests/platformReports.test.ts` covering the fix directly (including a case with extra post-resolution attempt rows, to prove only the *first* resolution counts).

### AA-10 — Forensic logger drops Error detail — FIXED
**Finding:** `src/logger.cjs`'s `scrubPhi` did `Object.entries()` over the log `meta`, then `winston.format.json()` serialized it. `Error` instances have non-enumerable `message`/`stack`, so `logger.error(msg, { error: someErr })` persisted as literal `{"error":{}}`. Consumed at `queueEngine.ts`'s Vapi-dispatch retry path (`logger.error('[deskQueueEngine] Vapi dispatch failed...', { error: dispatchErr })`), among others.
**Fix:** `scrubPhi` now detects `value instanceof Error` before the generic `Object.entries` branch and serializes `name`/`message`/`stack` explicitly, still running `message` through the existing PHI-pattern redaction. `logger.cjs` had zero test coverage — added `tests/logger.test.ts` (exposes `scrubPhi` via `logger._scrubPhi`, test-only hook) covering the fix plus regression coverage for the pre-existing PHI-field and pattern redaction.

---

## P1 — High-value fixes, no live-incident exposure

| ID | Task | Status |
|----|------|--------|
| AA-11 | Wire `Hold_Sentinel` webhook/`analysisPlan` in `vapi-squad-config.json` | [x] |
| AA-12 | Remove hardcoded `Khalid`/`khalid@collectrx.ca` sender identity from marketing engine | [x] |
| AA-13 | Add anti-impersonation instruction to `Escalation_Closer`/`Resolution_Closer` prompts | [x] |
| AA-14 | Bring `CHANGELOG.md` current (227 commits behind) | [x] |
| AA-15 | Fix `typecheck`/`postinstall` gap (`tsc --noEmit` needs `prisma generate` first) | [x] |
| AA-16 | Delete confirmed-dead code (`vapiWebhook.ts` deprecated handler, `outcomeClassifier.ts`) | [x] |
| AA-17 | Reconcile `carrierBlockPhrases.ts` vs. `processor.ts` block-phrase lists into one source | [x] |

### AA-11 — Hold_Sentinel has no reporting path — FIXED
**Finding:** `vapi-squad-config.json:185-221` — unlike the other 4 squad agents, `Hold_Sentinel` had no `server` webhook block and no `analysisPlan.structuredDataPlan`. If a call ended while control was with Hold_Sentinel (timeout, or the carrier hangs up during hold), nothing reached the backend for that leg.
**Fix:** copied `IVR_Navigator`'s `server`/`serverMessages`/`analysisPlan` block verbatim onto `Hold_Sentinel` (the closest analog — another silent-only agent with the same fallback-reporting need). New test in `tests/vapiSquadConfig.test.ts` asserts all 5 squad members have a server webhook and an enabled `structuredDataPlan`.

### AA-12 — Hardcoded personal identity in outbound email — FIXED
**Finding:** `src/server/marketing/outreachVoice.ts:15-16` hardcoded `OUTREACH_SIGNOFF = 'Khalid\nkhalid@collectrx.ca'`, consumed unconditionally across template call sites in `emailTemplates.ts`, `emailCampaignTemplates.ts`, `emailLayout.ts`, `prospectEmail.ts`.
**Fix:** `outreachVoice.ts` now derives the sender identity from env vars with the old literals as fallback defaults (so unset-env behavior is unchanged): `OUTREACH_SENDER_NAME` (`MARKETING_OUTREACH_SENDER_NAME`, default `'Khalid'`), `OUTREACH_SENDER_FULL_NAME` (`MARKETING_OUTREACH_SENDER_FULL_NAME`, default `'Khalid Egeh'`), `OUTREACH_SENDER_EMAIL` (`MARKETING_OUTREACH_SENDER_EMAIL`, default `'khalid@collectrx.ca'`); `OUTREACH_SIGNOFF`/`OUTREACH_SIGNOFF_HTML` now build from those instead of literals. Every consumer switched from the hardcoded string to the exported constant: `emailTemplates.ts` (`"I'm ${OUTREACH_SENDER_NAME}, a founder..."`, was a literal `"I'm Khalid, ..."` in two places), `emailLayout.ts` (footer line now `${OUTREACH_SENDER_FULL_NAME} | CollectRx | ...`), `prospectEmail.ts` (SendGrid `from`/`fromName` fallback now `OUTREACH_SENDER_EMAIL`/`OUTREACH_SENDER_NAME` instead of literal `'khalid@collectrx.ca'`/`'Khalid'`), `emailCampaignTemplates.ts` (both signature blocks). Verified `grep -rn "Khalid\|khalid@collectrx" src/server/marketing/*.ts` now matches only the three default-value definitions in `outreachVoice.ts`. `npx tsc --noEmit` and `npx eslint` on all five touched files are clean (one pre-existing `no-console` warning in `prospectEmail.ts`, unrelated). `tests/emailCampaignScheduler.test.ts` and `tests/marketing/partnerships.test.ts` (27 tests, including two asserting the default `'Khalid'` signoff still renders) pass unchanged, confirming default behavior is preserved.
**Note:** `src/server/observability/startupAlerts.ts` has a similar `khalid@collectrx.ca` default for ops alert email, but it's already env-overridable (`STARTUP_ALERT_EMAIL_TO`/`OPS_ALERT_EMAIL_TO`) and is unrelated to the marketing engine this ticket scoped — left as-is, same "default + env override" pattern this repo already uses elsewhere (e.g. `SEED_PRACTICE_EMAIL`).

### AA-13 — Missing anti-impersonation instruction — FIXED
**Finding:** Only `Claims_Agent`'s system prompt (`vapi-squad-config.json:234`) had "Do not claim to be human if asked directly." `Escalation_Closer` (line ~437) and `Resolution_Closer` (line ~599) both converse directly with a live rep with no equivalent instruction.
**Fix:** added "If asked directly whether you are human or an automated system, answer honestly - do not claim to be human." to both prompts. New test `tests/vapiSquadImpersonationGuard.test.ts` asserts all three conversational agents (not `IVR_Navigator`/`Hold_Sentinel`, which never converse by design) carry the instruction.

### AA-14 — Stale CHANGELOG — FIXED
**Finding:** Last entry 2026-07-19; 227 commits have shipped since (eligibility engine, AbelDent connector, billing tiers, marketing engine, guardrails, recovery routing) with no changelog coverage.
**Fix:** reviewed `git log origin/main --since=2026-07-19` (69 commits on the actual trunk, excluding merge noise) and grouped the user-visible changes into the existing `[Unreleased]` section's Added/Changed/Fixed/Security buckets: weekly pilot reports, the Day 30/60/90 dashboard, pilot runbook pages, the email campaign system, accessibility/WCAG fixes, the Railway→Fly migration, the pre-push CI-mirroring hook, and the new brand logo under Added/Changed; PHI GCM auth-tag enforcement, the CDCP tenant-identity fix, the email-events auth-gate gap, npm audit clears, and this session's own AA-01 through AA-13/15-17 fixes (TELUS wait-day enforcement, 90-day escalation notifications, verified-revenue reporting, the practice FK, carrier-timeout keys, Hold_Sentinel webhook wiring, dead-code removal) under Fixed; the pre-visit token boundary and CASL enforcement under Security. Kept the format consistent with the file's existing Keep a Changelog structure.

### AA-15 — Typecheck false-positive gap — FIXED
**Finding:** `npm ci && npx tsc --noEmit` gave 391 false "no exported member" errors because `postinstall` didn't run `prisma generate`. CI's workflow does this step explicitly, so production CI was unaffected, but the documented local commands weren't consistent with what CI actually runs.
**Fix:** `package.json`'s `postinstall` now runs `prisma generate` after the existing electron-symlink step, so a bare `npm ci` leaves a working Prisma client behind — no separate manual step needed. Verified by running `npm run postinstall` directly.

### AA-16 — Dead code cleanup — FIXED
**Finding:** `src/server/vapi/vapiWebhook.ts:547-596` (`handleVapiWebhook`) was self-documented `@deprecated ... never mounted, never called`, confirmed zero references anywhere including tests. `src/server/services/outcomeClassifier.ts` implemented the exact anti-hallucination-violating pattern the backend-reviewer checklist forbids (keyword-regex → `RESOLVED`, no gating), with zero production importers — a landmine if ever wired in.
**Fix:** re-confirmed zero references (grepped the whole repo, not just the files the earlier audit read) before deleting. Removed `handleVapiWebhook`, its only-used-by-it helpers `verifyVapiAuth` and `responseForVapiMessage`, and the now-unused `Request`/`Response` import from `vapiWebhook.ts`; updated the file's header comment, which described the removed auth mechanism as the file's main purpose when it isn't (the real exports are the call-ended processing pipeline consumed by `src/webhooks/vapi.ts`). Deleted `outcomeClassifier.ts` entirely and its dedicated test block in `tests/platformBrief.test.ts` (kept that file's unrelated "role gate expectations" describe block intact). Full suite re-run clean: 1369 passed / 8 skipped.

### AA-17 — Divergent CARRIER_BLOCK phrase lists — FIXED
**Finding:** the live-transcript scanner (`carrierBlockPhrases.ts`) and the end-of-call fallback classifier (`processor.ts`'s `BLOCK_SIGNAL_PATTERNS`/`LEGACY_CARRIER_BLOCK_INCLUDES`) maintained separate, non-identical phrase lists — real, concrete gap: several `carrierBlockPhrases.ts` phrases (e.g. "we don't work with robots", the exact wording Claims_Agent's own refusal protocol anticipates) were invisible to the end-of-call classifier.
**Fix:** `processor.ts` now imports `getActiveBlockPhrases()` from `carrierBlockPhrases.ts` and checks it inside `matchLegacyTranscript`, in addition to its own regex patterns (kept — they catch flexible phrasing a literal list can't). The literal phrases from the retired `LEGACY_CARRIER_BLOCK_INCLUDES` were merged into `carrierBlockPhrases.ts`'s baseline (the `'carrier_block'` status-code literal stayed processor-specific — it's not a spoken phrase). Bonus: the end-of-call classifier now also benefits from self-tuner-learned block phrases, which it never did before. New test in `tests/phase-5/outcome-processor.test.ts` proves a phrase that only ever lived in the live-scanner list is now caught by the end-of-call classifier too.

---

## P2 — Documentation & consistency (agent docs drifted from real schema/code)

| ID | Task | Status |
|----|------|--------|
| AA-18 | Consolidate root `agents/*.md` vs. `Collect-RX-main/agents/*.md` drift | [x] |
| AA-19 | Fix schema-name references across agent docs (`Call`→`CallAttempt`, `PhiAccessLog`→`PhiAccessEvent`, `CARRIER_BLOCK`→`CarrierBlockEvent`/`BLOCK_DETECTED`, `QueueLog` removed) | [x] |
| AA-20 | Fix stale pricing in `client-acquisition.md` / `practice-time-savings.md` ($599 → real tiers) | [x] |
| AA-21 | Fix `collections-performance.md` stale fields/margins | [x] |
| AA-22 | Add "carrier API access" threat category to `competitive-intelligence.md` | [x] |
| AA-23 | Reconcile TAM/SAM figures between `market-intelligence.md` and the strategic analysis doc | [x] |
| AA-24 | Fix `researcher.md`/`README.md` pipeline placement and overlap with Market/Competitive Intelligence | [x] |
| AA-25 | Correct `voice-agent-trainer.md` to reflect the learning loop is a manual process today | [x] |
| AA-26 | Mark `voice-of-customer.md` blocked/deferred until feedback-capture data plumbing exists | [x] |

(Evidence for each is in the audit report; see `agents/README.md`'s roster for exact file paths. Root cause for AA-18/19/20/21/23 is the same: root `agents/` is a stale fork of `Collect-RX-main/agents/` — fixing AA-18 first (pick one canonical copy) may resolve several of these at once.)

### AA-18 — Root `agents/*.md` vs. `Collect-RX-main/agents/*.md` drift — FIXED
**Finding:** 5 of 31 agent doc files had diverged between the two copies (`README.md`, `compliance-checker.md`, `product-manager.md`, `risk-radar.md`, `vapi-squad-auditor.md`). The root copies described the PHI-in-Vapi-prompt and BAAL-gate decisions as still-open P0 blockers ("**P0 OPEN:** PHI variables... found in `vapi-system-prompt.md`"); the `Collect-RX-main` copies correctly described both as closed (2026-06-20, Option B ephemeral variables; BAAL hard-enforced in `checkCarrierAuthorizationGate()`). Verified against actual code (`docs/compliance/PHI-VAPI-BOUNDARY.md` exists, `checkCarrierAuthorizationGate()` is real and wired into `validateDispatch()` in `src/carriers/adapter.ts`) — the `Collect-RX-main` copies are accurate; root's were stale.
**Fix:** copied the 5 `Collect-RX-main/agents/*.md` files over their root counterparts (root now mirrors main exactly for all 31 files). Picked `Collect-RX-main` as canonical since it reflected verified-current reality; root did not.

### AA-19 — Stale schema-name references across agent docs — FIXED
**Finding:** beyond the 5 files from AA-18, six more agent docs (`analytics-pipeline.md`, `risk-radar.md`, `phi-access-log-reviewer.md`, `hallucination-detector.md`, `call-quality-scorer.md`, `practice-time-savings.md`, plus `runtime/schedules.md`) contained SQL/prose referencing tables, columns, and enum values that don't exist in `prisma/schema.prisma`: a `"Call"` table (real: `call_attempts`, snake_case columns via `@map`), `PhiAccessLog`/`phi_access_log` (real: `PhiAccessEvent`/`phi_access_events`, with `operation` not `action`, `actorId` not `performedBy`), `QueueLog` (doesn't exist at all — no dedicated queue-engine heartbeat table), `platform_admin_grants` (real: `platform_admin_practice_grants`, columns `admin_user_id`/`practice_id`), and a `CARRIER_BLOCK` outcome literal (real `CallOutcome` enum value is `BLOCK_DETECTED`). Two deeper correctness bugs surfaced while fixing this: (1) `hallucination-detector.md` and `practice-time-savings.md` queried `outcome IN (..., 'APPROVED_PENDING_PAYMENT')` against `call_attempts.outcome`, but `APPROVED_PENDING_PAYMENT` is a `ClaimStatus` value (`insurance_claims.status`), not a `CallOutcome` value — two different enums on two different tables, conflated; (2) `phi-access-log-reviewer.md`'s "detokenize without completed call" check assumed detokenization happens *after* a call completes, but per the PHI boundary design it happens server-side *before* dispatch — the check was comparing against the wrong timestamp field in the wrong direction.
**Fix:** rewrote every affected SQL block against the real schema (correct table/column names, correct joins through `insurance_claims` where `practice_id`/`carrier_id` live, correct enum values), fixed the two conflated-enum bugs by joining `insurance_claims` for claim-level status where needed, fixed the detokenize-timing check to compare `initiated_at` after the PHI event instead of `completed_at` before it, and replaced the fictional `QueueLog` heartbeat with a documented proxy query against `call_queue.updated_at` (explicitly noting the false-positive risk when the queue is simply empty). Also found and documented a real product gap while fixing `phi-access-log-reviewer.md`: only `detokenize_*` PHI access is logged today — staff `view`/`export` access (which the doc assumed was already logged) isn't instrumented at all. Documented as a known gap in the doc itself (flag it in the monthly report) rather than silently fixing the doc's premise; not itemized as a separate backlog ticket since it's the same class of gap as AA-31.
**Fix (call-quality-scorer.md specific):** that doc's 5-dimension manual rubric (CRTC/PHI/Accuracy/Efficiency/Escalation) has no dedicated persistence at all (`call_quality_score` etc. columns don't exist) — it's a different, not-yet-implemented scoring system from the real, already-shipping 8-dimension automated LLM eval in `src/services/analytics/automated-eval.ts` (persisted to `call_attempts.eval_scores`/`eval_completed_at`). Documented the distinction explicitly so the two aren't conflated, and pointed the "practice-level quality tracking" query at the real `eval_scores` data as the closest available proxy.

### AA-20 — Stale $599 Core-tier pricing — FIXED
**Finding:** `client-acquisition.md`, `practice-time-savings.md`, `roi-proof.md`, and `competitive-intelligence.md` (all quoted $599/mo for Core and $1,299/$1,499 for Growth/Scale. Real current pricing (`src/billing/tiers.ts`): Core $799, Growth $1,999, Scale $2,499.
**Fix:** updated all four files to the real numbers and pointed each at `src/billing/tiers.ts` as the source of truth instead of hardcoding a number that will drift again next price change.

### AA-21 — `collections-performance.md` stale fields/margins — FIXED
**Finding:** gross margins listed as Core 82% / Scale 43% — real values (`src/billing/tiers.ts`) are Core 79% / Scale 78% (Scale's was off by 35 points). The doc also referenced fields/enum values that don't exist: `amountClaimed`, `attemptNumber`, `daysSinceSubmitted`, a `CLAIM_PAID` outcome, and a `CARRIER_BLOCKED` status (real: `BLOCKED`).
**Fix:** corrected the margin figures, replaced `amountClaimed`/`CLAIM_PAID` with the real `claim_recovery_events.amount_recovered_cents` / `RESOLVED` fields (consistent with the AA-03 fix), pointed "avg calls to resolution" at the real per-claim attempt computation in `platformReports.ts` (AA-09) instead of a nonexistent `attemptNumber` column, replaced `daysSinceSubmitted` with the real persisted `insurance_claims.days_outstanding`, and fixed `CARRIER_BLOCKED` → `BLOCKED`.

### AA-22 — Missing "carrier API access" threat category — FIXED
**Finding:** `competitive-intelligence.md`'s adjacent-competitor table had no row for the actual highest-leverage threat: any of the six carriers shipping their own claim-status API for authorized billing agents, which would make phone-call automation for that carrier unnecessary without any competitor having to build anything. `risk-radar.md`'s Domain 7 already named this risk ("Major carrier announces API access for providers") but `competitive-intelligence.md` never operationalized it into a monitored category.
**Fix:** added a table row and a "Biggest Competitive Risk" callout for carrier API access, plus a new "Carrier API Access Watch" monthly checklist section (checking each carrier's provider/developer portal).

### AA-23 — TAM/SAM figures not reconciled — FIXED
**Finding:** `market-intelligence.md`'s monthly report template asked the agent to re-derive TAM/SAM from scratch each month (`[n practices × $X avg contract value]`) with no reference to `docs/strategy/CollectRx_Strategic_Analysis.md` §4, which already has baseline TAM/SAM/SOM estimates — an open invitation for the two to silently diverge. Separately, the strategic analysis doc's SAM calculation used a stale "C$500–800/month" pricing assumption that predates the current Core/Growth/Scale tiers.
**Fix:** `market-intelligence.md` now points explicitly at the strategic analysis doc as the canonical baseline and instructs reconciling against it rather than re-deriving independently. Fixed the stale pricing assumption in the strategic analysis doc's SAM section to reference real tier pricing, and flagged (without inventing a new number myself) that the blended ARR estimate should be recomputed against the real tier mix.

### AA-24 — `researcher.md` mis-placed in the Build Safety pipeline — FIXED
**Finding:** `agents/README.md`'s "On-Demand / Per-Deploy — Build Safety" pipeline listed Researcher as a sequential stage between Release Readiness and Incident Response (`... → Release Readiness → Researcher → Incident Response`). Researcher is an on-demand utility for one-off sourced questions (carrier IVR behavior, CRTC/PHIPA text, competitor teardowns) — it has no relationship to release/deploy safety, and its subject matter overlaps with Market Intelligence and Competitive Intelligence without any documented relationship between them.
**Fix:** removed Researcher from the Build Safety pipeline chain, added a new "On-Demand — Cross-Cutting Utility" section explaining it's invoked ad hoc by any other agent (not a pipeline stage), and clarified the actual relationship to Market/Competitive Intelligence: those run monthly from a standing checklist, Researcher answers one specific question on demand and should be invoked *by* them when their checklist needs deeper primary-source digging.

### AA-25 — `voice-agent-trainer.md` overclaimed automation — FIXED
**Finding:** the doc's "Prompt Change Protocol" (dry-run test call, 48-hour automated call-quality monitoring with rollback) reads as if wired into code. Checked `src/server/learning/` (the real, code-integrated "Phase 6 learning loop", gated behind `LEARNING_LOOP_ENABLED`): `implementRankedItem()` only pulls a backlog item from Notion, researches it, and writes an auto-generated markdown doc to `docs/learning-autogen/` — it never touches `vapi-squad-config.json`, never runs a test call, and there's no call-quality score to monitor for a rollback decision (per AA-19/AA-21, `call_quality_score` isn't a persisted field at all).
**Fix:** added an explicit note that the entire prompt-editing workflow in this doc is manual (a human + LLM session does the edit, review, dry-run, and monitoring by hand), and clarified `src/server/learning/`'s real Phase 6 loop is a separate, narrower, research-only system — not to be confused with this doc's workflow.

### AA-26 — `voice-of-customer.md` has no real data source — FIXED
**Finding:** every input this agent depends on (trial exit surveys, churn surveys, support ticket categorization, NPS/CSAT) is aspirational. Grepped `src/` for any trial-exit-survey, churn-survey, support-ticket, or NPS/CSAT capture code — none exists. Running this agent as written today would mean fabricating "customer feedback."
**Fix:** added a blocked banner at the top of the doc stating plainly that it should not be run until the underlying capture plumbing exists, named which decision needs to be made first (which channel to build — trial-exit prompt, churn-reason field, support inbox), and carved out the one genuinely-runnable subset today (forum/review-site signals, which need no new plumbing) so that isn't thrown out with the rest. Updated `agents/README.md`'s roster to flag the blocked status inline.

---

## P3 — Low-risk / cosmetic

| ID | Task | Status |
|----|------|--------|
| AA-27 | Add `scope="col"` to the shared `Th`/`Thead` component (app-wide a11y fix) | [x] |
| AA-28 | Electron `shell.openExternal` https-only check | [x] |
| AA-29 | Electron `will-navigate` handler (carried over from 2026-05-29 security audit) | [x] |
| AA-30 | Hash password-reset tokens at rest instead of storing plaintext | [x] |

### AA-27 — Missing `scope="col"` on table headers — FIXED
**Finding:** the shared `Th` component (`src/components/ui/Table.tsx`) rendered `<th>` with no `scope` attribute — a screen reader can't reliably associate a data cell with its column header without it. Six more files bypassed the shared component with raw `<th>` elements, same gap: `PreVisitCommandCenter.tsx`, `GroupDashboard.tsx`, `ProductUsageAnalytics.tsx`, `Admin.tsx`, `OfficeGuide.tsx`.
**Fix:** added `scope="col"` as the default on the shared `Th` component (still overridable via props spread), and added it explicitly to all raw `<th>` elements in the six files above. `npx tsc --noEmit` and `npm run lint` clean.

### AA-28/AA-29 — Electron `shell.openExternal` unrestricted + no `will-navigate` guard — FIXED
**Finding:** `desktop/main.js`'s `setWindowOpenHandler` called `shell.openExternal(url)` on any URL a page tried to `window.open()`, with no protocol check — a compromised or malicious page in the renderer could hand the OS shell a `file:`, `javascript:`, or arbitrary custom-protocol URI. Separately, there was no `will-navigate` handler, so a full in-window navigation (not just `window.open`) away from the app's own origin was unrestricted — the renderer could be redirected to load attacker-controlled content directly into the privileged Electron window.
**Fix:** added `isSafeExternalUrl()` (https-only in production, http allowed only in dev for localhost) gating every `shell.openExternal()` call, and a `will-navigate` handler that allows same-origin navigation (via `isSameOrigin()` against `WINDOW_ENTRY_URL`) and denies everything else, handing safe http(s) URLs to the system browser instead of loading them in-window. Verified with `node --check desktop/main.js` (this file is Node/CommonJS and outside `npm run lint`'s `src/**/*.{ts,tsx}` scope, consistent with how the rest of `desktop/` is already validated).

### AA-30 — Plaintext password-reset tokens at rest — FIXED
**Finding:** `authRoutes.ts`'s `/reset-password/request` stored the raw `randomBytes(32).toString('hex')` reset token directly in `passwordResetToken.token`, and `/reset-password/confirm` looked it up by the raw value. A read-only DB compromise or backup leak would hand an attacker live, unexpired, directly-usable account-takeover tokens — no additional attack needed.
**Fix:** added `hashResetToken()` (SHA-256 — deliberately not bcrypt; the token already has 256 bits of entropy from `randomBytes`, so bcrypt's slowness buys nothing against brute-forcing a specific token within its 1-hour expiry, unlike a low-entropy password). `/request` now stores the hash; `/confirm` hashes the incoming token before lookup. The raw token is unchanged everywhere it's user-facing (emailed link). New test in `tests/adversarial.smoke.test.ts` (`Password reset token is stored hashed, not plaintext, and still round-trips`) recovers the raw token via the SendGrid-unset console-fallback path, asserts the DB value is a 64-hex-char hash that is NOT the raw token, then confirms the reset still succeeds end-to-end with the raw token and the password actually changes. Verified against real local Postgres: full suite 1370 passed / 8 skipped, `npm run lint` 0 errors.

---

## Newly discovered while fixing the above

- **AA-32 — `src/routes/insurance.ts` route-level test coverage — FIXED (partially pre-existing, gap closed).** The original finding ("no test file imports this route") was already stale by the time this was worked: `tests/cross-practice-idor.test.ts` covers IDOR/practice-scoping for GET/PATCH `/claims`, `/claims/:id`, `/confirm-payment`, `/resolve-escalation`. What had zero HTTP-level coverage were the two highest-stakes endpoints: `DELETE /claims/:id` (soft delete, including the CALLING-status 409 block) and `POST /queue/trigger/:claimId` (the dispatch guard — CARRIER_BLOCK, BAAL/authorization, days-outstanding rules — all evaluated before any Vapi call is placed), plus `GET /queue`. Added `tests/insuranceRoutes.test.ts` (6 new tests, real Postgres, same `describe.skipIf(!dbReady)` pattern as the rest of the suite): DELETE success + excluded-from-reads, DELETE blocked while `CALLING`, DELETE 404 for nonexistent claim, dispatch-trigger 404 for nonexistent claim, dispatch-trigger rejected by the safety guard (`VOICE_AGENT_DISABLED` — the default for any practice with no carrier settings configured) without ever flipping claim status to `CALLING`, and `GET /queue` snapshot correctly scoped to the caller's practice only. Full happy-path dispatch through to a live Vapi call is intentionally not covered — that needs a Vapi-client mock and is a larger, separate piece of work. Verified against real local Postgres: full suite 1376 passed / 8 skipped (up from 1370), `npx tsc --noEmit` and `npm run lint` clean.
- **AA-31 — No persisted CRTC-disclosure-compliance signal exists.** Found while fixing AA-02: `agents/incident-response.md` IC-3's SCOPE step assumed a `callQualityBreakdown->>'crtc_disclosure'` field; no such field exists anywhere, and call-quality-scorer's rubric grading isn't persisted to the DB at all. Today, scoping a CRTC-disclosure incident requires manually re-reading `CallAttempt.transcriptText` (while it still exists) or checking `GuardrailAudit.violationsJson` if the NeMo sidecar happened to flag it. **Recommendation:** persist call-quality-scorer's disclosure-check result (pass/fail + evidence) per `CallAttempt` so this is queryable — this is a real product gap, not just a doc fix, so it's tracked here rather than forced through as a one-line change.

## Not backlogged (needs a product/ops decision, not a code fix)

- **Voice of Customer** has no real data source to synthesize from at all (no churn survey, support tickets, NPS/CSAT, trial-exit capture) — building that capture surface is a product decision, tracked here as AA-26 (defer the agent) rather than a fix to force through unilaterally.
- **Twilio provisioning, Stripe live-mode cutover, Group E compliance/BAA sign-offs** — all ops/legal work with no code fix, tracked in `PATH-TO-DELIVERY.md`, not here.
