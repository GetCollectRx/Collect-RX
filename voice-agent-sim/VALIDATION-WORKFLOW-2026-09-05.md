# Combined Validation Workflow: Deployment Fix → Persona Testing → Human Comparison

**Date**: 2026-09-05
**Status**: PROPOSED
**Reads with**: SHADOW-CALL-VALIDATION-PROTOCOL-2026-09-05.md, CALL-PERSONAS-2026-09-05.md, voice-agent-sim/RUN-LOG-2026-07-10.md, agents/voice-agent-trainer.md

Sequenced in this order on purpose: there is no point measuring conversation quality (Phase 2) or comparing to a human baseline (Phase 3) against a squad config that still has a live compliance defect. Phase 1 must close first.

---

## Phase 1: Close the deployment gap (compliance-critical, do this first)

**Why first**: `vapi-squad-config.json`, the file that actually deploys to Vapi, still opens Claims_Agent with "You are an automated insurance collections agent" and still scripts Scenario F as "put a stop payment on that check and reissue it." The Sep 4 fix only touched `vapi-system-prompt.md`, a reference file nothing deploys, and it is still sitting there as an uncommitted local change.

**Steps**:
1. Open `vapi-system-prompt.md` and the Claims_Agent member of `vapi-squad-config.json` side by side.
2. Port the corrected language into the JSON:
   - Role/identity line: "automated claims status follow-up assistant... you do not negotiate, settle, or direct the carrier to take payment action; any decision about how to respond is made by the practice's own billing staff."
   - Scenario F: replace the stop-payment/reissue request with the information-only version (confirm mailing address, ask what the carrier's process is), and the closing line change ("the practice will follow up" instead of "request a reissue").
3. While in there, decide (don't silently carry over) whether to also address the sales-qualifier script's "lead with collecting AR" framing noted in memory as a separate, still-open item. This workflow doesn't force that decision, it just flags it so it isn't missed by omission.
4. Run a full diff of the two files beyond the two known lines. The gap between them may not be limited to what we already know about.
5. Commit `vapi-squad-config.json` and `vapi-system-prompt.md` together with a commit message that references the compliance fix explicitly.
6. Run `npm run vapi:squad-check` (read-only). Read every drift line it prints, not just the ones you expect. If anything unexpected shows up, stop and investigate before touching push.
7. Only once the diff shows exactly the intended change: run `npm run vapi:squad-push`.
8. Re-run `vapi:squad-check` immediately after to confirm live now matches repo with zero drift.
9. Separately, check current CI status on PR #87 (dispatch-approval gate) and PR #70 (demo-call-to-real-carrier risk), both flagged as unresolved as of Aug 20. They touch the same live-squad safety surface this phase is fixing; worth knowing their state before calling this phase closed.

**Exit criterion**: `vapi:squad-check` reports zero drift, and the live Claims_Agent, if asked directly whether it's a collections agent, would answer per the corrected identity, not the old one.

---

## Phase 2: Persona-based adversarial simulation (no live staff or pilot required)

**Prerequisite**: Phase 1 exit criterion met. Testing conversation quality against a known-bad config produces a result you'd have to throw away.

**Steps**:
1. Finish what's already built and paid-for-but-unrun: set `ANTHROPIC_API_KEY` and run `npm run eval:conversation-robustness` to get a live-model score against the existing S001-S025 / R001-R010 library (cost is roughly $0.50-1.00 per run, per the July 10 log).
2. Add the new adversarial personas from `CALL-PERSONAS-2026-09-05.md` (Part 4 and 5: Robot-Refuser, Contradiction-Giver, Non-Answer Repeater, Clock-Watcher, Deadline-Dropper, Partial-Payer, Privacy Gatekeeper, Settlement Offerer, Over-Identifier, plus the four new ones: Collections-Identity Prober, Multi-Call Rep, Sympathy Fisher, Silent Rep) as new scenario IDs in `SCENARIO-MASTER.csv` (next available: S026 onward), following the existing column shape so they slot into the same harness rather than living as a one-off side test.
3. Run those against the live-corrected Claims_Agent, prioritizing the Collections-Identity Prober first, since that's the one most likely to reveal whether the Phase 1 fix actually holds under direct pressure, not just in the opening disclosure.
4. Score against the existing outcome taxonomy (RESOLVED, PENDING_REVIEW, CARRIER_BLOCK, UNCLEAR, etc.) and log results in the Weekly Training Report format from `agents/voice-agent-trainer.md`.
5. Any failure goes through the existing Prompt Change Protocol in that same file: document the change, route to Vapi Squad Auditor, dry-run test, monitor 48 hours post-change.
6. Iterate in small batches (add a handful of scenarios, run, fix, re-run) rather than adding all new personas at once, matching the same batching discipline as Phase 3 below.

**Exit criterion**: new persona scenarios reach a pass rate you're comfortable with (the repo's own target elsewhere is 80%), with the Collections-Identity Prober passing cleanly.

---

## Phase 3: Human-comparison Shadow-Call protocol (once real calls are available)

**Prerequisite**: `RESEARCH_VAPI_*` credentials and per-carrier approval (unset as of the July 10 log), and someone to place the human-side call. This can start as a rough first pass with you personally placing the human call once per carrier, acknowledging that's a weaker baseline than an actual front-desk staff member, rather than waiting for a pilot practice to exist.

**Steps**: as detailed in `SHADOW-CALL-VALIDATION-PROTOCOL-2026-09-05.md`, condensed here:
1. Confirm `RESEARCH_VAPI_*` status.
2. Pick one carrier, 3-5 test claims.
3. Place matched human and AI calls same day, log independently before comparing.
4. Diff on the rubric: status, reason, expected date, reference number, unprompted value-add, transfers, duration.
5. Decide before running the next batch: does the gap (if any) justify the current conversational depth, or does it argue for a leaner build.
6. Repeat per carrier, not all six at once.

**Exit criterion**: enough batches across enough carriers to trust the pattern, not a single call standing in for a verdict.

---

## Sequencing summary

| Phase | Blocked on | Who acts | Cost |
|---|---|---|---|
| 1. Deployment fix | Nothing, can start now | You (git commit, run push) or me, with your go-ahead, via the connected repo | Free |
| 2. Persona simulation | Phase 1 complete | Either of us; needs `ANTHROPIC_API_KEY` | ~$0.50-1.00 per eval run |
| 3. Human comparison | `RESEARCH_VAPI_*` approval + a human to place calls | You, at least for the human-call leg | Live call costs, minimal |
