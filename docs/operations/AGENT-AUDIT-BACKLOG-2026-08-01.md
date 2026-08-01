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
| AA-14 | Bring `CHANGELOG.md` current (227 commits behind) | [ ] |
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

### AA-14 — Stale CHANGELOG
**Finding:** Last entry 2026-07-19; 227 commits have shipped since (eligibility engine, AbelDent connector, billing tiers, marketing engine, guardrails, recovery routing) with no changelog coverage.
**Definition of done:** `CHANGELOG.md` has entries (or one summarizing "Unreleased" section) covering user-visible changes since 2026-07-19.

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
| AA-18 | Consolidate root `agents/*.md` vs. `Collect-RX-main/agents/*.md` drift | [ ] |
| AA-19 | Fix schema-name references across agent docs (`Call`→`CallAttempt`, `PhiAccessLog`→`PhiAccessEvent`, `CARRIER_BLOCK`→`CarrierBlockEvent`/`BLOCK_DETECTED`, `QueueLog` removed) | [ ] |
| AA-20 | Fix stale pricing in `client-acquisition.md` / `practice-time-savings.md` ($599 → real tiers) | [ ] |
| AA-21 | Fix `collections-performance.md` stale fields/margins | [ ] |
| AA-22 | Add "carrier API access" threat category to `competitive-intelligence.md` | [ ] |
| AA-23 | Reconcile TAM/SAM figures between `market-intelligence.md` and the strategic analysis doc | [ ] |
| AA-24 | Fix `researcher.md`/`README.md` pipeline placement and overlap with Market/Competitive Intelligence | [ ] |
| AA-25 | Correct `voice-agent-trainer.md` to reflect the learning loop is a manual process today | [ ] |
| AA-26 | Mark `voice-of-customer.md` blocked/deferred until feedback-capture data plumbing exists | [ ] |

(Evidence for each is in the audit report; see `agents/README.md`'s roster for exact file paths. Root cause for AA-18/19/20/21/23 is the same: root `agents/` is a stale fork of `Collect-RX-main/agents/` — fixing AA-18 first (pick one canonical copy) may resolve several of these at once.)

---

## P3 — Low-risk / cosmetic

| ID | Task | Status |
|----|------|--------|
| AA-27 | Add `scope="col"` to the shared `Th`/`Thead` component (app-wide a11y fix) | [ ] |
| AA-28 | Electron `shell.openExternal` https-only check | [ ] |
| AA-29 | Electron `will-navigate` handler (carried over from 2026-05-29 security audit) | [ ] |
| AA-30 | Hash password-reset tokens at rest instead of storing plaintext | [ ] |

---

## Newly discovered while fixing the above

- **AA-32 — `src/routes/insurance.ts` has no test coverage at all.** No test file in the repo imports this route. It's a large, high-stakes file (manual carrier dispatch, PHI detokenization, escalation) — worth a dedicated route-test harness (supertest + mocked Prisma/session) as its own piece of work, not opportunistically added while fixing one bug in it.
- **AA-31 — No persisted CRTC-disclosure-compliance signal exists.** Found while fixing AA-02: `agents/incident-response.md` IC-3's SCOPE step assumed a `callQualityBreakdown->>'crtc_disclosure'` field; no such field exists anywhere, and call-quality-scorer's rubric grading isn't persisted to the DB at all. Today, scoping a CRTC-disclosure incident requires manually re-reading `CallAttempt.transcriptText` (while it still exists) or checking `GuardrailAudit.violationsJson` if the NeMo sidecar happened to flag it. **Recommendation:** persist call-quality-scorer's disclosure-check result (pass/fail + evidence) per `CallAttempt` so this is queryable — this is a real product gap, not just a doc fix, so it's tracked here rather than forced through as a one-line change.

## Not backlogged (needs a product/ops decision, not a code fix)

- **Voice of Customer** has no real data source to synthesize from at all (no churn survey, support tickets, NPS/CSAT, trial-exit capture) — building that capture surface is a product decision, tracked here as AA-26 (defer the agent) rather than a fix to force through unilaterally.
- **Twilio provisioning, Stripe live-mode cutover, Group E compliance/BAA sign-offs** — all ops/legal work with no code fix, tracked in `PATH-TO-DELIVERY.md`, not here.
