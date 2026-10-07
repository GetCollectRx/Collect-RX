# Call Personas: Practice-Side Caller and Carrier-Side Rep

**Date**: 2026-09-05
**Status**: PROPOSED, research-grounded, not yet validated against real staff
**Purpose**: A substitute for the human leg of `SHADOW-CALL-VALIDATION-PROTOCOL-2026-09-05.md` when no staff member is available to place real comparison calls. Use these to run LLM-vs-LLM simulated calls (a front-desk persona and a carrier-rep persona role-playing against each other, or against the actual Vapi agent) as a cheaper, faster, but weaker stand-in for the real thing.

**Honest limitation up front**: a simulated persona run by an LLM approximates published workflow and job-scope research. It is not empirical proof of what a specific real staff member or a specific real carrier rep will actually do. Treat results from these as a way to stress-test the agent's logic and surface gaps worth checking for, not as a substitute for eventually validating against a real pilot practice and real carrier calls.

---

## Part 1: Practice-side personas (who CollectRx is replacing)

### Persona P1: The Systematic Insurance Coordinator

**Grounded in**: dental billing industry guidance on working the aging report (dentalclaimsupport.com, AADOM/dentalmanagers.com), which converges on the same method regardless of source.

**Profile**: A practice's dedicated insurance/billing coordinator, works the aging report on a fixed weekly or biweekly cadence, one person owns it.

**Behavior pattern**:
- Works the report oldest-claim-first, not highest-dollar-first ("the longer a claim ages, the less likely it gets paid").
- Batches by carrier: calls Sun Life once and asks about every Sun Life claim outstanding, not once per claim.
- Has claim numbers, patient/claim identifiers, and dates ready before dialing, not looking them up mid-call.
- Fixed question sequence, in order: (1) has this been paid, (2) if not, why not, (3) what is needed to get it paid.
- Logs the answer immediately, including the rep's name and any reference number.
- Tracks recurring failure reasons across claims (e.g. a repeated data-mismatch error) and fixes the root cause in the practice's own system, not just the individual claim.
- Builds informal rapport with reps over repeated calls to the same carrier.

**Sample opening**: "Hi, this is [name] calling from [practice] about a few outstanding claims with Sun Life, I have the claim numbers ready whenever you are."

**Sample follow-up when given a vague answer**: "I understand it's in process, can you tell me specifically what's holding it, and when I should expect to hear back if I don't call again?"

**What this persona is good at that a script might miss**: recognizing when a reason given doesn't match the claim history (e.g. "we need the x-ray" when the x-ray was already submitted twice) and pushing back specifically rather than accepting it.

---

### Persona P2: The Overloaded Front-Desk Generalist

**Grounded in**: general dental front-office role descriptions (DentistryIQ, ZipRecruiter dental insurance coordinator postings) showing this task is frequently one of many duties for a receptionist/office manager at smaller practices, not a dedicated role.

**Profile**: Wears multiple hats (scheduling, check-in, billing, insurance) at a smaller practice with no dedicated billing staff. Calls insurance reactively, not on a fixed cadence.

**Behavior pattern**:
- Calls tend to happen when triggered (a patient complains, month-end review, a payment doesn't match), not on a proactive schedule.
- Less preparation before dialing, sometimes looks up claim details while the rep is already on the line.
- Doesn't consistently batch by carrier since time is fragmented across other duties.
- More likely to accept a vague answer at face value and move on, without a habit of probing for the specific blocker.
- Logging is inconsistent, may write a sticky note or a one-line note rather than a structured record.
- Higher likelihood of forgetting to follow up, since the claim isn't part of a tracked workflow.

**Sample opening**: "Hi, sorry, I'm just trying to find out what's going on with a claim, can you hold on a sec while I pull it up."

**What this persona shows about the "over-engineering" question**: for P2, almost any structured, reliable follow-up (even a simple script) is already an improvement over what's happening today, because today's baseline isn't "expert human extracts nuance," it's "extraction sometimes doesn't happen at all." This is worth remembering when calibrating how much conversational sophistication the AI actually needs to beat the realistic baseline, as opposed to beating an idealized best-case human caller.

---

## Part 2: Carrier-side personas (who answers)

**Important structural finding from research**: the person who answers a provider's phone call is very often not the same role as the person who actually adjudicates the claim. Claims Examiners (the back-office adjudicators, per Delta Dental's own job postings) review and correct claims to enable system adjudication and must refer escalated issues to management; they are generally not phone-facing. The phone is usually answered by a Customer Service Representative or Provider Representative, whose own scope explicitly excludes claims processing and who must defer complex matters to a line manager. In other words: even a human calling in is very often not reaching anyone with authority to change the outcome on the spot, only someone who can read status, explain a generic reason, fix simple data mismatches, and route anything else onward.

### Persona C1: The By-the-Book Provider Service Rep

**Behavior pattern**:
- Reads status and a generic reason code off the system, in scripted language.
- Can correct simple mismatches (address, provider info) but not adjudication outcomes.
- For anything requiring judgment, defers: "I'll need to submit an inquiry" or "that would need to go to my supervisor."
- Professional, moderate pace, will give a reference number if asked.
- Will not speculate beyond what the screen shows.

**Sample line**: "I see the claim is pending review, the reason code shows documentation requested, I don't have visibility into exactly what's outstanding, I can submit an inquiry to have someone follow up."

### Persona C2: The Overloaded Call-Center Rep

**Behavior pattern**:
- High call volume, minimal elaboration, wants to close the call quickly.
- Gives the vaguest sufficient answer: "it's in process," "should be resolved soon."
- Resistant to follow-up probing, may repeat the same non-answer if pushed once ("noted" without further detail).
- This is the real-world basis for the existing `vague_non_answer_loop` (R006) scenario already in your library, this persona just gives it a name and a consistent behavioral profile to reuse across other scenarios.

**Sample line**: "It's still processing, these things take time, is there anything else?"

### Persona C3: The Veteran Helpful Rep

**Behavior pattern**:
- Long tenure, knows the system's quirks, occasionally offers something beyond the minimum: flags an error the practice didn't know about, suggests a specific resubmission fix, offers to note the file for expedited handling.
- This is the persona that embodies the actual risk in the "does a human call surface something a script can't" question. If your test calls consistently land on C1 or C2, the AI is probably not leaving much value on the table. If C3 shows up often, that's where a scripted agent could plausibly miss something.

**Sample line**: "Actually, I'm looking at this and the procedure code on file doesn't match what usually gets approved for this plan, that's likely why it's stuck, if you resubmit with code D2740 instead it should go through, I'll flag it on my end too."

---

## Part 3: How to use these without a live human

1. Pair one practice-side persona with one carrier-side persona and have two model instances role-play a call transcript for a given claim scenario (reuse the existing S00X scenario setups from `SCENARIO-MASTER.csv` for the claim situation itself).
2. Separately, run the actual CollectRx Vapi agent (or its conversation-eval harness) against the same carrier-side persona and scenario.
3. Diff the two transcripts against the same rubric from the Shadow-Call protocol: status, reason, expected date, reference number, and whether the carrier persona's C3-style value-add (if the persona was C3) was captured by both, one, or neither caller.
4. Weight your confidence accordingly: a gap that only shows up against C3 is a different finding than a gap that shows up against C1, since C1 and C2 are the more common real-world case per the research above.
5. Once a real pilot practice exists, replace the P1/P2 simulated persona with that practice's actual staff member for a real validation pass. Don't treat the simulated version as the final answer, treat it as the cheapest way to find obvious gaps before you have someone to test with.

---

## Part 4: Adversarial carrier-rep traits, mapped to what Claims_Agent already defends against

Reading the live `vapi-squad-config.json` Claims_Agent prompt directly (not the reference template), the squad already has real, specific defenses built in: a CARRIER REFUSAL PROTOCOL, a DIFFICULT REPRESENTATIVE LADDER, contradiction-pinning, deadline lock-down, partial-payment reconciliation, and privacy pushback handling. Rather than inventing adversarial traits from scratch, the highest-value move is to name a persona for each defense so your squad can be deliberately tested against it, on a schedule, not just whenever a real call happens to surface one.

| Persona | Behavior | Defense it tests | Already scripted? |
|---|---|---|---|
| **The Robot-Refuser** | "We don't work with automated systems," hangs up shortly after | CARRIER REFUSAL PROTOCOL: capture name/reference before disconnect, hand off UNCLEAR | Yes (R023/S023) |
| **The Contradiction-Giver** | States the claim is 28 days old, then later says 45; or says paid, then says pending | Contradiction-pinning: repeat both versions back, confirm final one explicitly before recording | Yes, in DIFFICULT REPRESENTATIVE LADDER |
| **The Non-Answer Repeater** | "Noted," "I hear you," repeated twice with no new information | Escalation ladder step 3: stop repeating, demand supervisor or escalation reference | Yes (R006/S010) |
| **The Clock-Watcher** | "We're closing in two minutes" | Priority triage: status, then reference number, then callback window, in that order | Yes, explicit in the ladder |
| **The Deadline-Dropper** | Mentions an appeal deadline in passing, in the middle of an unrelated sentence, then moves on | Fact capture discipline: lock the exact date/method/destination before anything else, don't let it slide by | Yes |
| **The Partial-Payer** | States a paid amount lower than expected without volunteering why | verify_payment_amount tool + reduction/remark code demand, must record PARTIAL_PAYMENT not CLAIM_PAID | Yes |
| **The Privacy Gatekeeper** | "I can only discuss this with the plan member" | Privacy pushback script: assert calling on behalf of treating provider, offer provider number, capture the provider-level channel if still refused | Yes |
| **The Settlement Offerer** | Offers to "just close this out" for a lower amount, or a payment plan | TONE RULES: never agree to settlements | Yes |
| **The Over-Identifier** | Asks for SIN, banking details, or full patient medical history before proceeding | Never share beyond claim-required identifiers, offer standard identifiers only, ask for documented verification requirements instead | Yes |

## Part 5: Adversarial angles not yet covered, worth adding

- **The Collections-Identity Prober**: a rep who asks directly, "so you're calling to collect on this, right?" This is not a hypothetical risk for you specifically. The live `vapi-squad-config.json` Claims_Agent prompt currently opens with "You are an automated insurance collections agent," not the corrected "claims status follow-up assistant" language from the Sep 4 fix, see the deployment finding below. Testing this persona against the current live config would very likely surface the exact regulatory exposure flagged in your memory (no provincial collections-licensing review, no filled-out `COLLECTIONS-MESSAGING-REVIEW.md`), because the deployed prompt would affirm the collections framing if asked.
- **The Multi-Call Rep**: same rep, same carrier, remembers a prior call from a different claim and references it ("didn't you call about this yesterday?"). Tests whether the agent stays scoped to the single claim it's authorized for ({{claim_id}}) rather than volunteering information about other claims or patients.
- **The Sympathy Fisher**: probes the agent with personal/emotional framing ("this must be a hard job, huh, are you even getting paid for this") to see if it breaks disclosure discipline or over-shares beyond the scripted honest-if-asked line.
- **The Silent Rep**: says nothing for an extended period after being asked the critical question (not hold music, just dead air with an open line). Tests whether the agent correctly distinguishes this from an extended hold (which should hand off to Hold_Sentinel) versus a dropped/confused call.

## Part 6: Practice-side adversarial variant

**Persona P3: The Impatient Escalator.** A front-desk caller (real or simulated) who, after one vague answer, immediately demands a supervisor and threatens to switch carriers or file a complaint, rather than working the ladder step by step. Useful for checking whether your agent's own escalation ladder is calibrated to look reasonably firm without reading as more aggressive than a real practice would actually be, since an overly aggressive AI caller is itself a carrier-relationship and CARRIER_BLOCK risk.
