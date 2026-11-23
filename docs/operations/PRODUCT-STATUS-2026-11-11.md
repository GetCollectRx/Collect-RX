# Product status and path forward, 2026-11-11

Written for Khalid. Every claim says where it comes from. A status of "working" means a test I ran in a contained environment passed. It does not mean a client would have a good experience.

## 1. Bottom line

1. **The product is not ready for clients, and nothing should be promised yet.** The decision to hold back is supported by the evidence.
2. **The core promise has never been demonstrated end to end.** That promise is: an AI agent works through a carrier phone menu, waits on hold, and hands a live representative to practice staff. Two live calls through the real squad to our own simulated carrier both stopped at the provider ID prompt, and neither reached hold. Both failures traced to my test fixtures, not to the product, but that means the next step in the call path is still unproven.
3. **The software around the call is in better shape than "no reliable UI" suggests, with serious holes.** For the owner, office manager and billing coordinator roles, 41 of 42 pages load cleanly and 95 button clicks caused no crash. The holes are real: two other personas (accountant, group admin) hit crash screens, the site fonts never apply, a solo owner cannot finish setup, and one carrier-safety rule is not enforced across practices.
4. **There is no reliable way to test the whole product by hand today, and now there is a partial one.** `bash self-test/run.sh` and `bash self-test/run.sh crawl` are contained, repeatable, and work on your Mac. They cover a small slice of what the product does, and section 3 lists what they do not touch.

## 2. What this status is based on

| Source | What it covers | What it does not cover |
|---|---|---|
| Unit and integration tests, 2275 passing, all CI checks green | Code agrees with its own tests | Whether the product works as a whole. Stage 1 below fails while CI is green. |
| Application self-test (11 journeys, 75 checks) | Signup, invited manager, CSV import, setup, a dial, the webhook coming back, a refusal, tenancy probes, hostile input | Everything not listed |
| Application crawl (235 page visits across 7 roles, 136 refusals, 95 button clicks, 135 API paths probed without a login) | Whether each page loads, errors, or crashes, per role | Whether numbers and results on the pages are correct. Buttons were clicked, but their results were not judged. |
| Office-day simulation (offline, real pipeline) | An office's day: import, queue, dispatch rules, metering | Real phones |
| Stage 1 simulation (offline) | Call lifecycle, learning loop, proof dashboard | Real phones |
| Carrier Twin, 2 live calls ($0.17 of Vapi spend) | IVR navigation through three menus | Hold, rep detection, transfer |
| The repo's launch tracker | Operations and compliance items | I did not execute any of them |

All browser and server runs were contained: the app had an egress guard, the browser could not reach outside hosts, and Vapi was a local fake. Everything is synthetic data.

## 3. Status by area

Key: **Working** verified by a test I ran. **Partly** works with defects. **Broken** fails in a test. **Unproven** exercised only offline or not at all against reality. **Untested** I did not examine it.

| Area | Status | Evidence |
|---|---|---|
| IVR navigation by the agent (DTMF) | Working | Two live twin calls: correct digit at all three menus. |
| Provider ID entry | Unproven | Both calls stopped here (empty `practice_npi`, then a non-digit fixture). Unclear whether a real carrier wants the practice NPI or the per-carrier provider number: the dispatch gate requires the second, the live prompt types the first. |
| Hold detection, rep detection, staff transfer | Unproven | Never reached live. The transfer success path cannot be tested in containment: the app only sends control commands to an https vapi.ai URL. |
| The live IVR_Navigator prompt edit I made | Unproven | Never run on a call. Backup saved. |
| Claims_Scribe `firstMessage: "Hello."` | Unproven | Unknown whether it is spoken to the rep. If it is, that is an undisclosed AI utterance. |
| Voicemail, closed line, mid-menu hang-up, menu changes, hold music, callback offers | Unproven | Modeled and scored offline in the twin. None run live. |
| Dispatch rules (call window, holidays, staff hours, NPI, age, attempts, double dial, squad choice) | Working | Unit tests plus the self-test. The manual "Call now" route was dialing the wrong squad for human-assisted practices; fixed and now tested. |
| Real staff availability | Broken | Stage 1: "No dial with zero ready staff" fails. My staff-hours check is a clock rule, not presence. |
| Webhook and outcome processing | Working | Paid outcome closes the claim, a replayed report is harmless, a forged webhook is refused. |
| Hold time and live call state recording | Broken | Stage 1: live state sequence and hold seconds are not recorded. |
| Live carrier-refusal detection | Broken | Stage 1: a refusal phrase heard live does not trigger CARRIER_BLOCK. It works only from the end-of-call report. |
| CARRIER_BLOCK across practices | Broken | One office's block does not stop another office calling that carrier (self-test and office-day). Your own rule says it must. |
| Tenancy and access control (API) | Working | 7 cross-office probes refused, claim list isolated, 129 of 135 API paths refuse a visitor with no login. |
| Public API exposure | Partly | `/api/diagnostics` and `/api/health/metrics` answer with no login. Diagnostics shows queue depth, open calls, tick failures, circuit-breaker state. No patient data, but it should not be public. |
| PHI boundary on the dial | Working | No patient name, DOB or member id outside the ephemeral call variables. Recording deletion after the call works. |
| Learning loop PHI filter | Partly | Stage 1: a lesson containing a patient name reaches PROPOSED. Only human review stops it. |
| Signup and onboarding | Partly | A new owner cannot set NPI, carrier authorization or the voice agent (by design the role is read-only), nothing on the first screen says to invite an office manager, and invites used to claim "sent" when nothing was sent (fixed). |
| CSV import, server | Working | Bad claims are held back with reasons, the rest imports. |
| CSV import, wizard | Partly | Refuses a column header the API accepts, and counts blank rows as claims. |
| Page rendering, owner, office manager, billing coordinator | Working | 41 of 42 pages clean each. The one exception: the claim detail page's evidence call returns 403 (probably plan-gated). |
| Page rendering, front desk | Partly | 16 of 24 clean, 8 pages make a call that returns 403 (`/api/billing/plan`). |
| Page rendering, accountant | Broken | 6 pages show "Something went wrong: role does not have access to patient PHI endpoints", including the pages its own sidebar links to. |
| Page rendering, group admin | Broken | 4 crash screens (Analytics, Validation, Canadian 2026, claim detail), 20 pages with a failing call. |
| Site fonts | Broken | The font stylesheet relies on an inline handler the app's own security policy forbids. Fonts never apply on any page. Also loads from Google, which sends visitors' IP addresses to a third party. |
| Button behavior | Working (sampled) | 95 clicks on 21 pages: 85 did something visible, 0 crashed, 10 had no visible effect (looks like already-selected filters and disabled controls; not each verified). |
| Metering | Broken | Zero-second no-answer calls are billed a minute (office-day). |
| Proof dashboard | Broken | Stage 1: staff minutes saved and hold minutes avoided do not match the run log. |
| Blocked claims and disabled voice agent showing a reason in the queue | Broken | Office-day: no staff-visible reason. |
| Stripe billing, SendGrid, Twilio SMS, other integrations | Untested | Switched off in containment. |
| Escalations, takeover, live console, call history | Untested | The pages load. What they do was not tested. |
| Group admin features, pre-visit, pre-treatment estimate, Canadian 2026, analytics numbers | Untested | The pages load for roles that can reach them. Correctness of results was not tested. |
| PMS sync, AbelDent connector, Electron desktop app | Untested | Not examined. |
| Marketing and outreach engine | Untested | Not examined. It places AI sales calls, so decide whether it ships at all. |
| Eligibility engine | Untested | Not examined beyond existing unit tests. |
| Operations (error tracking, uptime, backups and restore, rollback, on-call) | Unproven | Unchecked in the repo's tracker. |
| Compliance and legal (BAAs, Terms and Privacy review, breach contact, pen test, encryption at rest, PHIPA deletion workflow) | Unproven | Unchecked in the tracker. The PHIPA workflow has a schema and a manual runbook only. |

## 4. Numbers at a glance

| Check | Result |
|---|---|
| Unit and integration tests | 2275 passed, 9 skipped, 3 todo |
| CI checks on the PR | All green |
| Application self-test | PASS 67, FAIL 0, FINDING 7, UNVERIFIED 1 |
| Application crawl, allowed roles | 235 visits: WORKS 191, PARTLY 34, BROKEN 10 |
| Application crawl, refused roles | 136 visits: DENIED 136, LEAKS 0 |
| Button sweep | 95 clicks: 85 visible effect, 10 none, 0 errors |
| Office-day simulation | PASS 59, FAIL 0, UNVERIFIED 2, FINDING 5 (was 13 findings) |
| Stage 1 simulation | PASS 74, FAIL 15, UNVERIFIED 5, FINDING 16 (was FAIL 16) |
| Live twin calls | 2 calls, $0.17 Vapi cost, neither reached hold |

## 5. What I cannot tell you

* How any real carrier's phone system behaves. The IVR maps are paraphrases last verified 2025 to 2026, with no recordings.
* Whether the numbers on dashboards, reports and the proof page are correct. I checked that pages load, not what they say.
* Anything about billing in practice: Stripe was off.
* Browsers other than Chromium, phones and tablets, accessibility beyond "renders", or behavior under load.
* Why some problems from the earlier handoff (takeover ignoring the selected call, trial cap overshoot, resubmit routing) no longer fail in the latest Stage 1 run. They were present then and are not failing now. I did not investigate whether they were fixed or the checks changed.

## 6. Path forward

Principles: prove the core promise before adding breadth, finish each phase with a test that can be re-run, and promise nothing until the gate at the end of this section is met. Sizes are relative (S small, M medium, L large), not dates.

### Phase 0: stop the obvious defects (mostly S)

| Item | Size |
|---|---|
| Fix the font loading and security policy mismatch, and self-host the fonts (also removes the Google request) | S |
| Put `/api/diagnostics` and `/api/health/metrics` behind a token | S |
| Accountant and group admin: either fix the pages or hide the links they cannot use. Pick hiding for any first pilot. | S to M |
| Stop the UI calling `/api/billing/plan` for roles that are refused | S |
| Show a clear "invite an office manager" step to a new owner, or let the owner edit setup (your decision, see section 7) | S |
| Import wizard: accept the same headers as the API, ignore blank rows | S |
| Enforce CARRIER_BLOCK across practices, as your own rule says | M |
| Show a reason on every blocked or paused queue row | S |
| Do not bill zero-second no-answer calls | S |

### Phase 1: prove the call path on the twin (M)

1. Run `rbc.baseline` again to reach hold and a rep. Cost is about $0.10 a call.
2. Run the 11 RBC scenarios, including `directHumanPickup`, `voicemailPickup`, `talkingHold`, `menuReorder` and `holdMusic`. Expect a few dollars in total.
3. Fix what falls out. Likely: the handoff path from direct pickup, what Claims_Scribe says, and the provider ID versus NPI question.
4. Build the pieces Stage 1 says are missing: real staff availability, recording hold time and live state, detecting a refusal while the call is live.
5. Exit: every scenario scores PASS, and the twin report is attached to the PR.

### Phase 2: widen the application test net (L)

1. Add self-test journeys for billing in a Stripe test mode behind a local fake, escalations, takeover, the live console, group admin, pre-visit and PMS sync.
2. Add golden-data checks: known claims in, exact dashboard and report numbers out.
3. Put the self-test and the crawl into CI. This edits the workflow, which needs your approval.
4. Exit: every area marked Untested in section 3 has at least one journey, and each one passes or has a written reason.

### Phase 3: controlled contact with reality (M, needs your decisions)

1. Recorded probe calls to the real carrier menus, only if you approve the terms-of-service and CARRIER_BLOCK risk.
2. A first supervised real call: one carrier, a handful of claims, a staff member watching, written stop conditions.
3. Exit: the real IVR maps are replaced with recordings, and the first supervised calls are logged and reviewed.

### Phase 4: operations and compliance (L, mostly yours and legal's)

Close the unchecked items in the repo's tracker: error tracking, uptime, backups and a tested restore, a practiced rollback, on-call, BAAs, Terms and Privacy review, breach contact, pen test, encryption at rest, and the PHIPA workflow.

### Gate for the first client

Do not promise anything until all of these are true:

1. Phase 0 is done and Phase 1 passes on the twin.
2. At least one supervised real call per supported carrier has been reviewed.
3. The self-test and crawl pass in CI with no FAIL.
4. Every Untested area in section 3 is either tested or turned off for the pilot.
5. The operations and compliance items in Phase 4 are closed or have a written exception that you signed.

## 7. Decisions needed from you

1. **Owner role.** Let the person who signs up edit setup, or keep it read-only and make the invite step impossible to miss. The first is simpler for a solo dentist.
2. **Accountant and group admin for the first pilot.** I recommend hiding both until fixed.
3. **Live twin budget.** Roughly $5 covers Phase 1.
4. **Real carrier probes.** Yes or no, knowing the terms-of-service and CARRIER_BLOCK risk.
5. **Public diagnostics.** I recommend locking them down now.
6. **CI.** Approve adding the self-test and crawl to the workflow.
7. **First pilot scope.** Which features ship (the V1 Hold Sentinel only, or more) and which are switched off. The marketing outreach engine, eligibility engine, group features and pre-visit are all candidates to switch off.

## Corrections (2026-11-12)

Three findings above were wrong or overstated. Found by reading the recorded screenshots and the code.

| Earlier claim | What is true | State now |
|---|---|---|
| `/api/diagnostics` is public | It already returned 401 when `NODE_ENV=production`. The self-test server runs with `NODE_ENV` unset, which counted as non-production. No Dockerfile or `fly.toml` in the repo sets `NODE_ENV`, so a deployed app's protection is UNVERIFIED. | Fixed: open only when `NODE_ENV` is explicitly `test` or `development`; unset is treated as production. Also applied to the `/api/health/metrics` redaction. |
| Accountant and group admin pages "crash" | They are access denials shown under "Something went wrong": "No auditor grant for this practice" (accountant) and "Role group_admin does not have access to patient PHI endpoints" (group admin). The group-admin pages are not in that role's sidebar, only reachable by URL. The accountant's own sidebar does link to the report pages, which deny without a grant. | Fixed the message: a denial now says "You do not have access to this page", what to do, and links home. The accountant flow gap remains: nothing tells an owner that an invited accountant needs a grant. |
| Fonts never apply because of a CSP conflict | Confirmed, and the cause is exact: helmet adds `script-src-attr 'none'`, which blocks the inline `onload` on the Google Fonts link, so the stylesheet stays `media="print"`. | Fixed: plain stylesheet link, plus a test that fails on any inline handler in `index.html`. |
| CARRIER_BLOCK across practices is broken | The code deliberately scopes a block to the practice and its sibling locations in the same organization (comments in `adapter.ts` say so). Blocking every customer when one practice is refused is a product decision, not a clear bug. | Not changed. Decision for Khalid. |
| NPI-before-dial rule (PRD epic status doc) | Was keyed to every line. | Fixed: required for dental and paramedical lines only (`src/carriers/lineRequirements.ts`); other lines demand no identifier until their payer packs exist. |
