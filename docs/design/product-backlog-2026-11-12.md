# CollectRx backlog: handoff, product vs business gaps, day 1, day 20, churn

**Status:** Draft v1, 2026-11-12. A design record, not a status source (live status stays in `docs/operations/PATH-TO-DELIVERY.md`).
**Companion docs:** `product-journey-and-assumptions.md` (stages and assumption register), `staff-conference-handoff.md` (conference plan).

## How to read

| Tag | Meaning |
|---|---|
| FACT-CODE | Seen in this repo (file given). |
| FACT-DOC | Stated in a vendor doc or a repo doc, not re-verified. |
| SIMULATED | Arithmetic on assumed inputs (register IDs). Not a measurement. |
| UNKNOWN | No evidence either way. |

Priority: **P0** blocks any real call with a real practice. **P1** blocks a paid pilot. **P2** matters at scale. "Hits" says when a customer feels it.

---

## 1. Backlog

### Handoff and telephony

| ID | Item | Pri | Hits | Evidence | Validate with |
|---|---|---|---|---|---|
| B-01 | Replace the blind transfer with a per-call conference. Blind transfer is the default when no transfer plan is sent, and on Twilio Vapi leaves the call, so the scribe hears nothing. | P0 | Day 1 | FACT-CODE `src/vapi/client.ts`, FACT-DOC Vapi docs | Phase 1 spike: `endedReason`, audio gap, rep stays |
| B-02 | Staff availability: practice-set call windows, a "busy" control that stops new dials, rules for holds already running. | P0 | Day 1, churn | FACT-CODE (only fixed 8 to 5 Eastern window and one staff phone exist) | Pickup rate in pilot |
| B-03 | Voicemail and no-answer on the staff leg. On Twilio, voicemail counts as answered, and a busy line ends the call, so the rep is lost. Detect and fall back to the reference-number script. | P0 | Day 1 | FACT-DOC Vapi docs | Spike with phone set to voicemail and busy |
| B-04 | CARRIER_BLOCK is blind during staff conversations. `automationSuspicionFlag` only appends text to the outcome and never triggers a block. Feed listener output into block detection and make the flag open a review. | P0 | Day 20, churn | FACT-CODE `humanAssistedOutcomeResolver.ts`, `webhooks/vapi.ts` | Simulated rep says "no automated callers" |
| B-05 | Counsel review of the silent listener and the notice question; then a consent setting. | P0 | Before any call | UNKNOWN | Written counsel advice |
| B-06 | Handoff events: `handoff_attempted`, staff answered, seconds to answer, rep present at connect, log received. Nothing measures these today. | P0 | Day 20 | FACT-CODE (no such events found) | Dashboard of rates |
| B-07 | Whisper or context for staff at pickup (carrier, claim, amount) so they are not answering cold while the rep waits. Check whether the conference supports speaking to one leg only. | P1 | Day 20, churn | FACT-CODE (context goes by dashboard note only) | Spike |
| B-08 | Late log reconciliation: a log that arrives after `processCallEnded` ran is not applied to the claim. | P1 | Day 20 | FACT-CODE `vapiWebhook.ts` | Test with delayed log |
| B-09 | Staff post-call outcome form as a backup when the listener fails. | P1 | Day 20 | Design | Staff completion rate |
| B-10 | Real cost per call: metered minutes come from the Vapi duration, which ends at transfer, so staff-conversation minutes are not metered. Measure true Twilio cost for both designs. | P1 | Day 20 (margin) | FACT-CODE `usagePeriodService.ts`; Twilio billing after transfer UNKNOWN | Compare Twilio invoice to meter |
| B-11 | Multi-staff routing: one `escalationPhoneNumber` today. Ring group and fallback order. | P2 | Day 20 | FACT-CODE | Practice with 2+ front-desk staff |
| B-12 | Scribe config drift: the scenario list lives in the Vapi dashboard and the code mirrors it by hand; model retirement 2026-11-30 and a 600 s max duration were noted earlier. | P1 | Day 20 | FACT-CODE comment in resolver | Sync check in CI |

### Onboarding and trial

| ID | Item | Pri | Hits | Evidence | Validate with |
|---|---|---|---|---|---|
| B-13 | Readiness checklist and "why no calls" status. Before any dial a practice needs: voice agent on, each carrier enabled, an authorization letter on file, a provider number, a staff phone, and patient name, DOB and member ID in the data. The only setup UI found is Practice Settings, with no guided flow. | P0 | Day 1 | FACT-CODE `adapter.ts` gate, `patientDataCompleteness.ts` | New-practice walkthrough |
| B-14 | Start the trial clock when the practice is dial-ready, not at signup. Carrier authorization time is UNKNOWN and the 30-day clock runs meanwhile. | P1 | Day 1, Day 20 | FACT-DOC billing lifecycle | Time from signup to first dial |
| B-15 | Rethink trial limits: 500 min/month and 50 min/day is about 20 attempts at 25 billed minutes each, and 2 per day. | P1 | Day 20 | FACT-DOC limits, SIMULATED volume | Pilot call counts |
| B-16 | Value report by day 7: hold minutes saved, handoffs, outcomes logged, claims touched. Payments lag, so show leading indicators. | P1 | Day 20, churn | Design | Owner interview |
| B-17 | Coverage report before signup: share of the practice's own AR on the six supported carriers (unsupported carriers fail import). | P1 | Day 1 | FACT-DOC pressure test | Run on the pilot export |
| B-18 | Review the 90 day ceiling and 30 day floor for human-assisted mode. `validateDispatch` has no mode input, so rules written for the AI also exclude the oldest claims where staff most want help. | P1 | Day 1 | FACT-CODE | Age mix of the pilot export |

### Compliance, privacy, trust

| ID | Item | Pri | Hits | Evidence | Validate with |
|---|---|---|---|---|---|
| B-19 | Persisted transcript redaction misses common formats: dashed or spaced phone numbers and spoken dates had 0% recall in the benchmark. Extend or audit `redactTranscript` the way `redactNarrativePhi` extends the narrative scrub. | P1 | Compliance | SIMULATED formats, FACT-CODE | Sample audit of stored transcripts |
| B-20 | Carrier terms review for all six carriers; per-carrier opt-in. | P0 | Before any call | FACT-DOC (all UNKNOWN) | Written terms read |
| B-21 | Vendor DPAs/BAAs, pen test or written exception, tested backup restore, on-call position, Sentry. | P1 | Before paid pilot | FACT-DOC `PATH-TO-DELIVERY.md` | Checklist closed |
| B-22 | PHIPA deletion and exit process (today a manual runbook). | P2 | Churn | FACT-DOC | Counsel sign-off |

### Business and pricing

| ID | Item | Pri | Hits | Evidence | Validate with |
|---|---|---|---|---|---|
| B-23 | Usage warnings at 50, 80 and 100 percent of minutes, and a clear rule for hold minutes lost to our own failures (credit them back). | P1 | Churn | FACT-DOC (overage needs owner confirm) | Owner interview |
| B-24 | Proactive "calls paused" notices with the reason (carrier block, billing, window, missing setup). | P1 | Churn | FACT-CODE (pauses exist, notices not confirmed) | Trigger each pause |
| B-25 | Decide per-carrier minimum waits (21 TELUS, 32 others, not enforced today). | P2 | Day 20 | FACT-DOC `HUMAN-DECISIONS-PENDING.md` item 1 | Founder decision |
| B-26 | Time zone aware windows (fixed Eastern today). | P2 | Scale | FACT-CODE | Practice in another zone |
| B-27 | Pilot guardrail vs self-serve: `PILOT_SCOPE.md` says one practice until a Day-90 decision, but signup, a marketing engine and tiers up to Scale exist. Gate signup or amend the doc. | P1 | Strategy | FACT-DOC vs FACT-CODE | Founder decision |
| B-28 | Support and incident capacity for a single operator: response promise, outage and carrier-block comms. | P1 | Churn | Design | Tabletop drill |
| B-29 | Playbook threshold: how many logged calls per carrier before a playbook is trusted, and the criteria to graduate a carrier to autonomous (ADR 0003 open item). | P2 | Strategy | FACT-DOC | Defined numbers |
| B-30 | Verify end to end the pressure-test items that appear fixed: false recovery from line items (H3), claims that vanish from an export (H4), recovery without payment evidence (H2), and the marketing savings claim (H8, text not found in the template file). | P1 | Day 20 | FACT-CODE partial | End-to-end run |

---

## 2. Where product and business do not align

1. **The pitch is hold time saved, but the meter charges for hold.** The practice pays for every minute we wait, including waits that end in a missed pickup. The more the carrier is slow or staff are away, the more they pay.
2. **The strategic moat is the learning loop, and the product as built breaks it.** The data advantage depends on logging every staff call; a blind transfer logs none.
3. **Rules written for the autonomous AI constrain the human-assisted product.** The 90 day ceiling (skip AI, escalate) and the call-window rules apply regardless of mode.
4. **Self-serve growth vs a one-practice pilot.** The pilot doc forbids multi-practice work; the code has signup, marketing and four paid tiers.
5. **The trial is shorter than the proof.** 30 days, about 20 attempts, and payments that lag.
6. **Priced per minute, valued per outcome.** Tiers sell minutes; the practice judges recovered dollars.
7. **Six carriers vs the practice's real mix.** Unsupported carriers fail import; coverage is unknown until signup.
8. **No schedule, one staff phone.** Real front desks are busy, rotate staff, and have more than one person.
9. **"No SMS" vs a live handoff.** The only real-time alert is a ringing phone with no context.
10. **Eastern-only windows vs a Canada-wide pitch.**

---

## 3. Day 1: what is likely to fail

- Signup works, then **nothing dials**: voice agent, carrier, authorization letter, provider number and staff phone must all be set, and the practice may not know why calls are not happening (B-13).
- The first CSV has **missing DOB or member ID** and rows are blocked, or carriers outside the six fail the import (B-17).
- The import is mostly **under 30 days or over 90 days old**, so the queue is empty or the oldest claims are skipped (B-18).
- The **first handoff rings during patient care**, or goes to voicemail (B-02, B-03).
- Vapi's server URL and Twilio keys are not set on staging, so the supervised path has not run (FACT-DOC, `PATH-TO-DELIVERY.md` section D).

## 4. Day 20: what is likely to fail

SIMULATED, using register assumptions A4, A13, A16, A17 (staff answer 85%, rep stays 90%) and about 25 billed minutes per attempt:

| | Value |
|---|---|
| Attempts in a 500 minute trial | about 20 |
| Successful handoffs (76.5%) | about 15 |
| Hold time saved (about 23 min each) | about 6 hours |
| Staff cost of that time at $30/h | about $175 |
| Subscription price | $399 |
| Verified recovered dollars | about zero (payments lag) |

- On these numbers the owner sees **less value than the price at the moment of decision**, and the data to argue otherwise does not exist yet.
- Staff have been **interrupted at random times** and some pickups were cold.
- The first **CARRIER_BLOCK or billing pause** may have stopped calling with no explanation.
- A **stale CSV** means calls about claims already paid (mitigated only when the practice marks the file as its full open AR).

## 5. What makes a customer lose faith and cancel (ranked)

1. **Staff answer and nobody is there**, or the rep is gone, after the practice paid for the hold.
2. **The phone rings constantly at random times** with no context.
3. **No proof of value** in the first 30 days: no recovered dollars and no report.
4. **A surprise bill:** overage, or minutes lost to failures.
5. **A carrier flags the practice** or a rep complains.
6. **Calls stop with no explanation** (pause, block, missing setup).
7. **Wrong data:** a call about a claim already paid, or a patient mismatch.
8. **Privacy doubts** from the owner or the privacy officer.
9. **Slow or no support** when something breaks.
10. **The office manager's workload goes up** (CSV exports, cleanup).

## 6. What I could not verify

- Real handoff behaviour, voicemail behaviour and Twilio billing after a transfer need a live test.
- All "simulated" figures come from the register's assumptions.
- The marketing savings claim from the pressure test (H8) was not found in the template file I checked. I did not search the rest of the marketing code.
- I did not run the database-backed test suites (no Postgres or Linux Prisma engine in this environment).
