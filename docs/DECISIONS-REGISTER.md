# CollectRx decisions register

Append only. Each row says who decided and when. A session must not re-ask anything marked DECIDED.

Status values: DECIDED (Khalid said so), DEFAULT (Claude recommended it and it stands unless Khalid vetoes), HUMAN (only Khalid can do it), OPEN (genuinely undecided).

## Decided by Khalid

| Date | Decision | Source |
|---|---|---|
| 2026-10-06 | V1 is Hold Sentinel. Staff speak to the rep. Autonomous follows. | ADR 0003 |
| 2026-10-06 | If staff miss a handoff, the agent always gets a reference number. | ADR 0003 |
| 2026-10 | Hold Sentinel stays at $399 per month. | Oct 28 PRD |
| 2026-11-12 | CSV is the primary way claims come in. | DECISIONS-2026-11-12 |
| 2026-11-12 | No call of any kind until the pre-call logic gate is met. No calls to real carriers during the build. | PRE-CALL-LOGIC-GATE |
| 2026-11-23 | Autonomous calling is available and not blocked. Neither mode is the default. Hold Sentinel is recommended to cautious practices. | Session |
| 2026-11-23 | No patient information may be stored anywhere. | Session |
| 2026-11-23 | The learning component is intentional: Claims_Scribe removes patient information and learns carrier behavior and staff behavior. | Session |
| 2026-11-23 | The repository is public so that sessions can push code. | Session |
| 2026-11-23 | Stop building until the path forward is set. | Session |

## Defaults in force (Claude recommended; veto to change)

| ID | Default | Why |
|---|---|---|
| D-01 | The four data tiers in docs/PRODUCT-BRIEF.md. Transcripts are not stored at rest by default. Lessons and the disclosure check are produced in memory at call end, and only results are kept. | Keeps the learning, removes the patient information, and still leaves an audit trail. |
| D-02 | The practice may choose autonomous. Each carrier activates for autonomous only when it meets the evidence conditions and the carrier terms check. Otherwise that carrier uses Hold Sentinel and the screen says why. | Honors "not blocked" while protecting the most serious risk, a carrier ban. |
| D-03 | The evidence thresholds in the Oct 28 PRD are the starting graduation figures: at least 50 staff-handled calls, reference number on at least 90 percent, unresolved fields at most 15 percent, rep suspicion of automation at most 2 percent. | They already exist as starting figures. |
| D-04 | The owner may edit practice settings, including the mode. | PRD v2 proposes it. |
| D-05 | Keep the Vapi squads for the first pilot, with a spend cap. Decide Option A or B after one gated live test answers the transfer and scribe questions. | One test replaces two guesses. |
| D-06 | Claims_Scribe's first message is cleared, so it cannot speak to a rep. | It must be silent. |
| D-07 | Pricing, margin math and competitor material stay out of the public repository. They live in the private project knowledge. | The repository is public. |
| D-08 | Sessions follow the working rules in docs/PRODUCT-BRIEF.md: recommend and proceed on reversible choices. | Ends the repeated questions. |

## Human actions (only Khalid can do these)

| Action | Why |
|---|---|
| Rotate any credential flagged in the private security notes | Credential hygiene |
| Clear Claims_Scribe's first message in the Vapi dashboard, or approve doing it by API | Production edit |
| Decide whether the repository should be private | Visibility is a business decision |
| Book a short privacy consult before any real patient data | Transcript handling and processing by an outside vendor are legal questions |
| Name the pilot dentist and set a spend cap for the first gated test | Needed before the first live test |

## Open

| Item | Notes |
|---|---|
| Whether sending redacted text to the extraction vendor is acceptable | Counsel question. Default is to keep lessons derived in memory with hard stripping. |
| Carrier block scope: one practice and its siblings, or every practice | Gap 12 in the pre-call gate |
| Which plan includes autonomous, and the autonomous prices | Waits for measured cost per call |
| Whether $399 or $799 is the current Hold Sentinel figure in ADR 0003 | ADR 0004 and the Oct 28 PRD say $399 |
