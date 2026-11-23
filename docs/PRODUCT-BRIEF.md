# CollectRx product brief (read this first, every session)

Owner: Khalid. One page. Stable. If something here is wrong, Khalid corrects it and the change is recorded in docs/DECISIONS-REGISTER.md.

## What the product is for

Dental practices and other insurance-facing businesses lose hours every week sitting on hold with insurers to chase claims. That is paid staff time that produces nothing while the line is silent. CollectRx takes that time back: it dials the carrier, navigates the phone menu, waits on hold, and brings a person in only when a live representative answers.

## The wedge and the engine (V1)

- **Hold Sentinel is the product sold first.** It removes the pain the first dentist described: waiting on hold for a long time, then hearing something simple like "send the x-ray".
- **Hold Sentinel is also how the product learns.** Claims_Scribe listens to every call, removes patient information, and records carrier behavior and what front desk staff do. That is the training data the product does not have yet. It is how the later autonomous product gets earned.
- **Autonomous calling is available, not blocked.** Neither mode is the default entry. Hold Sentinel is recommended to cautious practices. A practice chooses its mode, per carrier, and can change it at any time. A carrier activates for autonomous only when the evidence says it is ready.

## Data policy: learn without keeping patient information

Never all or nothing. Four tiers.

| Tier | What | Rule |
|---|---|---|
| 0 | Audio, raw transcripts, patient identifiers | Never stored at rest by default. Used in memory only. |
| 1 | Evidence ledger: that a call happened and what it produced | Kept. Call times, duration, carrier, outcome, reference number, who took the handoff, disclosure given (yes or no, and when), the audit chain. |
| 2 | Behavior ledger: what carriers do | Kept. Closed vocabulary only, so it cannot hold a name: menu path, prompt timings, hold length, denial reasons, documents requested (for example x-ray, narrative, perio chart), what staff did (category, not words). |
| 3 | Redacted transcript retention | Off by default. A consented pilot may turn it on for a fixed window, only if counsel allows. |

## Non-negotiables

- No patient information stored beyond the tiers above. Never in Vapi metadata, logs or the database.
- The carrier block rule: if a carrier detects automation, all calls to that carrier stop.
- Disclosure of the automated system within 10 seconds of a live rep answering.
- No calls to real carriers during the build. No call of any kind until the pre-call gate is met (docs/operations/PRE-CALL-LOGIC-GATE.md).
- A claim is only called "paid" with evidence beyond a spoken reference number.

## Who uses it

The front desk takes the live rep. The office manager trusts that follow-up is happening. The owner sees money recovered and time saved.

## How sessions must work

1. Read this brief, docs/DECISIONS-REGISTER.md, and CLAUDE.md before doing anything.
2. If a question is answered in the register, do not ask it again.
3. For reversible choices, recommend one answer, say why, and proceed unless Khalid vetoes. Ask only about spending money, legal exposure, irreversible changes, or things only Khalid can do.
4. Say "I do not know" plainly, and mark anything not run as UNVERIFIED.
5. Prove it at the level claimed. Simulation is not a real carrier.

## Where the truth lives

Governing PRD: "CollectRx PRD: Hybrid Call Flow and Expansion" (Oct 28, 2026), plus PRD v2 (Nov 20, 2026). Decisions: docs/DECISIONS-REGISTER.md. Rules: CLAUDE.md. Status: the latest PRD-EPIC-STATUS file. Anything dated is history, not instruction.
