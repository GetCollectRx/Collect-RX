# Decision log: PRD v2 build (2026-11-22)

Owner: Khalid Egeh (delegated all decisions below to the build agent on 2026-11-22). Each entry records the decision, the reason and the status. Decisions that need a fact, a legal conclusion, a vendor contact, spending or a push are marked as such. Those are not decided here.

Reserved and not delegated (not decided in this log): legal and PHIPA conclusions (questions for counsel are marked UNVERIFIED), any contact with a carrier, practice, vendor or person outside the build (including real-carrier calls and outreach), spending money, and any git push. No push happens until Khalid confirms the GitHub token has been rotated.

## Decisions

| # | Topic | Decision | Reason | Status |
|---|---|---|---|---|
| D1 | Location of the three unpushed branches | Create a `git bundle` of each branch in a folder Khalid can read. Keep the parked date-parsing branch unmerged until Stage 1 on clean main is re-run. | A bundle keeps the no-push rule. No branch is lost. Pushing waits for the token rotation. | Bundle not yet created. Needs the folder path from Khalid, or the default `/home/user/Collect-RX-bundles`. |
| D2 | Which materials left the building (deck, video, one-pager, landing page, PilotDemo, FAQ), and the status of the Oct 30 commitment | Not decided. This is a fact, not a choice. Until Khalid lists what was sent, treat every asset as possibly sent. Correct the copies this repository controls first (R-002, R-003, R-004). | I cannot know what left his hands. Correcting controlled copies first limits further exposure. | Fact needed from Khalid. R-001 stays blocked. |
| D3 | Positioning | Hold Sentinel with staff handoff. Autonomous AI conversation stays a graduation criterion (ADR 0003). | Matches the code (ADR 0003, ADR 0004). Avoids claiming unproven behaviour. | Decided. |
| D4 | Dial numbers fail closed until verified | Yes. Unverified numbers are refused at dispatch. | A wrong number means a call to a stranger. | Decided. Implementation is R-017, not yet built. |
| D5 | Claim age floor | Keep the flat 30 day floor, the value the code enforces today (`validateDispatch`). Do not start enforcing the per carrier numbers (21 TELUS, 32 others) until public evidence is reviewed. | R-020 requires one rule stated the same everywhere. Code enforces 30 days. The per carrier numbers are not yet backed by evidence in the repo. | Decided for now. Evidence review is open. |
| D6 | Call hours | Start dispatch at 09:00 recipient local time. Practices may narrow the window, never widen it. | Product default from the PRD. Lower risk of a call to a carrier at an early hour. This is a product choice, not a legal conclusion. | Decided. Legal question below. |
| D7 | Corroboration gate | Yes. A reference number alone never marks a claim paid. | Prevents a wrong paid status from closing a claim. | Decided. R-021 not yet built. |
| D8 | Pre-visit and eligibility modules | Feature flag off for the first release. | They sit outside the handoff scope and are not proven. | Decided. Flag implementation is a follow-up. |
| D9 | Statement upload as the second channel rung | Yes. | Needs no integration and raises no terms-of-use question. | Decided. |
| D10 | Portal automation with practice credentials | Build nothing now. | Each carrier's terms need review. The review is a legal conclusion and is reserved. | Decided to build nothing. Counsel question below. |
| D11 | Owned-number run (keys and a number) | Defer. Do not provision keys or a number and do not run it now. | It costs money and is reserved from me. It also needs R-010 and R-017 done first. | Deferred to Khalid. Recommendation: run after R-010, R-011 and R-017 are done. |
| D12 | Reviewer for each done table | A fresh session at each gate now. External developer review before Gate 1. | The external review costs money, so I cannot commission it. | Fresh-session review decided. External review open. |
| D13 to D15 | Not defined in PRD v2 | No decision recorded. The PRD defines decisions D1 to D12 only. | Recording a decision for an item not in the document would invent its content. | Khalid to confirm what D13 to D15 refer to. |

## Other delegated items

| Item | Decision | Reason | Status |
|---|---|---|---|
| Zero-staff check: option A or B | Decision B stands (accept dispatch without a staff gate). Recorded in ADR 0003. | Khalid chose B. No new evidence in this session outweighs it. Transfer-miss data is collected through the handoff outcome audit row. | Decided. |
| R-010 (no dial without staff capacity) | Waived for the first release under decision B. Compensating controls: the handoff outcome audit row, the `staff_unavailable` script after pickup, and a review before Gate 1. R-010 stays listed as waived, not passed. | R-010 conflicts with B. Khalid accepted B. A waiver is more honest than a pass on the Stage 1 row. | Decided. The Stage 1 row stays FINDING, not PASS. |
| Vapi serverMessages | Decided: the live path needs transcript, status-update and speech-update messages with the agent identity in the analysis payload. No change is applied in this session. | I have no vendor dashboard access here. A change to a live squad's configuration affects calls. | Config spec decided. Applying it is an owner action on the vendor dashboard. |
| Squad re-sync and Hold_Sentinel or Claims_Agent config | No re-sync and no prompt change in this session. | Changing a live squad affects real calls. Not done without a tested change. | Deferred. |
| Production pool sizing (`connection_limit`, `pool_timeout`) and DSO test values | No change. The DSO test stays failing and is reported as failing. | There is no measured load data to size a pool. Guessing a value could make the 503 worse or hide it. | Deferred until a measured load run exists. |
| Hold seconds migration (`CallAttempt.holdSeconds`) | Approved in principle. Prepare the migration on a branch. Do not merge it until Stage 1 is re-run and Khalid approves. | Needed for R-011 and R-016. A schema change is reversible on a branch, not on main. | Branch to be prepared. Merge needs approval. |
| Stage 2 owned-number run | Not run. | Reserved spending and vendor contact. | Deferred to Khalid. |

## Update 2026-11-22: token rotation and push

- Khalid confirmed the GitHub token has been rotated. Pushing feature branches and opening draft PRs is allowed. Pushing to `main`, merging and force-pushing stay prohibited.
- Counsel review is not being commissioned. Every legal and PHIPA item below is UNVERIFIED. None is treated as passed. The product stays at simulation level (PRD R-114).

## Questions for counsel (UNVERIFIED, not answered here, counsel review not commissioned)

1. Is a call window starting at 09:00 recipient local time (D6) sufficient under CRTC and provincial rules for automated calls to carriers and their staff? UNVERIFIED.
2. Does the statement upload path (D9) raise any privacy question under PIPEDA or PHIPA when a practice uploads carrier statements that contain patient identifiers? UNVERIFIED.
3. Are the terms of each carrier's provider portal compatible with the practice uploading statements downloaded from it? UNVERIFIED. Portal automation (D10) stays unbuilt until this is answered.
4. Do the learned lessons (R-015 name filter) meet the minimum necessary standard under PHIPA? UNVERIFIED.

## Open items for Khalid

1. Confirm the GitHub token rotation before any push.
2. List the materials that left his hands (D2). This is a fact.
3. Choose the bundle folder (D1), or accept the default.
4. Confirm what D13 to D15 refer to.
5. Decide when to run the owned-number run (D11), since it costs money.
