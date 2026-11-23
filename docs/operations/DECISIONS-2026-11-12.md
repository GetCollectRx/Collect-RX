# Decisions recorded 2026-11-12

Source: Khalid's answers in session, plus the front desk alerting build brief he supplied. Items marked ASSUMPTION are my reading and need his correction if wrong. Nothing marked PROPOSED is built.

## 1. Claim ingest

| Decision | Detail |
|---|---|
| CSV is the primary path | Already the repo's decision of record (PATH-TO-DELIVERY P4-07, `recoveryMode` default `CSV_FIRST`). The AbelDent agent is legacy. |
| An in-app file drop with instructions | Built 2026-11-12: the import screen lists every required column with what it means, an example and the other names accepted, and offers a blank template. |
| Strict requirements | Built: if a required column is missing, empty on every row, ambiguous (two columns could be the same field) or repeated, the whole file is refused and nothing is imported. Each problem is named, with a suggested fix. |
| Rejection is part of alerting | Built in part: a refusal raises a `PMS_IMPORT_FAILED` practice notification. The full alert lifecycle is still to build (see section 8). |

ASSUMPTION: strictness is at file level. Row-level problems (one claim with a blank date of birth, an unknown carrier) still hold that claim back with a reason while the rest of a sound file imports. The JSON and connector import path is unchanged.

A defect found on the way, fixed: the importer never read a `Policy Number` or `Member ID` column, because the CSV parser had already turned spaces into underscores. The repo's own `sample-claims.csv` imported with no member IDs, and carriers cannot be called without them.

## 2. Expiry rule and overload

Decision: staff should answer within 5 minutes. They asked that this not create more problems, such as a flood of call backs, and for creative options.

ASSUMPTION about what the 5 minutes means: a carrier rep will not wait 5 minutes, so the 5 minutes cannot be how long a live rep holds. I read it as the window for staff to confirm they are ready before the long hold starts (PROPOSED below), with the transfer ringing within seconds once a rep answers.

PROPOSED protections against overload:

| Protection | Effect |
|---|---|
| Pre-dial confirmation | Before a dial that will hold about half an hour, staff get a prompt and confirm within 5 minutes. No confirmation, the dial is deferred to the next standby window. |
| Miss-streak breaker | After 2 missed handoffs in a row, availability switches to Off, dispatch pauses, the office manager is alerted. It resumes only when someone marks available. |
| Daily handoff budget | Staff set how many live calls they can take today. The planner never schedules more. |
| Spaced retries after a miss | A missed claim waits for the next standby window instead of retrying at once, so a bad hour does not turn into a burst of attempts and a carrier block. |
| Dedicated callback line | The missed-handoff script gives reps a CollectRx-owned number (voicemail plus logging) instead of the practice's main line, so carrier call backs never ring the front desk. This changes the disclosure script and needs his decision. |
| One pickup, several claims | PRD Epic 5: one call covers up to a per-carrier cap of claims, so fewer pickups are needed. |

UNVERIFIED: how long a carrier rep will wait in silence for the autonomous ending's "One moment please". Five minutes is likely too long. Treat it as a setting to measure, not a figure.

## 3. Pricing

| Decision | Detail |
|---|---|
| Autonomous tiers priced at 80% margin on measured cost | Prices wait for Epic 6 to measure real cost per call. |
| All money is CAD | Includes the $399 Hold Sentinel price and the $75 per hour labour figure. |
| Hold Sentinel stays $399 (69% margin) | Decided earlier. |

STILL OPEN: ADR 0003 mentions a "$799/month" ROI case while the PRD says $399. Which is current?

## 4. Desk socket

It is not needed to answer calls. Calls ring the practice's escalation phone line. The socket only carries live events to the browser: the rep-on-the-line banner, call state, transcript lines. It was opened to owner, office manager and the other practice roles so unanswered alerts can reach a manager, as the alerting brief requires. Accountants and group admins are refused. If the banner is not wanted, the role change can be reverted without affecting how calls are answered.

## 5. Ring plus banner, and standby

Decided: keep ring plus banner for V1.

New requirement: staff set a schedule, and can mark themselves on standby, so calls are deferred to their standby windows. This is PRD Epic 4's call windows: a weekly schedule per person with exceptions, plus a quick "standby until" control. The planner dials so the expected pickup lands inside a window. PROPOSED, not built.

## 6. Vapi dashboard checks

No browser or computer-control tool is available in this session and no computer is connected (`list_computer_folders` returns none). From the backed-up squad configuration: the human-assisted squad is `CollectRx V1 Human-Assisted Squad (Listening)` with IVR_Navigator, Hold_Sentinel and Claims_Scribe. The handoff is sent by our code as a plain `transfer` command to a phone number through live call control, with no warm-transfer plan anywhere in the configuration. Whether Vapi treats that as a blind transfer is from memory of its documentation and UNVERIFIED. Whether Claims_Scribe keeps hearing after the transfer cannot be read from configuration. Only a call shows it.

## 7. No calls until the logic is sound

No call of any kind, including a test call to Khalid, until `PRE-CALL-LOGIC-GATE.md` is satisfied.

## 8. The front desk alerting brief against this branch

The brief was written against main commit 851439f. This branch has moved.

| Brief says | State on this branch |
|---|---|
| Desk socket is front_desk only with no alert event | Now admits front desk plus the `practice_owner` brief role. Events `handoff.requested` and `handoff.missed` exist. |
| Rep on the line is a quiet bell notification | Now an app-wide banner with sound and a title change. Still no acknowledge, snooze or escalation. |
| Staff availability not mentioned | Built: per-person AVAILABLE, BUSY, OFF; dispatch and handoff depend on it. |
| Import failure alert | A refusal now raises `PMS_IMPORT_FAILED`. Volume checks, stale-upload and the rest are not built. |
| `desk_alerts` table with lifecycle, 21 policy codes, sweep, digest email | Not built. |
| Connector alerts (offline, auth, schema drift) | Legacy: they apply to the AbelDent agent. With CSV primary, replace them with stale-upload and rejected-upload alerts. |
| Desktop tray toast | Needs the Electron app, which CSV-first practices do not install. Treat as optional. |
| Security: a GitHub token sits in plain text in the git remote of Khalid's local Dental folder | Not in this repo. Rotate it before any push from that folder. |
