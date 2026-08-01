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
| AA-05 | Add FK constraint from `insurance_claims.practiceId` to `Practice` | [ ] |
| AA-06 | Fix `CARRIER_TIMEOUTS` key mismatch (kebab-case vs. `CarrierId` enum) | [ ] |
| AA-07 | Enforce per-carrier minimum wait (TELUS 21d / others 32d), wire TPA into AR dispatch | [ ] |
| AA-08 | Fix pre-visit `IVR_Navigator` disclosure_message (must resolve empty) | [ ] |
| AA-09 | Fix `avgAttempts` metric (currently always `1.0`) | [ ] |
| AA-10 | Fix forensic logger dropping `Error.message`/`.stack` | [ ] |

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

### AA-05 — Missing FK constraint
**Finding:** `prisma/schema.prisma:611` (`InsuranceClaim.practiceId`) and ~10 sibling tables (`ClaimRecoveryAction`, `ClaimRecoveryEvent`, `ClaimEvidenceItem`, `CallQueue`, `PhiAccessEvent`, etc.) carry a denormalized `practiceId` with no `@relation` to `Practice`.
**Definition of done:** a new Prisma migration adds the FK (at minimum on `InsuranceClaim`, the highest-value table); migration tested against staging before prod per `Collect-RX-main/CLAUDE.md`'s own migration checklist (this is a schema change on a live multi-tenant table — do not `prisma migrate deploy` straight to prod without that staging pass).

### AA-06 — Carrier timeout key mismatch
**Finding:** `src/billing/tiers.ts:131-139` (`CARRIER_TIMEOUTS`) uses kebab-case keys (`'rbc-insurance'`); `prisma/schema.prisma`'s `CarrierId` enum is snake_case (`rbc`). `src/vapi/client.ts:43-46` (`maxCallDurationSeconds`) does a direct lookup that only ever matches `manulife`, silently falling back to the 30-min default for every other carrier — truncating RBC's intended 45-min ceiling.
**Definition of done:** `CARRIER_TIMEOUTS` keys match `CarrierId` enum values exactly; a call to `maxCallDurationSeconds('rbc')` returns 45 minutes, not the default.

### AA-07 — TELUS wait rule + TPA wiring
**Finding:** `src/carriers/adapter.ts:348-357` applies a flat 30-day floor to every carrier; the per-carrier `minWaitDayForClaims` from `carrier-configs.json` (32 for 5 carriers, 21 for TELUS) is read but never enforced (the code comment admits it's "informational only"). Separately, `getTelusTpa()` is only called from the pre-visit estimate flow, never from `queueEngine.ts`'s AR-calling dispatch.
**Definition of done:** `validateDispatch` gates on the carrier-specific minimum from `carrier-configs.json`, not a hardcoded 30; TELUS claims resolve a TPA before AR dispatch, and dispatch is blocked on an unresolved/low-confidence TPA.

### AA-08 — Pre-visit disclosure leak risk
**Finding:** `docs/compliance/crtc-disclosure-decision.md:47` requires `disclosure_message` to resolve empty for any IVR-navigator agent. The main claims squad does this correctly (`vapi-squad-config.json` hardcodes `firstMessage: ""`). The pre-visit squad doesn't: `src/vapi/client.ts:454-457` (`initiatePreVisitCall`) populates `disclosure_message` with a full sentence, and `vapi-previsit-config.json:8-10`'s `PreVisit_IVR_Navigator` speaks it immediately on connect — contradicting its own "silent, DTMF-only" system prompt.
**Definition of done:** `initiatePreVisitCall` sends an empty `disclosure_message` to `PreVisit_IVR_Navigator`; the real disclosure text is reserved for `PreVisit_Agent` (the agent that actually talks to a person).

### AA-09 — Dead `avgAttempts` metric
**Finding:** `src/server/services/platformReports.ts:130-133` increments `agg.total` and `agg.attempts` identically on every `CallAttempt` row, so `attempts/total` is mathematically always `1`.
**Definition of done:** `avgAttempts` reflects real attempts-per-claim-to-resolution (group by claim, count attempts to the first resolving outcome).

### AA-10 — Forensic logger drops Error detail
**Finding:** `src/logger.cjs`'s `scrubPhi` does `Object.entries()` over the log `meta`, then `winston.format.json()` serializes it. `Error` instances have non-enumerable `message`/`stack`, so `logger.error(msg, { error: someErr })` persists as literal `{"error":{}}` — reproduced directly against this winston config. Consumed at `queueEngine.ts:571-576`, the Vapi-dispatch retry path.
**Definition of done:** logging an `Error` under any key preserves `message` and `stack` in the persisted JSON.

---

## P1 — High-value fixes, no live-incident exposure

| ID | Task | Status |
|----|------|--------|
| AA-11 | Wire `Hold_Sentinel` webhook/`analysisPlan` in `vapi-squad-config.json` | [ ] |
| AA-12 | Remove hardcoded `Khalid`/`khalid@collectrx.ca` sender identity from marketing engine | [ ] |
| AA-13 | Add anti-impersonation instruction to `Escalation_Closer`/`Resolution_Closer` prompts | [ ] |
| AA-14 | Bring `CHANGELOG.md` current (227 commits behind) | [ ] |
| AA-15 | Fix `typecheck`/`postinstall` gap (`tsc --noEmit` needs `prisma generate` first) | [ ] |
| AA-16 | Delete confirmed-dead code (`vapiWebhook.ts` deprecated handler, `outcomeClassifier.ts`) | [ ] |
| AA-17 | Reconcile `carrierBlockPhrases.ts` vs. `processor.ts` block-phrase lists into one source | [ ] |

### AA-11 — Hold_Sentinel has no reporting path
**Finding:** `vapi-squad-config.json:185-221` — unlike the other 4 squad agents, `Hold_Sentinel` has no `server` webhook block and no `analysisPlan.structuredDataPlan`. If a call ends while control is with Hold_Sentinel (45-min timeout, or the carrier hangs up during hold), nothing reaches the backend for that leg.
**Definition of done:** `Hold_Sentinel` has the same webhook/structured-output wiring as the other 4 agents.

### AA-12 — Hardcoded personal identity in outbound email
**Finding:** `src/server/marketing/outreachVoice.ts:15-16` hardcodes `OUTREACH_SIGNOFF = 'Khalid\nkhalid@collectrx.ca'`, consumed unconditionally across 27+ template call sites in `emailTemplates.ts`, `trialOnboarding.ts`, `replyTemplates.ts`.
**Definition of done:** sender identity is configurable (env var or practice/org setting), matching root `CLAUDE.md`'s "no hardcoded practice names, emails, or credentials in code" rule; existing behavior can default to the same value via env var so nothing breaks if unset.

### AA-13 — Missing anti-impersonation instruction
**Finding:** Only `Claims_Agent`'s system prompt (`vapi-squad-config.json:234`) has "Do not claim to be human if asked directly." `Escalation_Closer` (line ~437) and `Resolution_Closer` (line ~599) both converse directly with a live rep with no equivalent instruction.
**Definition of done:** both agents' prompts include the same honest-disclosure instruction.

### AA-14 — Stale CHANGELOG
**Finding:** Last entry 2026-07-19; 227 commits have shipped since (eligibility engine, AbelDent connector, billing tiers, marketing engine, guardrails, recovery routing) with no changelog coverage.
**Definition of done:** `CHANGELOG.md` has entries (or one summarizing "Unreleased" section) covering user-visible changes since 2026-07-19.

### AA-15 — Typecheck false-positive gap
**Finding:** `npm ci && npx tsc --noEmit` gives 391 false "no exported member" errors because `postinstall` doesn't run `prisma generate`. CI's workflow does this step explicitly, so production CI is unaffected, but the documented local commands aren't consistent with what CI actually runs.
**Definition of done:** either `postinstall` runs `db:generate`, or `CLAUDE.md`/`package.json` scripts make the dependency explicit so a bare `npm ci` + `tsc --noEmit` doesn't produce false errors.

### AA-16 — Dead code cleanup
**Finding:** `src/server/vapi/vapiWebhook.ts:547-596` (`handleVapiWebhook`) is self-documented `@deprecated ... never mounted, never called`, confirmed zero references anywhere including tests. `src/server/services/outcomeClassifier.ts` implements the exact anti-hallucination-violating pattern the backend-reviewer checklist forbids (keyword-regex → `RESOLVED`, no gating), with zero production importers — a landmine if ever wired in.
**Definition of done:** both removed per the repo's own "no dead code" PRD rule (only after confirming, again, zero references — including in any branch this session didn't see).

### AA-17 — Divergent CARRIER_BLOCK phrase lists
**Finding:** the live-transcript scanner (`carrierBlockPhrases.ts`) and the end-of-call fallback classifier (`processor.ts`'s `BLOCK_SIGNAL_PATTERNS`/`LEGACY_CARRIER_BLOCK_INCLUDES`) maintain separate, non-identical phrase lists.
**Definition of done:** one shared source of truth for carrier-block phrases, imported by both detection paths.

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
