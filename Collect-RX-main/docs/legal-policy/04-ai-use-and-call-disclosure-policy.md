# 04. AI use and call disclosure policy

> DRAFT. Not reviewed by a lawyer. Positions per the founder's signed risk register (R6 accepted by reviewer, unsigned; R9 and R10 unsigned). Open items listed at the end.

## Purpose

Set what CollectRx's voice agents must say, may say and must never say on calls to insurers, and when a human takes over.

## Who it binds

Agent prompts in both trees (`Collect-RX-main/agents/` and `/agents`), `vapi-squad-config.json`, call scripts in `src/vapi/client.ts` and `src/server/vapi/missedHandoff.ts`, and staff who handle human-assisted calls.

## Obligations implemented

| Obligation | Source (research file#row) | Tag |
|---|---|---|
| Identify the principal, purpose, an email or postal address and a local or toll-free number at the start (if the ADAD rules apply) | UTR Part IV s.4(d) (CRTC-UTR-CARRIER-AND-SALES-CALLS.md#3) | VERIFIED |
| Hours 9:00 a.m. to 9:30 p.m. weekdays, recipient local time (if the ADAD rules apply) | UTR Part IV s.4(b) (CRTC file #2; CORRECTIONS A1) | VERIFIED |
| Disconnect within 10 seconds of hangup | UTR Part IV s.4(h) (CRTC file #6) | VERIFIED |
| No adjusting, negotiating or settling; licence offence and motor claim negotiation ban | Insurance Act ss.1(1), 397, 398 (insurance-licensing-collection.md#9, #10, #12; register R9) | VERIFIED |
| Minimum necessary disclosure of identifiers | PHIPA s.30 (health-privacy.md#10) | VERIFIED |
| Truthful statement about recording and transcription | TR#2; Vapi default storage (CORRECTIONS A5) | VERIFIED |
| Accuracy: record rep statements as statements | PHIPA s.11; PIPEDA cl. 4.6 (health-privacy.md#17) | VERIFIED |

## Policy

### 1. Opening script (carrier calls, first human-facing utterance)

Required elements, in this order, spoken before any identifier:
1. That this is an automated calling system.
2. The practice on whose behalf the call is made.
3. The purpose: following up on the status of a claim the practice submitted.
4. A callback number (local or toll-free) and an email address at which a representative of the practice can be reached.
5. A true statement about transcription (wording owned by W6, `PENDING_COUNSEL` constant).

Draft (placeholders are config values, never hardcoded):
"Hello, this is an automated calling system calling on behalf of {{practice_name}} about the status of a claim the office submitted. You can reach the office at {{practice_phone}} or {{practice_contact_email}}. {{transcription_notice}}"

If the call lasts more than 60 seconds, the agent repeats the practice name, callback number and email before ending.

### 2. What the agent may do

- Ask for claim status, dates, reference numbers, missing documents and where to send them, and expected payment dates.
- Confirm identifiers only after the representative asks for that identifier.
- Record what the representative states, labelled as stated by the representative.
- End the call politely if asked, and honour any request not to be called again on that line (flag for staff review).

### 3. What the agent must never do

- Claim or imply it is a human, or deny being automated when asked.
- Negotiate, propose or accept an amount, argue coverage, dispute a decision, threaten action, or make a demand.
- State legal conclusions, including that an invoice is "deemed" approved or proper, that a lien exists or does not, or that a limitation period has or has not run.
- Compute or state interest, penalties or limitation dates to the counterpart.
- Invite or draft an acknowledgment of debt.
- Speak identifiers the representative did not ask for, or any health card number or SIN.
- Leave a voicemail message.
- Call patients.

### 4. Human oversight and handoff triggers

The agent stops and hands off (warm transfer to practice staff where configured, otherwise ends the call and creates a staff task) when:
- The representative disputes the claim, denies it, or raises coverage, eligibility or clinical questions needing documentation beyond a status check.
- The representative asks for authority the practice has not given, or asks who CollectRx is and whether it is licensed.
- The representative asks for the practice's consent or authorization documents.
- The call concerns a motor vehicle accident benefits file or an adjuster-handled claim (module not launched).
- Anything is said that suggests automation detection or a request to stop automated calls (triggers CARRIER_BLOCK review).
- The claim is over 90 days old (existing rule).

### 5. Human-assisted mode (Hold Sentinel)

Practice staff speak with the representative while Claims_Scribe transcribes. Staff are given an on-screen identification line to say at the start (practice name, purpose, callback number) and a transcription notice line (W6). Whether staff must give the transcription notice is OPEN (TR#19).

### 6. Hours

Calls are placed only within the intersection of (a) 9:00 a.m. to 5:00 p.m. on weekdays in the recipient's local time and (b) the carrier line's staffed hours. Current code uses 08:00 to 17:00 Eastern (founder decision D1).

## Open items

1. D1: move the window start to 09:00 recipient local time (`isWithinCallWindow()` in `src/carriers/adapter.ts`; touches files in open PRs #121, #122, #124, so sequence after those merge).
2. Email address for the opener: practice address or a CollectRx relay (PENDING_FOUNDER_DECISION).
3. Register R10 unsigned; this policy builds to the ADAD floor regardless.
4. Transcription notice wording (W6).

## Code control and test

| Control | Test | Status |
|---|---|---|
| Opening disclosure present in Claims_Agent first message and fallback | `src/server/frontDesk/vapiDeskEvents.ts` checks "automated calling system" | Present (automation only) |
| Opener contains purpose, callback number and email | Snapshot test on the opener builder | Not built (follow-up after D1/item 2) |
| Prohibited phrases absent from transcripts and prompts | Transcript and prompt lint (SYNTHESIS F2, IS section 8 rule 3) | Not built |
| Window check | `isWithinCallWindow()` unit tests | Present at 08:00 (D1) |
| Hangup disconnect under 10 s | Measured test calls (TR#9) | Not done |
| Variable allowlist (identifiers only when needed) | W5 (planned) | Planned |
