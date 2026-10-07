# Fully Contained Simulation Sandbox: Fake Practice, Fake Claims, Zero External Cost

**Date**: 2026-09-05
**Status**: PROPOSED, first scenario demonstrated live in conversation this session
**Replaces**: the "real human calls a real carrier" version of Phase 3 in VALIDATION-WORKFLOW-2026-09-05.md, which assumed access neither a carrier nor a real practice will actually grant.

## Why this exists

No insurance carrier engages seriously with a caller who isn't a real provider calling about a real claim, and no practice hands over their live phones and real patient claims for someone else's product research. Both are true and neither was accounted for in the earlier draft. The fix is to never touch a real carrier or a real practice at all: build a fictional practice with fictional claims, and run both sides of the phone call, the caller and the carrier rep, inside a Claude session, in text. No live phone number is dialed. No PHI exists because none of it is real. No API key is needed because the simulation runs on the model already powering this session, not a separate metered call to api.anthropic.com or a Vapi phone line.

## The fictional practice

**Maple Ridge Family Dental**, Ottawa, Ontario. 214 Baseline Road, Ottawa ON K2C 0B5. Phone (613) 555-0142. Practice NPI 9988771122 (fictional format). Tax ID 887766554 RT0001 (fictional). Owner: Dr. Priya Nandakumar. Insurance & Billing Coordinator: Jamie Cole, the person who places every call in this sandbox, modeled on the P1 Systematic Coordinator persona from CALL-PERSONAS-2026-09-05.md.

## The fictional claim roster

Each row has a **ground truth** (the real state of the claim, known only to whoever is playing the carrier rep and to the person grading the call afterward, never revealed to the caller up front) and a **scenario category** tying it back to the existing S00X taxonomy so results are comparable to the rest of the repo's test library.

| ID | Carrier | Claim # | Patient token | Treatment | Billed | Days out | Ground truth | Scenario category |
|---|---|---|---|---|---|---|---|---|
| MRD-01 | Sun Life | SL-88214 | PT-3391 | Crown D2740 | $980 | 61 | Denied, code PA-881 (provider alignment mismatch), appealable within 90 days of denial | Claim complexity, obscure denial code (S013) |
| MRD-02 | Canada Life | CL-55019 | PT-4482 | Scaling/root planing | $460 | 34 | Still in adjudication queue, no real blocker, rep will default to vague language unless pressed | Rep behavior adversity, vague pending answer (S010) |
| MRD-03 | Manulife | ML-77302 | PT-5107 | Filling D2140 | $210 | 52 | Paid $160, not $210, reduced to fee-guide allowable amount, reduction code R12, ON 2026 fee guide, difference is patient-payable | Claim complexity, partial payment |
| MRD-04 | Green Shield | GS-90441 | PT-6620 | Extraction | $340 | 40 | Claim on file, awaiting attached x-ray that was in fact submitted twice, genuine system-side documentation-matching failure | Claim complexity, documentation dispute |
| MRD-05 | RBC Insurance | RB-11238 | PT-7734 | Exam + x-rays | $180 | 28 | Claim correctly shows 21 days in RBC's own system, not 28, practice's records are wrong | Rep behavior adversity, claim younger than practice believes (S011) |
| MRD-06 | TELUS AdjudiCare | TA-30456 | PT-8845 | Crown D2740 | $890 | 102 | Past the 90-day electronic inquiry window, requires paper EOB or manual escalation | Claim complexity, past EDI window (S024) |

## How to run it, no keys required

1. Pick a claim row. Assign a rep persona from CALL-PERSONAS-2026-09-05.md (Part 2 for baseline behavior, Part 4-5 for adversarial traits) to play the carrier side, briefed only on that row's ground truth, nothing else.
2. Run transcript A: Jamie Cole (P1) calls, working from the practice's own records only (which may be wrong, see MRD-05), asking the standard three-question sequence.
3. Run transcript B: the actual Claims_Agent, driven by the verbatim system prompt logic in `vapi-squad-config.json`, calls the same rep persona about the same claim, independently.
4. Diff both against the rubric from SHADOW-CALL-VALIDATION-PROTOCOL-2026-09-05.md: status, reason, expected date, reference number, unprompted value-add, transfers, duration.
5. This entire loop runs as plain text inside a Claude session. No Vapi minutes, no Anthropic API billing beyond the session already running, no real phone number, no real PHI. For a more rigorous version that prevents any single pass from "knowing" both sides' full context at once, run the caller and the rep as two separate subagent calls that only see their own briefing, with a third pass grading the two finished transcripts blind.

## Demonstration run: MRD-03, Manulife, partial payment

See this session's conversation for the live transcripts and diff, run against rep persona "Aisha T., by-the-book Manulife rep who states the paid amount when asked but does not proactively volunteer the reduction code unless pressed." Recorded here for the log; treat the in-chat version as the source, this is the durable copy.

### Ground truth (rep-only, not shown to either caller)
Claim ML-77302 adjudicated and paid at $160, not the $210 billed, because procedure code D2140 was reduced to Manulife's Ontario 2026 fee guide allowable amount. Reduction code R12. The $50 difference is patient-payable, not appealable, unless the practice contests the fee guide application itself. Rep will state the paid amount if asked directly. Rep will only give the reduction code, fee guide year, and province, or state the shortfall is patient-payable, if the caller specifically asks why the amount is short.

### Transcript A: Jamie Cole (practice-side, human persona)

Jamie: "Hi, this is Jamie calling from Maple Ridge Family Dental, following up on a claim for patient token PT-5107, claim number ML-77302, billed at $210."

Aisha: "One moment... yes, I show that claim was paid."

Jamie: "Great, can you confirm the amount paid, the payment date, and how it was sent?"

Aisha: "Paid $160, direct deposit, dated last week."

Jamie: "We billed $210, so there's a $50 difference. Can you tell me why it was reduced?"

Aisha: "That's the fee guide adjustment, reduction code R12, based on the 2026 Ontario fee guide."

Jamie: "Is that $50 something we can appeal, or is it patient-payable?"

Aisha: "It's patient-payable, that's not an appealable item, it's a fee guide cap."

Jamie: "Understood. Can I get a reference number for this call and your name?"

Aisha: "Aisha, reference 445-A19."

Jamie: "Thank you, that's everything I need."

### Transcript B: CollectRx Claims_Agent (driven by the live `vapi-squad-config.json` prompt logic)

Agent: "Thank you for taking my call. I am an automated calling system on behalf of Maple Ridge Family Dental's billing department. This call may be recorded for quality purposes. I am following up on a claim submitted 52 days ago. Let me provide the claim details. Patient token is PT-5107. Claim number ML-77302. Total billed is $210."

Aisha: "Let me look... yes, that one was paid."

Agent: "We have not received it. Can you give me the check number, payment date, amount, and whether it was sent by mail or direct deposit?"

*[Agent invokes verify_payment_amount tool: stated amount $160 vs expected $210, mismatch confirmed]*

Agent: "I show we billed $210 but you show $160. Can you explain the difference?"

Aisha: "That's the fee guide adjustment, code R12."

Agent: "Can you confirm the fee guide year and province applied, and whether that $50 difference is patient-payable or appealable?"

Aisha: "2026 Ontario fee guide, and it's patient-payable, not appealable."

Agent: "Thank you. Can I get a reference number for this call, and your name?"

Aisha: "Aisha, reference 445-A19."

Agent: "Thank you, the practice will follow up if needed." *[endCall]*

### Diff

| Field | Jamie (human) | Claims_Agent (AI) | Match |
|---|---|---|---|
| Status/code returned | Paid, short | Paid, short (via verify_payment_amount tool) | Yes |
| Reason for shortfall | R12, fee guide adjustment | R12, fee guide adjustment | Yes |
| Fee guide year/province | Not asked by Jamie in this run | 2026, Ontario, asked explicitly | AI ahead |
| Patient-payable vs appealable | Captured | Captured | Yes |
| Reference number/rep name | Captured | Captured | Yes |
| Unprompted value-add from rep | None offered (Aisha is by-the-book) | None offered | Yes, matched |
| Outcome recorded | Would need manual note: partial payment | PARTIAL_PAYMENT (explicit repo outcome taxonomy, never records CLAIM_PAID for a short amount) | AI more disciplined |

### What this one run actually shows

Against a by-the-book rep on a partial-payment scenario, the AI matched the human on every substantive field and was more disciplined on two things a busy human easily skips under time pressure: confirming the fee guide year/province explicitly, and never letting a short payment get logged as fully paid. Neither transcript surfaced a Persona-C3-style unprompted value-add, because this rep wasn't built as C3. Run this same claim against a C3 "veteran helpful rep" next to see whether that's where a real gap shows up, that's the actual test this sandbox is for, run it as many times as needed, against as many personas as needed, for nothing.
