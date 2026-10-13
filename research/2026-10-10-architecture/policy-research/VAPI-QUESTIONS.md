# Written questions for Vapi

Date: 2026-10-13. Purpose: close the vendor facts that the policy synthesis (SYNTHESIS.md section 9) and the capacity review (CAPACITY-MODEL-REVIEW.md) could not verify. Every answer should be requested in writing (email or signed document), with the person's name, role and date. A dashboard screenshot or a support chat is not enough for a compliance file.

Context to give Vapi: Canadian customer; health-adjacent data (patient name, date of birth, policy and member numbers are passed as call variables); calls to insurers; Anthropic (claude-sonnet-4-5, claude-haiku-4-5), ElevenLabs, and Deepgram nova-2 configured in the squad; recording disabled per call.

Priority 1 questions decide the architecture. Do not build around any reported answer until it is in writing.

## A. Residency and platform structure (priority 1)

| # | Question | What the answer decides |
|---|---|---|
| V1 | Does Vapi offer any Canadian region for compute, storage or logs, or a self-hosted or private-cloud option? If not, is there a dated roadmap? | Whether any claim about Canadian processing is possible; PHIPA s. 50 and Quebec cross-border paperwork |
| V2 | Is HIPAA mode only an organization-level setting? Can one customer hold two organizations under one contract and one invoice, one in HIPAA mode and one not? What plan, minimum term and price apply? | Whether health and commercial workflows need separate Vapi organizations |
| V3 | Are HIPAA mode and Zero Data Retention mutually exclusive? Exactly which artifacts does each one stop storing? | The ZDR versus HIPAA fork |
| V4 | Under ZDR: are transcripts, summaries, structured data from analysisPlan, tool-call payloads, call variables (assistantOverrides variableValues) and call logs stored at all, even transiently? Which of them are still delivered to our webhook in the end-of-call report? | Whether we can keep using analysisPlan outputs or must move outcomes to our own tool calls |
| V5 | Under HIPAA mode without ZDR: retention period for each artifact, and does the delete-call API remove transcripts, logs and backups? How long until deletion is complete? | Retention design and deletion evidence |
| V6 | Does HIPAA or ZDR mode restrict which model, voice and transcription providers can be used? Is claude-sonnet-4-5, claude-haiku-4-5, ElevenLabs and Deepgram nova-2 currently permitted under each mode? | Whether the current squad can run in a health organization unchanged |

## B. Contract and assurance (priority 1)

| # | Question | What the answer decides |
|---|---|---|
| V7 | Will Vapi sign a BAA, and a data processing agreement with Canadian terms (PHIPA agent-equivalent flow-down, PIPEDA accountability, a written agreement of the kind Quebec Law 25 requires for transfers outside Quebec)? Self-serve or enterprise only? Please send the current DPA text. | Blank vendor tracker; Tier 0 gap |
| V8 | Current sub-processor list with locations, how changes are notified, and the right to object | Sub-processor register, PHIPA s. 50 record |
| V9 | Breach notification to the customer: time in hours, contact route, and what the notice contains | Our obligation to notify custodians at first reasonable opportunity |
| V10 | Which contracts cover traffic routed through our account with Anthropic, ElevenLabs, Deepgram and Twilio (if Vapi-provided numbers are used)? Do we bring our own keys? Does Vapi pass Deepgram's model-improvement opt-out, and is Anthropic zero retention in place for Vapi's traffic? | Whether sub-processor assurances exist at all |
| V11 | Written confirmation that audio, transcripts and prompts are not used to train models by Vapi or its sub-processors | PHIPA agent purpose limits |
| V12 | SOC 2 Type II report, ISO 27001 certificate and scope, latest penetration test summary, audit rights | Vendor due diligence checklist |
| V13 | Law-enforcement and foreign-access disclosure policy, and whether customers are notified | Cross-border risk disclosure |
| V14 | Termination: export and deletion timeline with a deletion certificate | Offboarding duty under Quebec s. 18.3 style mandates |
| V15 | Notice period before default models, voices or providers change | Unreviewed provider changes into a regulated chain |

## C. Technical data handling (priority 2)

| # | Question | What the answer decides |
|---|---|---|
| V16 | Where do call variables appear: dashboard, API call objects, request logs, error logs, webhook retries? Can they be suppressed from storage? | Real PHI footprint of Option B in PHI-VAPI-BOUNDARY.md |
| V17 | With recordingEnabled false: is any audio retained, even short-term? Are transcripts still stored? Can transcript storage be turned off while webhook delivery continues? | The "may be recorded" statement and retention |
| V18 | Are webhook (server message) payloads retained by Vapi, for how long, and can retention be disabled? | Transcript exposure outside our database |
| V19 | Voicemail detection: which methods exist, accuracy, and how the result is delivered (answeredBy or equivalent)? | Replacing the prompt-only voicemail rule |
| V20 | After the remote party hangs up, how long until the call ends? Is there a guaranteed bound? | Possible 10 second disconnect rule |
| V21 | What does the recording consent plan do, is it enterprise only, and what exactly does it announce? | Notice design in human-assisted mode |

## D. Telephony (priority 2)

| # | Question | What the answer decides |
|---|---|---|
| V22 | For Vapi-provided numbers and imported Twilio numbers: STIR/SHAKEN attestation level on Canadian outbound calls, caller name display, branded calling support, and any per-number daily call limits | Spam labelling and CARRIER_BLOCK risk; number pool design |
| V23 | Does HIPAA mode cover Canadian numbers and imported Twilio numbers? Is any Twilio-side recording or media streaming active? | Coverage of the telephony leg |

## E. Capacity and reliability (priority 2)

| # | Question | What the answer decides |
|---|---|---|
| V24 | Confirm the concurrency included in our plan and the price per additional line. Is concurrency per organization (so a split halves the pool)? How does the API report remaining capacity? What happens when full: reject or queue? Do inbound and outbound share the pool? Is there an outbound call-start rate limit? | Capacity model inputs; whether two organizations strand capacity |
| V25 | Uptime commitment, incident history, failover behaviour, and the maximum single call duration. Can a call sit on hold for 45 minutes or longer without being cut? | The 45 minute ceiling and nine hour assumptions |
| V26 | All add-ons in writing with minimum terms: HIPAA, ZDR, extra lines, enterprise. Reported figures are $1,000 to $2,000 per month for HIPAA and about $1,000 for ZDR, from sources that disagreed. | Whether a health route is economic at current plan prices |

## How to use the answers

1. File each written answer next to docs/compliance/VENDOR-AGREEMENTS.md with date, name and role.
2. Update SYNTHESIS.md section 9 table; downgrade nothing from UNVERIFIED to VERIFIED on a verbal answer.
3. If V2 shows HIPAA mode is org-level and V3 confirms ZDR exclusivity, plan two organizations before building any health workflow beyond dental.
4. If V1 is no, remove every claim of Canadian processing from product copy, privacy notices and the Quebec impact assessment, and send V7 and V8 to counsel as cross-border questions.
