# Council seat: voice-AI reliability and evaluation engineer

Date: 2026-10-13. Reviewer lens: hallucination, prompt interference, squad handoff, live latency, tool-call reliability, eval design, what is known versus assumed.
Constraints honored: no code changes, no calls, no contact. No em or en dashes.

Evidence labels: CODE (file read in this repo), SOURCE (web, with quality grade), REASONING (premise stated), OPINION.
Source quality grades used: A = primary paper or vendor docs read as excerpt via search; B = secondary summary of a primary source; C = vendor blog or marketing. I did not open any primary page in full. Every SOURCE below came through search excerpts and is therefore at best "excerpt-verified". One regex finding below I did reproduce by running code locally.

## 0. Bottom line

1. The main reliability risks in this system are not prompt length. They are (a) numbers and identifiers passing through ASR then an LLM then a regex, (b) outcomes inferred after the call by a second LLM or a regex, and (c) an eval harness that cannot currently detect either of those. P12 is aimed at the right targets but several of its controls, as the code stands, would pass while protecting nothing.
2. There is no evidence in the repo or in what I found online that the 17.5k character Claims_Agent prompt is hallucinating because it is long. P2 may still be right for other reasons (blast radius, dental regression, ownership). It should not be sold to the founder as a hallucination fix until the experiment in section 4 is run. It is a cheap experiment.
3. A concrete defect found: the reference-number extractor returns the word "number" as a "reference number" on any transcript where the agent asks the mandatory question "Can I get a reference number for this call". Because the financial gate treats any captured reference of 4 or more characters as corroboration, a hallucinated RESOLVED can pass the gate. Details in section 2.2. Fix this before building anything on top of P12.
4. The existing simulator documents cannot be counted as evidence. The repo's own audit says so (section 3).

## 1. Is splitting one big prompt into small per-objective prompts (P2) a hallucination fix?

Verdict on P2: SUPPORT WITH CHANGES. Support the split for non-hallucination reasons. Oppose the claim, if made, that it reduces hallucination as an established fact.

### 1.1 What the code says about the prompt being split

- CODE: Claims_Agent system prompt is 17,542 characters, about 4k to 4.5k tokens by my estimate (REASONING: 4 chars per token). IVR_Navigator 4,308, Hold_Sentinel 1,206, closers 1.5k to 1.9k (vapi-squad-config.json, measured by me; matches ARCHITECTURE-PROPOSAL 15.3).
- CODE: Claims_Agent model is claude-sonnet-4-5-20250929, temperature 0.1; tools are only endCall and verify_payment_amount (vapi-squad-config.json, members[2]). Hold_Sentinel runs claude-haiku-4-5-20251001 at temperature 0. The prompt opens with two stacked "most critical" / "blocking" rules and uses CRITICAL three times.
- CODE: the dental prompt carries variables like practice NPI, tax id, amounts, procedures, claim number inside the prompt body (members[2] system text).
- OPINION: a 4k token prompt is small by current standards. Whatever instruction-density problems exist are unlikely to be at this size for a frontier model.

### 1.2 Published evidence, graded

| Claim | Source | Grade | What it does and does not show |
|---|---|---|---|
| Adherence falls as the NUMBER of simultaneous instructions grows. | IFScale, "How Many Instructions Can LLMs Follow at Once?" arXiv 2507.11538 (Distyl AI, 2025). Excerpt: 500 keyword-inclusion instructions, "even the best frontier models only achieve 68% accuracy at the max density"; decay shapes differ (threshold decay for reasoning models, linear for claude-sonnet-4 and gpt-4.1, exponential for gpt-4o); earlier instructions favoured. | A (excerpt only) | Real, but the task is 10 to 500 keyword-inclusion constraints in report writing. Our prompt has perhaps 50 to 150 behavioral rules and the task is a conversation. Densities where decay starts are far above the likely density here. Extrapolation to a 4k token prompt is weak. It does support "primacy bias": rules at the top win. Our prompt puts the refusal protocol first, so that is consistent with the design. |
| Long context degrades recall, especially mid-context. | Liu et al. "Lost in the Middle" (2023, TACL 2024); Chroma "context rot" report (2025). | B (I reached blog summaries only; the search itself said it did not reach either primary paper) | Mostly retrieval over long documents (10k to 100k+ tokens), not instruction-following in a 4k prompt. Weak transfer. A conversation transcript grows the context during a call; that is a separate and more relevant effect for long holds followed by long rep dialogue, and nobody has measured it here. |
| Decomposing into simpler prompts trades latency for accuracy; routing allows specialized prompts. | Anthropic, "Building effective agents" (prompt chaining and routing sections). | B (excerpt/secondary) | It is design guidance by the vendor, not a measured effect size. It also describes chains of separate calls with programmatic gates, which is different from one call with a shorter prompt. |
| Multi-agent systems fail mostly at inter-agent seams. | Cemri et al., "Why Do Multi-Agent LLM Systems Fail?" (MAST), arXiv 2503.13657; excerpt: 14 failure modes in specification, inter-agent misalignment, and verification/termination; "improvement of 14% on task completion" from role and orchestration fixes, "did not fully resolve the failures". Counts differ across paper versions. | A/B | Argues against equating "more, smaller agents" with "more reliable". Applies to LLM agents talking to each other, which is not exactly a Vapi squad, but the seam failure modes (role disobedience, context loss at reset, not knowing when to stop) map onto handoffs. |
| Generic prompt edits can make an application worse; evaluate each change. | "When Generic Prompt Improvements Hurt: Evaluation-Driven Iteration for LLM Applications" arXiv 2601.22025 | title only (I did not read it) | Mentioned only as a lead; I cannot state its findings. Do not cite it until read. |

Conclusion from sources: there is published evidence that adherence decays with instruction count and that position matters; there is no published evidence I found quantifying a gain from splitting a roughly 4k token phone-agent prompt into several 2k to 3k token ones. Label: the benefit is ASSUMED, not KNOWN.

### 1.3 Reasons the split can make things worse (REASONING)

1. The proposal (ARCHITECTURE-PROPOSAL 7.2) does not actually yield "small prompts". It is a common core plus an appended fragment per objective. Core behaviors (refusal protocol, reference capture, contradiction handling, deadline lock-in, difficult-rep ladder, speaking identifiers, ending the call) are the bulk of the 17.5k prompt, per section 15.3 item 2. So each module prompt is likely 60 to 80 percent the same size as today. P2 as written in the brief ("one small prompt per call objective ... replacing the single prompt") and 7.2 (core plus fragment) are two different designs. Pick one.
2. More copies of the same safety rules means more places to drift. The founder's stated fear is inconsistency. Six prompts means six chances for the refusal protocol to differ. Needs a mechanical rule: the core is one file, hash-checked, never copy-edited.
3. Per-call prompt assembly across squad members is unverified (ARCHITECTURE-PROPOSAL 16.3: full override field list not found). The fallback is one squad per profile, which multiplies squads, each needing sync and tests.
4. Dental is working, with a regression eval that exists. Any new core must reproduce dental behavior. If dental_v1 stays frozen, the "shared core" is not shared with the only module that has volume, so the consistency benefit is zero for the product that earns money.

### 1.4 Reasons to split anyway (OPINION, ranked)

1. Blast radius: a change to restoration wording cannot regress dental. This is true by construction, independent of any LLM effect.
2. Wrong-domain contamination: dental text such as "the balance will be billed to the patient" is wrong for auto/MVA. Removing inapplicable instructions is a plausible hallucination reducer because the model stops importing wrong assumptions. This is the strongest argument and it is about relevance, not length.
3. Ownership and testability: a golden-transcript suite per objective is feasible; one for a 17.5k mega-prompt covering all verticals is not.

### 1.5 Strongest objection and what would change my mind

Strongest objection: the split is justified by an effect nobody has measured here, and the real hallucination sources (numbers, post-call extraction) are untouched by it.
Would change my mind: the section 4 experiment showing the split variant has lower rule-violation or wrong-fact rates by a margin outside run-to-run noise, or evidence from real dental call transcripts of rules being ignored late in long calls.

## 2. P12 hallucination controls: which hold, which are naive, what is missing

Verdict on P12: SUPPORT WITH CHANGES. The list is the right shape. Four of its controls are weaker than they sound and several essential ones are missing.

### 2.1 Control by control

| P12 control | Assessment | Evidence |
|---|---|---|
| Server supplies every number spoken | Direction right, but incomplete as designed. | CODE src/webhooks/vapi.ts lines 349-375 comment: "the model copies amounts, the server owns the math ... round 6 proved the model can mis-copy an amount that is plainly in its prompt". So the team already observed prompt-to-speech copy errors. But the tool still receives statedAmount from the model (what ASR + LLM heard) and returns an instruction the model must speak; the model still voices the result. Server-supplied also cannot cover numbers the rep says, which are the numbers that matter. In the squad config the expected amount, claim number, policy, and NPI are still placed in the prompt for the model to read aloud (members[2] CLAIM DETAILS). |
| Outcomes are tool calls with closed enums including "unclear" | Good idea; current state is the opposite, and the pitfalls are real. | CODE autonomous squad: Claims_Agent has no outcome tool; outcome comes from analysisPlan.structuredDataPlan, a post-call LLM extraction with a 9 value enum (vapi-squad-config.json members[2] analysisPlan) plus regex in src/outcome/processor.ts. Human-assisted squad does have log_call_outcome, but "Strict mode off" (vapi-live/log_call_outcome.schema.md), so the enum is not enforced by the provider; server must validate. |
| Reference numbers read back | Helpful but a weak verifier on its own. | See 2.3. |
| Post-call check that each extracted fact appears in the transcript | Weakest of the list as stated. | See 2.4. |
| Humans confirm money states | Right, and partly built. | CODE src/server/outcomeConfidence.ts: financial-terminal statuses downgrade to ESCALATED unless corroborated. But the corroboration test is naive (2.2). |
| Golden-transcript suite per pack gating releases | Necessary, not sufficient. | Static transcripts test the post-call pipeline, not the live model. See section 3. |
| Model and prompt changes rerun it | Right. Needs a variance rule. | See section 5. |
| Packs versioned; each call records pack version, model, settings | Right. Record more than listed. | See section 5. |

### 2.2 Defect: the reference-number gate can be satisfied by the word "number"

- CODE src/outcome/processor.ts lines 483-495: extractReferenceNumber uses /(?:reference|confirmation|case|ticket)\s+(?:number\s+)?(?:is\s+)?([A-Z0-9]{5,15})/i, and is applied to the full transcript including the AI's own turns (processor.ts line 226 and others use fullText; tests/hallucinationGateGap.test.ts header confirms the transcript "includes the AI agent's own turns").
- CODE src/server/outcomeConfidence.ts: hasFinancialCorroboration returns true for any reference of 4 or more characters, and also returns true whenever hasStructuredPayload is true.
- I reproduced the regex locally on sample strings (not against production data). Results: "Can I get a reference number for this call" returns "number"; "the case manager will call" returns "manager"; "reference number: R 4 8 2 1 3" and "reference number is B as in boy 5521" both return "number". The agent line "reference number REF12345 correct?" followed by the rep saying "no it is REF12346" returns REF12345, the wrong one.
- Why it matters: the Claims_Agent prompt mandates the utterance "Can I get a reference number for this call, and your name?" after every status. So on nearly every call the regex has a chance to return "number" before it reaches a real reference. The existing test (tests/hallucinationGateGap.test.ts) passes only because its sample transcripts do not contain that sentence.
- Consequence: a financial-terminal outcome inferred by regex can pass the gate with a junk reference. Severity: high. It is the control P12 relies on.
- Also CODE: "structured payload" corroboration (webhookOutcomeResolver.ts, extractCollectrxStructured requires only schemaVersion 1) is treated as high trust, but if that payload comes from the model's own end-of-call analysis it is the same model asserting its own claim. It is corroboration of format, not of fact.
- Test tied to the failing case is cheap: add a transcript containing the standard ask and a hallucinated summary, expect ESCALATED. I did not change code per ground rules.

### 2.3 Read-back confirmation: what it can and cannot do

- SOURCE (C, vendor blogs via search): Speechmatics reports a baseline ASR at 96.6 percent word-level accuracy but 77 percent exact match on full identifiers; AssemblyAI recommends tracking a Missed Entity Rate because WER hides entity errors; Soniox argues alphanumerics remove the language-model context that normally corrects errors; Deepgram cites 43 to 58 percent accuracy on structured alphanumeric sequences from "independent research" with no link. Treat the numbers as vendor-asserted, not established, but the direction (identifiers are far worse than words) is consistent across vendors and is well known in practice.
- SOURCE (B): PSTN is 8 kHz narrowband, which degrades ASR further. The transcriber here is Deepgram nova-2, language en (CODE vapi-squad-config.json). Canadian French IVR menus (CLAUDE.md mentions a French-first TELUS menu) are not covered by language "en".
- What read-back catches: a transposition the agent heard wrongly, if the rep corrects it.
- What it misses (REASONING):
  1. Acquiescence: reps say "yes" to a fast read-back to move on. A wrong value read quickly is often confirmed.
  2. Common-mode error: if ASR hears "B" as "P" the agent reads "P", and the rep's "yes" is not proof the agent's written value is right unless the confirmation is itself recorded and tied to the stored value.
  3. The read-back is generated by the same LLM from the same ASR text, so it does not detect a transcription error, only whether the rep objects.
  4. Cost: time on the line, rep annoyance, and a longer call against maxDurationSeconds 480 for Claims_Agent.
  5. Amounts and dates (the money fields) are not "reference numbers"; P12 only names reference numbers.
- Better design (OPINION, all cheap): (a) agent reads digits in chunks and asks for letters by phonetic words; (b) store `readback_attempted`, `readback_confirmed_by_rep`, and the rep's confirming utterance as structured fields; (c) value status is `confirmed`, `heard_unconfirmed`, or `conflict`; only `confirmed` can drive an automated action; (d) money fields get read back as words ("one thousand eight hundred twenty dollars") and not just digits; (e) second ASR pass over the recording on identifier spans, flag disagreement. (e) is independent evidence for roughly the price of a transcription call.

### 2.4 "Each extracted fact appears in the transcript": weaknesses

1. Same-source problem: the transcript is the ASR output. The extractor and the verifier both read it, so an ASR error is verified as true. The check proves consistency with the transcript, not truth.
2. Speaker attribution: the repo already says this is open (hallucinationGateGap.test.ts header: "STILL OPEN ... speaker-attributed extraction"). Digits the agent said appear in the transcript regardless of whether the rep said them.
3. Matching is weaker than meaning: "$1,820" in the transcript does not show it is the approved amount rather than the billed amount, a different claim, or a negation ("we did not pay 1,820"). Substring and entity-presence checks pass all of these.
4. Normalization: spoken "one eight two zero", "eighteen twenty", "1820" and "eighteen hundred twenty" all mean the same; a naive string check fails true facts or passes near-misses. Dates ("next Friday", "end of the month") need the call date.
5. Paraphrase fields (callSummary, shortfallReason, unresolvedFields) cannot be substring checked and are exactly where fabricated narrative lives. Nothing in the P12 list covers free text. The log_call_outcome schema has several free text fields (vapi-live/log_call_outcome.schema.md).
6. SOURCE (B/C): LLM judges used as a second check carry measurable position and self-preference bias (e.g., "Judging the Judges", arXiv 2406.07791, excerpt: position bias varies by judge and task; MT-Bench original: GPT-4 judge over 80 percent agreement with humans, comparable to human-human). A same-family model grading its own family's output is a weak independent check.
- Better (OPINION): require each extracted value to carry an evidence span (turn index, speaker, quote), validate the span exists in a rep turn, and run per-field type checks (amount parse, date parse, regex for known reference formats per payer when known). Ban free-text facts from driving state. Compare to a second ASR for identifier and amount spans. Sample 5 to 10 percent of "clean" calls for human audio review, not just flagged ones, because the system's false-confident calls are the costly ones.

### 2.5 Closed-enum pitfalls

1. "unclear" becomes a sink if the model is rewarded for finishing. Measure the unclear rate per pack and per model; a rate near zero is as suspicious as a rate near one.
2. Enum fit: reality is multi-label (claim received AND denied AND needs document). The existing 10 value Scribe enum and 9 value autonomous enum already differ (two enums for the same business concept; CODE humanAssistedOutcomeResolver.ts SCENARIO_MAP vs analysisPlan enum). Adding W1 to W6 packs risks six more.
3. Enum drift: adding values breaks old call records unless schemaVersion is stored with each call (the proposal's envelope has schemaVersion).
4. Strict mode off: CODE/SEEN, the provider will not reject off-enum values. The server must reject and log them.
5. Enum + free text hybrid (outcome plus callSummary) lets the free text contradict the enum. Validate cross-field consistency (e.g., CLAIM_PAID requires an amount or reference).
6. Choosing the outcome late: a tool called at the end of the call under time pressure collects a sloppier answer than one logged at each fact. Prefer incremental fact tools (record_reference, record_amount, record_deadline) plus a final summary, so evidence is time-stamped inside the call.

### 2.6 What P12 is missing (ranked)

1. Fix the extractor and gate flaws in 2.2 first.
2. Speaker-attributed, evidence-span extraction (2.4).
3. Independent second signal on money and identifiers (second ASR, or human audio).
4. Production monitoring of drift: unclear rate, read-back conflict rate, human-override rate, ASR disagreement rate, outcome distribution by model version. The existing MONITORING-SPEC.md is about CARRIER_BLOCK and escalations, not fact accuracy (and sits in a directory the repo marks as unverified).
5. A per-pack kill switch and shadow mode: new packs run on human-assisted calls with the AI predicting an outcome silently; compare with the human-confirmed outcome. This yields accuracy numbers without autonomy risk (supports P11).
6. Prompt-injection and role-confusion hygiene: reps and IVRs say things to the agent. Low probability, but the model should never obey instructions in rep speech about disclosing data or changing outcome codes. Not in P12.
7. Latency budget (section 6) and barge-in behavior.
8. Voicemail leakage control: server checks that voicemail audio contains no identifiers; testable.

## 3. What a credible eval harness needs, and what exists

### 3.1 What exists (CODE)

- src/services/analytics/conversation-robustness-eval.ts (987 lines) and scripts/run-conversation-robustness-eval.ts. Loads the live Claims_Agent system prompt from vapi-squad-config.json, runs scripted rep lines against the same model and temperature, then a second model (claude-sonnet-4-6, temperature 0) judges. Guarded by ANTHROPIC_API_KEY and COLLECTRX_ANTHROPIC_EVAL=1; not part of npm test.
- Scenario library S001 to S042 inside that file (per the repo's own audit note), plus SCENARIO-MASTER.csv.
- Deterministic tests: hallucinationGateGap.test.ts, vapiToolCalls.test.ts, vapiToolCallsClaimAmount.test.ts, vapiSquadConfig.test.ts, syncVapiSquad*.test.ts, missedHandoff.test.ts, vapiNormalizer.test.ts, carrierBlock*.test.ts.
- A bot-vs-bot harness in the live Vapi account (TEST_RBC_IVR_Simulator and "Sarah", per the audit note in RUN-LOG-2026-07-10-COMPLETE.md) that the audit says is real and unrelated to the invalidated docs.

### 3.2 What the existing eval cannot detect (CODE and REASONING)

1. Reps are scripted and not reactive: repTurns are fixed lines fed in order regardless of what the agent just said (simulateConversation loop). A real rep reacts. It tests "does the agent produce a safe reply to this line", not a dialogue.
2. Text only: no ASR, no TTS, no latency, no interruption, no silence. The numbers, names, and reference formats that fail in production are exactly the audio-dependent ones.
3. No tools: the sim calls the model with only system prompt and messages (callAnthropic), so verify_payment_amount is never invoked and tool-call arguments are never tested.
4. No handoffs: it tests Claims_Agent in isolation; Hold_Sentinel, IVR_Navigator, closers are not exercised, nor the context each receives.
5. Judge is a single LLM sample at temperature 0, pass is three booleans, never validated against human labels. Rubric still says "dental insurance carriers" and "CLM-EVAL-0001 / SL-9988776".
6. Single run per scenario: no repeated trials, so it cannot separate a real regression from sampling noise. SOURCE (A): tau-bench (arXiv 2406.12045) excerpt: even agents with decent pass^1 were inconsistent; GPT-4o pass^8 in retail was below 25 percent (the secondary source reported a drop of around 60 percent from pass^1 to pass^8). That is general agent evidence, not telephony, but the lesson (measure consistency over k trials, not one pass) transfers.
7. Header comment says production uses claude-haiku-4-5 at 0.2 (lines 14 to 15) but the squad config says Claims_Agent is claude-sonnet-4-5-20250929 at 0.1. The code reads the model from the config (getClaimsAgentPrompt), so the run is probably right and the comment is stale. Minor, but a stale model description in an eval is how a wrong model gets tested. Also the agent under test is Sonnet 4.5 and the judge is Sonnet 4.6, a close family relative.
8. Outcome extraction (the structuredDataPlan step) and the regex classifier are not part of the robustness eval at all.

### 3.3 Standing of the simulator docs

- CODE/DOC: the head of RUN-LOG-2026-07-10-COMPLETE.md carries the repo's own warning: "INVALID, UNVERIFIED CLAIMS, DO NOT TRUST". It reports two sign-off scripts that do not exist, test counts inflated up to 2.7 times, and a production rollout that never happened. I counted nothing from that file as evidence.
- DOC: SHADOW-CALL-VALIDATION-PROTOCOL-2026-09-05.md is explicit that R001 to R010 "pass" reflects static pre-authored transcripts graded against a rubric, and that live-LLM Phase 2 and live IVR Phase 3 were never executed against anything live. It is status PROPOSED, not executed.
- ARCHITECTURE-PROPOSAL 15.3 item 5 says the author "did not assess how complete that harness is". So P5's "passing test suite" and P12's "golden-transcript suite" currently have a test runner but almost no validated content for non-dental objectives.

### 3.4 What a credible harness has (OPINION, tiered by cost)

Layer A, deterministic, free, run on every commit:
- Extractor and gate unit tests with adversarial transcripts (the "number" bug, agent-spoken references, negations, wrong-claim amounts, numeral forms, French fragments).
- Tool schema contract tests: every tool, strict mode behavior, off-enum rejection, argument coercion, replays of real payload shapes.
- Squad config invariants: prompt hash of the shared core identical across packs, every handoff target exists, no PHI in metadata, model pin present.

Layer B, text-level LLM simulation, cheap (cents per run):
- Reactive simulated rep (an LLM playing a rep with a hidden fact sheet: true status, true reference, true amount) so the "ground truth" is known and the score is objective: did the agent's final logged facts equal the hidden facts. This removes the judge for fact accuracy. Use the judge only for behavior rules, and validate it on 50 human-labeled transcripts first.
- Tool calls wired (stub tool server returning the production verify result).
- k trials per scenario (k at least 5), report pass rate with an interval, and gate on the lower bound, not one run.
- Fault injection into the transcript channel: replace digits with plausible ASR confusions (B/P, 15/50, 13/30) so the agent receives noisy text as it would on a real line.

Layer C, audio level, moderate (staging only, own phones or a simulated IVR):
- TTS rep audio into the real Vapi pipeline to measure ASR entity accuracy, handoff timing, silence behavior, and latency. The live account already has a bot-vs-bot harness; extend it, not rebuild.
- SOURCE (A/B): tau-Voice (arXiv 2603.13686; excerpt via ICML 2026 poster page) reports voice agents far below text performance and further down under noise and accents (excerpt: 29 to 42 percent clean, 19 to 30 percent noisy for voice agents versus 80 percent for a text reasoning model; other pages gave different numbers, so these are inconsistent across snapshots). Takeaway: text-only evals overstate voice reliability by a large margin; do not take text-level pass rates as a forecast of call accuracy.

Layer D, production shadow:
- Human-assisted calls double as labeled data. The Scribe logs what the rep said and the human confirms the outcome; compare to the AI's predicted outcome. This is the only layer that measures truth on real carriers and it comes free with P11.

Golden transcripts: keep them, but label what they test (classifier and gate regression), and add both real transcripts (after PHI redaction) and synthetic ones for each pack. A pack passes only if it passes A, B at k trials, and has at least a minimum shadow count in D.

## 4. The experiment that settles mega-prompt versus split-prompt

Goal: measure whether, for the same model and tools, splitting changes wrong-fact rate and rule-violation rate beyond noise. Cost: low; text-level only; no calls.

Design:
1. Arms. A: the current dental Claims_Agent prompt (17.5k) as is. B: a "length-matched irrelevant" control, i.e. A with dental-only sections removed, applied to a dental scenario set (tests length, not relevance). C: the proposed split (core + dental fragment). D (optional): a deliberately bloated mega-prompt with W1 to W6 scenarios concatenated (the true "mega-prompt" the founder fears), applied to the same set. Without D you are only comparing two modest prompts.
2. Scenario set. 40 to 60 scenarios, half dental and half cross-domain (restoration, MVA), each defined by a hidden fact sheet so the correct answer is known, plus 10 behavior-rule probes (denies being automated when asked, settlement pressure, wrong-claim question, refusal-to-disconnect protocol). Include the rep-says-different-amount and rep-gives-ambiguous-reference cases.
3. Simulated rep: reactive LLM with the hidden facts, a different model family from the agent, with a noise injector for digits.
4. Metrics, all objective where possible: (a) final-fact accuracy against the hidden sheet (reference, amount, date, status); (b) fabricated-fact rate (a value logged that the rep never said); (c) rule-violation count by a deterministic check where feasible and a validated judge otherwise; (d) tool-call correctness; (e) turns to completion.
5. Repeat each scenario at least 10 times per arm with the production temperature. Use a paired design (same scenario and seeds per arm) and compare with a bootstrap interval on the difference.
6. Pre-register the decision rule before running: for example, split is adopted as a reliability measure only if (b) falls by at least 30 percent relative with the interval excluding zero; otherwise adopt for blast-radius reasons only and say so.
7. Size estimate (REASONING): 50 scenarios x 4 arms x 10 trials = 2,000 conversations, each about 8 turns of ~4.5k token prompt plus short replies. At current API list prices that is a few tens of dollars with prompt caching; I have not priced it against a live rate card. Run time well under a day.

What it cannot settle: audio behavior and real-rep variety. Follow with a Layer C check of the winning arm on the staging IVR sim and a Layer D shadow run.

OPINION: I expect arms A and C to be close on fabricated-fact rate and D to be visibly worse on cross-domain scenarios, because wrong-domain assumptions leak in. If so, the real win of P2 is relevance, not length, and the right structure is "core + one fragment", not "many tiny prompts".

## 5. Model and prompt change control

Current pins (CODE vapi-squad-config.json): Anthropic dated snapshots (claude-sonnet-4-5-20250929, claude-haiku-4-5-20251001), temperatures 0 to 0.1, Deepgram nova-2, ElevenLabs voice. Dated pins are good. But:

1. Record more than "pack version, model, settings" (P12). Add: Vapi assistant/squad version or hash actually used, transcriber model and language, voice id and settings, tool schema version, server webhook code version, and the exact rendered prompt hash. Vapi can change provider-side behavior or fall back; the call record is your only evidence later. SOURCE (A): Vapi docs note `fullMessageHistoryEnabled` in ArtifactPlan retains complete message history even after handoff context engineering; enable it so logs show what each member saw versus what was sent.
2. Change classes: (i) prompt text, (ii) model snapshot, (iii) transcriber/voice, (iv) tool schema, (v) pack data (policy values). Each class has a required rerun. A model snapshot bump reruns everything; policy data only reruns the pack's deterministic layer.
3. Rollout gates: shadow (A/B on replayed transcripts) then canary on human-assisted calls only for new model on a single pack, then autonomous only after the k-trial lower bound and shadow accuracy meet pre-set thresholds. Automatic rollback on drift triggers (unclear rate, conflict rate, override rate).
4. Variance rule: same prompt, same model, run the suite twice a week; the observed spread defines the noise floor. A change is a regression only if it exceeds that floor.
5. Deprecation clock: pinned snapshots retire. Keep a calendar of provider deprecation dates per pinned model; migrating under deadline is when un-gated changes slip in. (OPINION; I did not look up the current deprecation schedule.)
6. Do not upgrade the judge model silently with the agent model; pin it and re-validate on the human-labeled set when it changes.

## 6. Handoff between squad members: consistency and latency

### 6.1 What the code shows

- CODE vapi-squad-config.json: five members chained by assistantDestinations. IVR_Navigator can hand to Claims_Agent on first human speech or to Hold_Sentinel on hold; Hold_Sentinel hands only to Claims_Agent; Claims_Agent hands to Escalation_Closer (radiographic or clinical documentation only) or Resolution_Closer. Closers have no further destinations.
- CODE: handoff messages are spoken to the other party: "Connecting you now." and "I'm connecting you with our escalation team to handle the documentation request." Wording like "escalation team" spoken to a carrier rep is a style choice that could read oddly or prompt a rep reaction; each handoff message is a chance for an unscripted rep response with no handler.
- CODE: Hold_Sentinel decides "live human versus recorded" using a haiku-class model at temperature 0, on text transcripts; its rule is "If uncertain, wait for one more utterance". It also tells the model to end the call after "approximately 25 minutes" of silent hold. REASONING: an LLM has no clock; it only knows elapsed time if the platform provides it. Vapi's maxDurationSeconds (1800 on Hold_Sentinel) is the real backstop; the in-prompt 25 minute timer is probably unreliable. Whether Vapi injects time into context is unverified here.
- CODE: Claims_Agent speaks first on entry ("Thank you for taking my call. I am an automated calling system on behalf of ..."). If Hold_Sentinel misclassifies a hold recording as human, the disclosure is delivered to a recording and an attempt is consumed. If it misses a human, the rep hears silence ("hello?") and may hang up, which feeds CARRIER_BLOCK logic. These two errors have different costs; nobody has measured either rate.
- CODE (ARCHITECTURE-PROPOSAL 16.2): Claims_Scribe's first message is "Hello." even though its prompt forbids speaking; transitions to Claims_Scribe are dropped by holdTransitionProcessor ALLOWED_AGENTS. Both are known and flagged.

### 6.2 What Vapi documents (SOURCE A, excerpts via search of docs.vapi.ai/squads/handoff)

- Each destination can set a contextEngineeringPlan (default passes the full conversation history; options include last N messages and user/assistant-only that drop system messages, tool calls, and tool results).
- A variableExtractionPlan can extract structured data before the handoff. A "Passing data between assistants" page compares three mechanisms with trade-offs in latency and hallucination risk. I did not read it in full, so I cannot report its conclusions.
- I did not find documentation on firstMessage behavior for squad members at handoff, matching the unknowns the proposal lists.

### 6.3 Consistency risks (REASONING, all testable)

1. Fact transfer by chat history only: the Claims_Agent instructs "hand off to Resolution_Closer with outcome UNCLEAR, including any reference/name captured" in prose. The closer re-derives the facts from history; any ASR error or mis-summary propagates, and a closer could contradict the agent. Prefer structured variables extracted by the server, or a tool call that stores facts and a closer that reads them from the server, not from conversation.
2. Different models per member (Haiku for Hold_Sentinel, Sonnet for others) means different failure profiles at each seam; model upgrades must be tested per member and per seam.
3. Persona and wording drift: each member has its own voice/style instructions; the rep hears a change in cadence or phrasing mid-call, which can read as automation (relevant to CARRIER_BLOCK sensitivity).
4. Duplicate or contradictory disclosure: the agent that speaks first does the disclosure; a handoff back and forth could repeat or omit it. A server-recorded "disclosure delivered" event is what the disclosure-proof item in P10 needs, and it should be a tool event at the moment spoken, not inferred from the transcript.
5. Latency at the seam: every handoff adds a new model's time to first token and any tool round trips. Closers speak first, which hides silence but also makes the agent talk over a rep who is mid-sentence. No latency measurement exists in the repo for handoffs (ARCHITECTURE-PROPOSAL 16.3 notes the events carry no per-member timing). Add timestamps before judging.
6. Tool timeout: log_call_outcome and request_staff_handoff use a 20 second tool timeout (SEEN, vapi-live). A 20 second silent wait on a live call with a rep present is long; for verify_payment_amount the synchronous server round trip also includes a DB lookup (CODE vapi.ts lines 349-440). Measure p95.
7. Squad-per-profile (P1/P2 fallback) multiplies the seams that must be tested.

### 6.4 Handoff verdict

The MAST evidence (SOURCE A/B above) suggests seams, not individual agents, concentrate failures. OPINION: fewer seams with deterministic state transfer is more reliable than more members. Consider whether Resolution_Closer and Escalation_Closer need to be separate LLM members at all; the confirmation they do could be a tool-driven step inside the rep-facing agent. That is an alternative worth the same experiment as section 4.

## 7. Verdicts on the numbered propositions (voice-AI lens only)

The brief asks for P1 to P13; several are outside my lens, so I mark CANNOT JUDGE where the question is about data modeling or business policy.

| # | Verdict | Strongest objection | Evidence | Would change my mind |
|---|---|---|---|---|
| P1 shared call engine | SUPPORT WITH CHANGES | The "shared engine" includes outcome logging and handoff, which today are dental-shaped and partly unreliable (two different outcome enums, regex extractor defect). Sharing a flawed engine spreads the flaw. | CODE processor.ts 483-495; CODE two enums (analysisPlan vs SCENARIO_MAP) | Fix 2.2 and unify the outcome envelope; then a shared engine is the safer bet. |
| P2 per-objective prompts | SUPPORT WITH CHANGES | Hallucination benefit unmeasured; "small" prompts are core+fragment, not small; per-call assembly unverified. | Section 1 | Section 4 experiment results. |
| P3 placement test | CANNOT JUDGE (architecture) | OPINION: for prompts, add a rule: shared rules live in exactly one file, and a behavior is shared only if its eval passes in two modules. | n/a | n/a |
| P4 typed attributes | CANNOT JUDGE | n/a. Voice note: the same validation schema should be the tool schema the model calls, so there is one source of truth. | n/a | n/a |
| P5 module contract | SUPPORT WITH CHANGES | "A passing test suite" is vacuous unless the suite's content is specified; today's suite does not test audio, tools, or handoffs. Define the minimum: Layer A, Layer B at k trials, shadow N calls. | Section 3 | A written minimum eval spec per pack. |
| P6 cap of eight entities | CANNOT JUDGE | n/a | n/a | n/a |
| P7 retirement rule | CANNOT JUDGE; voice note: retire on low volume only after verifying low volume is not caused by a poor pack (high unclear rate, many human takeovers). | REASONING | n/a | n/a |
| P8 cuts | SUPPORT; add one non-cut: fact-level evidence capture and the second-signal check are cheap and belong early. Customer-facing QA scoring is rightly cut but INTERNAL QA sampling should stay. | OPINION | n/a | n/a |
| P9 W1 first | SUPPORT WITH CHANGES | W1 reuses IVR navigation, hold, and reps, so it reuses the most plumbing and also the same ASR weak spots (member ids, claim numbers). Run the section 4 experiment on W1 before launch. | Section 2.3 | n/a |
| P10 build order | SUPPORT WITH CHANGES | Add to defect fixes: the reference-number extractor and gate corroboration flaw (2.2), the Scribe first message, hold-transition tracking for the Scribe, and the Scribe transfer audio test (ARCHITECTURE-PROPOSAL 16.2). The Scribe audio question gates the V1 learning loop, so it should be item one. | CODE; ARCHITECTURE-PROPOSAL 16.2 | n/a |
| P11 human-assisted first | SUPPORT | Strongest in the proposition: it produces labeled ground truth for Layer D. Make the AI shadow-predict the outcome so accuracy is measured, not just logged. Define graduation thresholds before launch, with an interval on the accuracy estimate (small n gives wide intervals). | Section 3.4 | n/a |
| P12 hallucination controls | SUPPORT WITH CHANGES | Several controls are naive as designed or defective in code; see section 2. | Section 2 | Implemented second signal and fixed extractor. |
| P13 scoped knowledge | CANNOT JUDGE (legal/privacy). Voice note: shared playbooks injected into prompts are another prompt-growth path; scope filters must apply before prompt assembly, and eval should include a leakage probe (tenant A fact absent from tenant B calls). | REASONING | n/a | n/a |

## 8. Issues the brief missed (ranked by severity)

1. Reference-number extractor returns "number" or "manager" and feeds the financial gate; agent-spoken text counts as rep evidence (section 2.2). Verified by reproducing the regex.
2. Structured-payload corroboration is the model corroborating itself (outcomeConfidence.ts hasStructuredPayload shortcut). A hallucinated summary with a schema-valid payload passes.
3. No test or eval touches ASR, tools, or handoffs; the only reactive end-to-end checks are in the live Vapi account and unscripted in the repo. A "golden transcript passes" gate would give false assurance for the failure modes that matter (section 3).
4. Two diverging outcome vocabularies (Scribe 10 values, autonomous 9 values, plus internal CallOutcome and ClaimStatus sets) with provider-side strict mode off. P12 needs one outcome envelope validated server-side.
5. Hold_Sentinel misclassification has no measured rate; one error type delivers disclosure to a recording, the other produces silence that can trigger a CARRIER_BLOCK (section 6.1). And its 25 minute rule depends on a clock the model may not have.
6. French and accent coverage: transcriber language is "en" for all members while carrier IVRs can be French-first; entity accuracy under accents is the lowest-performing condition in the voice benchmark excerpts (SOURCE A/B).
7. Free-text fields (callSummary, shortfallReason, unresolvedFields) are unvalidated narrative and are the likeliest home of fabricated detail; nothing in P12 covers them.
8. Eval hygiene: stale model comment, judge from the same family and unvalidated, single sample, healthcare-only rubric text. And invalid sim documentation still in the tree can be mistaken for evidence by a new reader; a header warning exists, but the file name does not signal it.
9. Provider drift: no capture of the effective Vapi/transcriber/voice versions per call.
10. Data minimization (already noted in 16.2 item 4): patient name and DOB are injected into every squad's variables even where unused. Voice-specific side: anything in variables is in the model context and therefore can be spoken or logged by the model. Allowlist per pack is a reliability control as well as a privacy one.

## 9. Over-engineered versus under-engineered (voice lens)

Over-engineered for the evidence:
- Six packs and per-profile squads before the first non-dental call exists. One non-dental pack (W1) plus the dental one is enough to learn whether a shared core is possible.
- A rich nested outcome envelope (statements, commitments, blockers, callbacks, flags) for week one. Start with the smallest field set that drives an action, with evidence spans.

Under-engineered:
- Evaluation of facts, audio, and tools. Biggest gap in the whole proposal for a product whose value is "the number we report is true".
- Monitoring of accuracy drift in production.
- State transfer across handoffs (chat history is the transport).
- Disclosure proof as a tool event.
- Human-review UX that shows the audio snippet and rep quote beside a proposed money state, to resist rubber-stamping (REASONING: reviewers who see only a summary approve it).

## 10. Concrete alternative design for the weakest proposition (P12's verification step)

Replace "post-call check that each extracted fact appears in the transcript" with an evidence-ledger design:

1. During the call, facts are recorded by incremental tool calls (record_reference, record_amount, record_date, record_status), each carrying value, speaker, a verbatim quote, and an `heard_or_readback` flag. The server stamps time and turn index.
2. After the call, the server validates: quote exists in a REP turn at the stated index; value parses from the quote under per-field rules (amount, date, known reference pattern); cross-field consistency (a paid status needs an amount or reference).
3. Identifier and amount spans are re-transcribed from the recording with a second ASR; a mismatch downgrades the value to `heard_unconfirmed`.
4. Read-back is recorded as a field and a value is `confirmed` only when the rep's confirming utterance is quoted.
5. Only `confirmed` values and enum outcomes that pass 2 can create automated actions; everything else becomes a human task that shows the audio clip.
6. A weekly sample of auto-accepted calls gets human audio review to estimate the false-accept rate; the number is published internally and is the release gate for graduating a pack.

This reuses outcomeConfidence's existing "downgrade to ESCALATED" mechanism, so it extends rather than replaces what is built.

## 11. Known versus assumed (summary table)

| Statement | Status |
|---|---|
| The 17.5k dental prompt causes hallucinations because of its length | ASSUMED; no evidence either way |
| Splitting reduces hallucination | ASSUMED; cheap to test (section 4) |
| Wrong-domain content causes wrong-domain mistakes | PLAUSIBLE (REASONING); testable |
| The reference extractor returns non-references | KNOWN (reproduced locally; production frequency unknown) |
| Model can mis-copy a prompt amount | KNOWN per repo comment (round 6), prior test data not reviewed |
| ASR error rate on identifiers over the carrier phone line with nova-2 | UNKNOWN for this system; vendor numbers only |
| Hold_Sentinel false positive/negative rates | UNKNOWN |
| Scribe hears the staff-rep conversation after transfer | UNKNOWN (flagged in 16.2) |
| Per-call prompt override across squad members | UNKNOWN (16.3) |
| Existing sim docs show production readiness | FALSE per the repo's own audit |
| Handoff latency per member | UNKNOWN; no timing data |

## 12. Source list

- IFScale, arXiv 2507.11538, https://arxiv.org/abs/2507.11538 (excerpt via search)
- Lost in the Middle / context rot, secondary summaries only, e.g. https://www.zeroentropy.dev/concepts/context-rot/ (primary papers not reached)
- tau-bench, https://arxiv.org/pdf/2406.12045 ; tau-Voice, https://icml.cc/virtual/2026/poster/66590 and https://arxiv.org/html/2603.13686v1 (excerpts; conflicting numbers across pages)
- Why Do Multi-Agent LLM Systems Fail?, https://arxiv.org/html/2503.13657v3 (excerpts; counts differ between versions)
- ASR entity accuracy: https://www.speechmatics.com/company/articles-and-news/alphanumeric-speech-recognition-why-voice-assistants-mangle-skus-and-how-to-fix-it , https://soniox.com/wiki/alphanumeric-transcription , https://www.assemblyai.com/blog/voice-agent-accuracy-problem-benchmarks (vendor sources, grade C)
- Vapi squads handoff docs, https://docs.vapi.ai/squads/handoff/context-and-variables , https://docs.vapi.ai/squads/passing-data-between-assistants (excerpts)
- LLM judge bias, https://arxiv.org/html/2406.07791v9 (excerpt)
- Anthropic, Building effective agents, https://www.anthropic.com/research/building-effective-agents (excerpt)
- Prompt-iteration lead (unread): https://arxiv.org/pdf/2601.22025

Repo files read: research/2026-10-10-architecture/ARCHITECTURE-PROPOSAL.md (7.x, 15.x, 16.x), vapi-live/*, Collect-RX-main/vapi-squad-config.json, src/server/outcomeConfidence.ts, src/outcome/processor.ts, src/outcome/webhookOutcomeResolver.ts, src/webhooks/vapi.ts (lines 345-440), src/services/analytics/conversation-robustness-eval.ts, scripts/run-conversation-robustness-eval.ts, tests/hallucinationGateGap.test.ts, voice-agent-sim/* (README, MONITORING-SPEC, RUN-LOG), voice-agent-sim/SHADOW-CALL-VALIDATION-PROTOCOL-2026-09-05.md.
