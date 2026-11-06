# Simulation harness, Stage 1 report (2026-11-06)

Point-in-time record. Branch `feature/sim-harness`, base `7da0877`. Raw run log: [`SIM-HARNESS-STAGE1-RUN-LOG-2026-11-06.md`](SIM-HARNESS-STAGE1-RUN-LOG-2026-11-06.md). Harness: [`Collect-RX-main/tests/sim-harness/`](../../Collect-RX-main/tests/sim-harness/README.md).

## Limits of this report (read first)

- **Corrected 2026-11-06 after review.** The first version quoted 54 vs 79 minutes for finding 6 (from an earlier 3-call development run) and claimed finding 8 was reproduced in the committed run. Both now match the committed run log.

- **Offline only.** No audio, no Vapi, no carrier. The fake carrier is the sequence of Vapi server messages a real call would produce. Pickup timing, hold detection, false pickups and whether the scribe keeps hearing after transfer (gaps 2 and 11) are **not measured**.
- **PRD not supplied.** Section 5 thresholds, Stage A and Option B are **UNVERIFIED** (decision D9).
- **Native message shapes come from the code, not from Vapi.** The harness sends payloads shaped the way `src/webhooks/vapiNormalizer.ts` documents them. That a live Vapi `transcript` message uses the type string `transcript` is from the Vapi server-message model as I understand it, **not checked against Vapi's current docs** in this session.
- **Five scripted personas, not 248 scenarios.** Section 3's training and evaluation sets need an LLM rep (Stage 2+). Stage 1 covers C1, C2, C3, Partial-Payer and Robot-Refuser.
- **Factory ages are 32 to 88 days**, so the under-30 and over-90 gates are not exercised.

## Verdict

**FAIL.** 110 checks: PASS 71, FAIL 18, UNVERIFIED 5, FINDING 16. Scenarios: 3 PASS, 2 FAIL. Spend $0. 18 outbound requests intercepted, 0 escaped, teardown residue 0 rows.

## Findings, ranked

| # | Severity | Finding | Evidence |
|---|---|---|---|
| 1 | **P0, PHI** | On a terminal outcome (RESOLVED, DENIED) the **patient name is stored in plaintext** in `call_attempts.transcript_text`. Call-end processing revokes the PHI token before the transcript is persisted, so known-value redaction cannot run and pattern redaction does not catch names. | Order: `src/webhooks/vapi.ts:540` (call-end, revokes at `src/server/vapi/vapiWebhook.ts:488`) runs before `src/webhooks/vapi.ts:594` (persist). Run log checks 33, 61: leaked=1. S014 (ESCALATED) and NOT_ON_FILE (IN_QUEUE) kept a live token and did not leak (checks 47, 76). ROBOT_REFUSER's token was revoked but its script never speaks a patient name, so it cannot show the leak either way. |
| 2 | **P0, PHI** | The same leaked transcript is **sent to Anthropic** by lesson extraction. | Run log check 100: outbound LLM request leaked values=1. Today this only fires for autonomous calls (gap 1), so lifting that gate before fixing #1 would widen the leak. |
| 3 | **P0, CARRIER_BLOCK** | A rep who refuses an automated caller **never triggers CARRIER_BLOCK** on a Hold Sentinel call. (a) Live `transcript` messages are dropped by the normalizer, so the phrase detector never runs. (b) The human-assisted resolver hard-codes `carrierBlockDetected: false`. | `src/webhooks/vapiNormalizer.ts:143`; `src/outcome/humanAssistedOutcomeResolver.ts:119`. Run log check 84; scenario ROBOT_REFUSER: block=false. |
| 4 | P1 | "Claim not on file, resubmit" goes **back into the call queue** (route CALL_CARRIER, recall in 3 days) instead of escalating to the practice, despite the resolver mapping it to ESCALATED. The practice is never told to resubmit. | `src/outcome/humanAssistedOutcomeResolver.ts:43` vs engine log `sim-call-004 route CALL_CARRIER claimStatus IN_QUEUE`. Run log check 80 and scenario row NOT_ON_FILE_RESUBMIT. |
| 5 | P1 | **Hold time is never recorded.** `CallAttempt` has no hold column; live state never leaves `dialing`, because status updates carry no agent and the normalizer drops `analysis.collectrx`, so the transition processor never runs. | `src/webhooks/vapiNormalizer.ts:107`; `src/webhooks/holdTransitionProcessor.ts`. Every scenario: liveState=dialing. Run log checks 30, 31, 44, 45, 58, 59, 73, 74, 89, 90. |
| 6 | P1 | **The proof dashboard cannot prove the wedge.** "Time saved" is completed calls × a fixed 18 minutes; there is no hold-minutes-avoided metric. Run log hold was 104 minutes against 90 shown (5 calls × 18). | `src/services/insurance-analytics.ts:90`. Run log checks 106, 107. |
| 7 | P1 | **No staff-availability gate** before dialling. A Hold Sentinel call goes out with nobody ready to take the transfer. | `src/server/frontDesk/queueEngine.ts` (no availability check between `:483` and `:684`). Run log check 23. |
| 8 | P1 | **Live Console takeover ignores which call staff selected** when two are open. The route reads only `phoneNumber` and `staffId` from the body (`:341`) and transfers whatever `findFirst` with no `orderBy` returns, so the target depends on database row order. Pause and end-call share the pattern. | `src/server/routes/frontDeskApi.ts:341`, `:345`, `:277`, `:318`. Static evidence is conclusive. Empirical: two development runs transferred A when B was selected; **the committed run (check 97) happened to transfer B and recorded PASS**. That single-trial check cannot detect the flaw and needs redesigning (select A, then B; FAIL if both go to the same call). |
| 9 | P2 | Lesson identifier filter **misses names**; only 6+ digit runs and ISO dates are dropped. Human review is the only barrier. | `src/server/learning/carrierLessons.ts:66`. Run log check 103 (date filter works, check 102). |
| 10 | P2, commercial | **Trial daily cap overshoots.** The cap is checked before each dial, not projected: 3 realistic holds billed 82 minutes against a 50-minute daily cap. A trial practice gets about two carrier calls a day. | Run log check 66: DAILY_CAP_REACHED after 82 billed minutes (calls of 22, 26 and 34 minutes, checks 36, 50, 64). |
| 11 | P2 | **Five age numbers.** Dispatch is gated by the flat 30/90 in `validateDispatch` (`src/carriers/adapter.ts:455`). Also present: 45-day priority floor, 21/32 in carrier configs, 21/32 `minimumClaimAgeDays` in practice settings (`practiceSettingsService.ts:12`, never read), and Dr Hasan's 7. | Run log check 4; flat floor at `adapter.ts:455` is static. Under-30 and over-90 not exercised (factory ages 32 to 88). |
| 12 | P2 | AR engine state machine and reconciler (components 7, 15) are **not wired** into the live path. | Imported by nothing outside `src/services/arEngine/`. Run log check 22. |
| 13 | Info | Dial payloads always name the **real carrier line**, because the allowlist is hardcoded. In Stage 1 the interceptor is the only barrier. Stage 2 cannot point at a mock without the D1 seam. | `src/vapi/client.ts:202`, `:387`. Run log check 19. |
| 14 | Info | Two vaults: import tokens live in `src/pii-vault.ts`; `src/services/pii-vault.ts` does not know them and holds only audio deletion and LLM residency headers. | Run log check 11. |

## What passed

Import and tokenization (zero plaintext PHI in the database after import), carrier mapping, triage closing a PMS-paid claim without a call, Hold Sentinel squad selection, PHI kept out of Vapi metadata, idempotency key, pickup handoff transferring the correct call with a staff alert, scribe outcome logging, recording deletion requests, minutes billed and usage metering, partial payment kept off RESOLVED, CARRIER_BLOCK honoured at dispatch once set, approved-only lesson injection, zero lessons accepted on a routine call, clean teardown.

## Scenarios

| Scenario | Persona | Expected | Observed | Status |
|---|---|---|---|---|
| C1_PAID_IN_FULL | C1 By-the-Book | claim RESOLVED | RESOLVED (transcript leaked name, finding 1) | PASS |
| S014_PARTIAL_PAYER | Partial-Payer | not auto-resolved | ESCALATED; attempt outcome labelled RESOLVED (no partial value in `CallOutcome`) | PASS |
| DENIED_WITH_CODE | C2 Overloaded | claim DENIED | DENIED (transcript leaked name, finding 1) | PASS |
| NOT_ON_FILE_RESUBMIT | C3 Veteran Helpful | escalate to practice | IN_QUEUE, recall in 3 days (finding 4) | FAIL |
| ROBOT_REFUSER | Robot-Refuser | CARRIER_BLOCK | no block (finding 3) | FAIL |

## Section 6 gaps

| Gap | Result |
|---|---|
| 1 Lesson extraction gated to autonomous calls | Confirmed (`src/webhooks/vapi.ts:623`). Direct extraction on a staff-handled call works and lands PROPOSED, but see findings 2 and 9 before lifting the gate. |
| 2 Scribe after transfer | UNVERIFIED, needs Stage 2. |
| 3 Takeover selection | Confirmed by code (finding 8). The committed run's single-trial check passed by row order; see finding 8. |
| 4 Transfer method | `POST /call/{id}/transfer` (`src/vapi/client.ts:597`). PRD comparison UNVERIFIED. |
| 5 Claims_Agent opening line | Repo config `vapi-squad-config.json:235` opens "You are an automated insurance collections agent". Live dashboard UNVERIFIED. Not exercised: Stage 1 is Hold Sentinel only. |
| 6 Claim email | None found in the paths read; not exhaustively searched. |
| 7 Age gates | Finding 11. |
| 8 Pause and end-call | Same flaw as takeover (static evidence only). |
| 9 Two vaults | Finding 14. |
| 10 Simulator phones | Factory `simulatorPhone` values are never used by dispatch; the allowlist overrides them (finding 13). |
| 11 Pickup thresholds | Not measurable offline. |
| 12 "Train" | Evaluate-only per D6; no prompt changes made. |

## Decisions

| ID | Status |
|---|---|
| D1 to D4, D6, D8, D9 | Approved 2026-11-06 and followed. |
| D3 Option B, D5 persona model, D7 PRD | Open. PRD pending from Khalid. |
| Stage 2 spend cap, keys | `[UNDECIDED, Khalid's call]` |
| Fix findings 1 to 8 | `[UNDECIDED, Khalid's call]`. No production code was changed on this branch. |
