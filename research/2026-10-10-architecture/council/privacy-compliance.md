# Council review: privacy and regulatory compliance lens (2026-10-13)

Reviewer stance: engineer with Canadian health privacy, CRTC and call-recording exposure. Not a lawyer. Every point marked COUNSEL needs a lawyer before it is relied on externally.

Evidence labels: CODE (file and line read in this session), SOURCE (URL and quote), REASONING (premise stated), OPINION. Confidence is stated where it matters.

Scope note: I read the brief, the proposal sections 3.5, 5.9 to 5.11, 7.5 to 7.7, 16, 17.6, EVIDENCE-BACKED-FEATURES.md, primary-source-read-2026-10-11.md, vapi-live/, all of Collect-RX-main/docs/compliance/ that bears on this (crtc-disclosure-decision, PHI-VAPI-BOUNDARY, REGULATORY-LANES, HIA-Alberta-Clause, carrier-tos-research, PHIPA-MANUAL-PROCESS-RUNBOOK, LEGAL-REVIEW-PROMPT), and the code listed below. I did not call anyone.

---

## 0. Headline findings (read this if nothing else)

1. **The PHIPA agent problem is not hypothetical. It is already in the shipping dental code, and P13 as written does not fix it.** `synthesizeCarrierProfile` pulls `HumanAssistedCallLog` rows by `carrierId` only (no `practiceId` filter), sends their free-text `callSummary` from many practices together to an external model, and writes a carrier-level profile that every tenant reads. CODE: `Collect-RX-main/src/server/learning/humanAssistedProfiles.ts` lines 82 to 135 (query at the `findMany` with `where: { carrierId, processedForProfileAt: null }`, no practice filter). The legal prompt for the customer agreement says "CollectRx owns software and anonymized analytics" (CODE: `docs/compliance/LEGAL-REVIEW-PROMPT.md` line 85), which is a statement of the agent's own purpose. Both facts argue against agent status as defined.
2. **Human-assisted mode does not meet the repo's own disclosure decision, and the decision never covered it.** The decision requires a recording/transcription notice "at the start of the live-representative interaction" (CODE: `docs/compliance/crtc-disclosure-decision.md`, Sequencing requirement). In the human-assisted path nothing delivers it, and the Scribe's first message is "Hello." (SEEN, proposal 16.2.1). The Scribe prompt also instructs the model to flag moments when the rep suspects automation (CODE: `vapi-live/claims-scribe.prompt.md`, "suspect automation is on the line"; schema field `automationSuspicionFlag`, `prisma/schema.prisma` line 2381). A product feature that logs the counterpart's suspicion that it is being listened to by a machine is the wrong direction for a consent-based posture.
3. **Expansion removes a real control: the destination allowlist.** `initiateCall` refuses any number not in `CARRIER_PHONE_MAP` (CODE: `src/vapi/client.ts` around lines 352 to 360). Adjusters, restoration payers and WSIB contacts are not a closed set of six switchboard numbers. Once routes come from imports or learned calls, a misdial or a poisoned route sends identity data to the wrong person. This is not in the brief.
4. **Learned text is injected into other tenants' prompts.** `known_resubmission_channel` and `carrier_ivr_instructions` come from a global, last-writer-wins table filled from rep speech (CODE: `queueEngine.ts` lines 914 to 923; `client.ts` lines 447 to 450; schema `CarrierSubmissionChannel` `@@unique([carrierId, channelType])` at line 2248). A rep, or a bad transcription, can steer another tenant's documents to a chosen fax number. That is a disclosure vector, not just a quality bug.
5. **"PHI is never stored" is stronger than the code supports.** The transcript scrubber redacts dates, 6 to 15 digit runs, and labelled fields. It has no name or address pattern (CODE: `src/server/vapi/vapiWebhook.ts` lines 40 to 50). Spoken patient names, injuries, addresses and plates survive into `CallTranscriptLine.text` and the model-written `callSummary`. CLAUDE.md's "PHI is never stored in logs or the database" does not hold for transcripts. Extending to vehicle, property and employer identifiers makes this worse.

---

## 1. P1 to P13 verdicts

### P1. One shared call engine with workflow modules
**Verdict: SUPPORT WITH CHANGES (compliance lens only).**
- For: one engine means one place for disclosure, vault, audit and the CARRIER_BLOCK stop. REASONING: a control that must hold on every call is cheaper to prove once. The compliance case for a shared core is strong.
- Strongest objection: "shared" is also where cross-tenant leakage lives. The shared engine is today the thing that pools knowledge (CODE: findings 1 and 4 above). Sharing plumbing is fine; sharing learned data by default is the risk. The core must own tenant isolation of learned data, not only of records.
- Change: put "knowledge ingestion" behind the same kind of gate as dispatch. No module and no job reads or writes cross-tenant knowledge except through one audited function.
- What would change my mind: a design where the engine itself enforces purpose tags on every stored datum.

### P2. One small prompt per objective; dental_v1 frozen
**Verdict: SUPPORT.**
- For (compliance): small prompts are reviewable. A 17.5k character prompt cannot be meaningfully diffed by counsel. Frozen dental_v1 preserves the thing counsel and any carrier relations contact already saw. REASONING.
- Objection: freezing preserves existing defects. dental_v1 carries the disclosure wording "recorded for quality purposes" (CODE: `vapi-squad-config.json` line 226) while recording is disabled (`artifactPlan.recordingEnabled: false`, `client.ts` line 403) and what actually happens is transcription by a speech vendor, transcript storage, and use for playbook learning. The notice understates purposes (PIPEDA identifying-purposes principle, COUNSEL, medium confidence). Freeze the logic, not the sentence: disclosure text must stay an editable, versioned, separately approved string.
- Change: each pack's first utterance is a tested artifact (already in 17.6 design change 4). Add that the text is stored with the call (see missed issue 6).

### P3. Placement test (core only if dental AND one other need it)
**Verdict: SUPPORT WITH CHANGES.**
- Objection: the test is driven by reuse, but compliance controls must be core even if only one module needs them today. Example: a consent-record or recording-notice mechanism needed by "human-assisted" is currently a dental-only, in fact not-yet-built, need. By P3 it would sit in a module, then be re-implemented per module with drift.
- Change: add a second rule. Anything that touches identity data, disclosure, retention, or cross-tenant data is core by default regardless of how many modules use it. P3 governs features, not safeguards.

### P4. Typed validated attribute fields (JSON schema per module), not tables per vertical
**Verdict: SUPPORT WITH CHANGES.**
- Compliance cost: JSON attributes hide identifiers from every generic control. A retention job, a deletion job, a DSAR extract and a log scrubber each have to know which keys inside a blob are personal. CODE evidence of the failure mode: the deletion path lists tables explicitly (`dataRetentionJob.ts` `purgeClaim` lines 56 to 70; runbook step 4), and already misses `HumanAssistedCallLog` (claimId is a plain nullable string, not a relation, schema line 2361) and `CarrierLesson`/`HumanAssistedCarrierProfile`. A JSON blob is the same problem, hidden.
- Change: every JSON schema field carries a mandatory `sensitivity` and `retention` annotation, and a CI test fails if a field lacks them. Deletion and export iterate over the schema registry, not over table names. This is cheap and makes P4 acceptable.

### P5. Module contract (no changes to dispatch, vault, call engine)
**Verdict: SUPPORT WITH CHANGES.**
- For: the "may not change dispatch, vault or engine" clause is exactly what lets compliance review the core once. 
- Gaps: the contract lists no privacy items. Add as required deliverables: (a) field allowlist per call member (see section 4), (b) inbound extraction allowlist, (c) first-utterance text and its test, (d) retention class per stored field, (e) statement of which tenant types are health custodians, (f) list of third parties that see module data, (g) counterpart types (switchboard, named individual, mobile) and their route verification level. A module without these fails the contract.
- See section 6 for how this answers the "review once vs every time" question.

### P6. Cap of about eight core entities
**Verdict: CANNOT JUDGE on compliance grounds; one OPINION.**
- OPINION: an entity count is not a safety measure. A single "case" entity with a free-form attribute bag can be worse for privacy than three small typed tables. Judge by "does every field have a sensitivity class", not by count.

### P7. Retirement rule for unused modules
**Verdict: SUPPORT WITH CHANGES.**
- Compliance gain: a dead module with live data is a liability. Add that retirement includes data disposition: purge or return of module data and of any knowledge derived from it, with a test. Today there is no such path (manual runbook only; CODE `PHIPA-MANUAL-PROCESS-RUNBOOK.md`, which states `PHIPADeletionRequest`/`PHIPABreachNotification` are schema with no implementation behind them).

### P8. Cut list
**Verdict: SUPPORT, with one objection on what is cut.**
- The cut of "customer-facing QA scoring" is fine. The cut of "party-roles table (use fields)" interacts badly with sensitive data: adjusters, claimants, property owners, lienholders are individuals. Storing them as loose fields on a case means no uniform place to apply access, retention or deletion. I would keep a minimal `counterpart` record (name, role, contact, source, verification, scope) because counterpart personal information is the thing most likely to be promoted across tenants by accident (finding 4). If the founder insists on fields, apply the sensitivity registry (P4 change).
- Not cut but should be: nothing from the privacy side is on the cut list. Good.

### P9. First non-dental module is W1 (extended-health claim status for rehab and hearing)
**Verdict: OPPOSE as stated, for privacy reasons; SUPPORT the idea of a low-surprise first module.**
- Strongest objection: W1 for rehab and hearing is a health-custodian customer (regulated clinicians), the same legal class as dental, so it extends the existing unresolved PHIPA agent exposure instead of testing the core on a different legal regime. It also has the highest sensitivity (injury and treatment content). REASONING.
- The more informative first module for "is the core shaped right" from a compliance angle is one where the tenant is not a custodian (restoration payee/receipt capture, W4) because it exercises the PIPEDA-only path and the "tenant type" switch in P13. But I recognize W4 has weaker plumbing reuse (OPINION; the author's reuse argument is not something I am refuting).
- Condition if W1 stays first: do not launch W1 until the dental PHIPA purpose issue is resolved by counsel, because a second custodian vertical copies the exposure. What would change my mind: counsel confirms the dental arrangement is sound.

### P10. Build order
**Verdict: SUPPORT WITH CHANGES.**
- "Disclosure proof" is in item 1 already, which is right. But "buyer-gate compliance items" is placed after defect fixes and before human-assisted tests, and the human-assisted tests are the ones that put a silent transcriber on live third-party calls. Two items must precede any new human-assisted test, not follow:
  1. The recording/transcription notice for the staff path, and the Scribe first-message fix (proposal 16.2.1, WP-0b).
  2. The dial-destination control for non-carrier numbers (finding 3).
- Also move up: stop cross-tenant ingestion for custodian tenants now (a config change, not a redesign): filter `synthesizeCarrierProfile` and `getKnownSubmissionChannel` by tenant or disable them for custodian practices. That is days of work and closes the largest present exposure.

### P11. Every module launches human-assisted, graduates on measured criteria
**Verdict: SUPPORT WITH CHANGES.**
- "Human-assisted as the discovery instrument" is the proposal's learning loop (7.6) and so the main PHIPA-purpose risk (section 2) and the main consent risk (section 3). Calling it a discovery instrument names the purpose as CollectRx's own learning, which cuts against agent status. The purpose should be stated as "performing the follow-up for this tenant" with learning scoped to that tenant; cross-tenant learning is a separate, opt-in, de-identified path.
- Graduation criteria must include a compliance criterion: disclosure-verified rate, zero identity-allowlist violations in N calls, zero misroutes.

### P12. Hallucination controls
**Verdict: SUPPORT.**
- Compliance relevance: server-supplied numbers, closed-enum outcomes and "extracted fact must appear in transcript" are also minimization controls. Add: the post-call check should also reject extracted values outside the inbound allowlist (e.g. a diagnosis or a third party's personal details the model summarized).
- Objection: "each call records pack version, model and settings" is good evidence for counsel and regulators; it needs to include the exact disclosure string spoken (missed issue 6).

### P13. Scoped shared knowledge; health-custodian tenants default tenant-only
**Verdict: SUPPORT WITH CHANGES (the direction is right; it is under-specified and partly mis-aimed).** See section 2.

---

## 2. PHIPA agent status: do P13 and the module design preserve it?

### 2.1 The text
SOURCE (fetched 2026-10-13, https://www.ontario.ca/laws/statute/04p03, high confidence, verbatim): "“agent”, in relation to a health information custodian, means a person that, with the authorization of the custodian, acts for or on behalf of the custodian in respect of personal health information for the purposes of the custodian, and not the agent’s own purposes, whether or not the agent has the authority to bind the custodian, whether or not the agent is employed by the custodian and whether or not the agent is being remunerated;"

SOURCE (same page, s. 17(1)): a custodian "may permit the custodian’s agents to collect, use, disclose, retain or dispose of personal health information on the custodian’s behalf only if, (a) the custodian is permitted or required to ... (b) the collection, use, disclosure, retention or disposal of the information ... is necessary in the course of the agent’s duties and is not contrary to this Act or another law".

SOURCE (same page, s. 11.2(1)): "no person shall use or attempt to use information that has been de-identified to identify an individual, either alone or with other information, unless this Act or another Act permits".

Two readings matter. Reading A (narrow): any use of PHI by CollectRx for CollectRx's benefit takes that use outside agency, so CollectRx is, for that use, an unauthorized recipient. Reading B (broader): once purposes are mixed, CollectRx may not be an "agent" at all, which would undo the custodian's ability to disclose to it under agency rules. Which reading a regulator takes is COUNSEL. My confidence that Reading A is at least a live risk: medium-high. My confidence in Reading B: low to medium.

### 2.2 What the present code does (CODE)
- Cross-tenant synthesis: `humanAssistedProfiles.ts` `synthesizeCarrierProfile` reads call logs by carrier only and passes `callSummary` free text from multiple practices in one prompt to an external model API. The only output filter rejects 6+ digit runs, ISO dates and `$` amounts (`containsIdentifierLikeContent`). Names, clinics, injuries, procedure descriptions in prose pass the filter.
- Global channel memory: `CarrierSubmissionChannel` unique on carrier and channel type; read for every tenant at dispatch (`queueEngine.ts` 914 to 923).
- `CarrierLesson`: "the lesson content itself is tenant-free" (schema comment line 2208) but `observation` is free text produced from calls.
- Contract posture: "CollectRx owns ... anonymized analytics" (`LEGAL-REVIEW-PROMPT.md` line 85). That is a stated own purpose.
- The Alberta clause says CollectRx processes health information "on behalf of practices" and uses it only as authorized (`HIA-Alberta-Clause.md` section 2). The cross-tenant learning is not described in it. Inconsistent with the stated position.

### 2.3 Does P13 fix it?
Partly.
- Good: tenant-only default for custodian tenants removes the mixing of custodians' content in one prompt and in one shared row.
- Insufficient, five ways:
  1. **Scope is not purpose.** The statutory test is whose purposes the use serves, not who can read the row. A tenant-scoped profile is fine (it improves that custodian's own follow-up). A platform-scoped profile built from tenant data serves CollectRx's product. The proposal conflates "scope_kind" with "purpose". The `scope_kind` field should be accompanied by a `purpose` and an `authorized_by` on every knowledge write.
  2. **The act of de-identifying and aggregating is itself a use of PHI.** Even if the promoted fact is clean ("carrier X asks for a narrative on crown claims"), producing it required reading call content tied to a patient file. Whether the custodian can authorize an agent to do that for the agent's product (rather than the custodian's) is COUNSEL. Proposal 17.6 design change 2(b) covers the output but not the processing step.
  3. **Non-custodian tenants.** P13 defaults only custodians to tenant-only. Restoration and collision tenants are not under PHIPA (REASONING; they are commercial organizations under PIPEDA in Ontario, COUNSEL to confirm each type). But PIPEDA has its own limiting-use-to-identified-purposes and accountability for third-party processing principles. Pooling their claimants' and property owners' call content by default is still a consent and purpose issue (COUNSEL). A rehab clinic that bills auto insurers is a custodian; a collision shop is not; one tenant record needs a legal-class attribute that someone sets and someone can be wrong about. Default must be "tenant-only for everyone", with platform promotion as an explicit, contractual opt-in.
  4. **Free text is the leak.** The leaks are in `callSummary`, `observation`, `recommendation`, transcript lines. A filter on digits does not remove health content. The cross-tenant boundary should pass only closed-enum or structured facts (for example: carrier, department, documentation type enum, channel type enum, hold-time bucket), never prose derived from a call.
  5. **Derived data survives deletion.** Deleting a patient or tenant does not delete their contribution to a shared profile. CODE: `purgeClaim` and the runbook list do not include `HumanAssistedCallLog` or profile tables. If the custodian ends the relationship, the agent retaining derived content "for its own purposes" is exactly the posture the definition excludes.

### 2.4 Does the module design preserve or damage it?
- Neutral by itself. Modules are mostly about workflow. The damage comes from the "human-assisted as discovery instrument" step (P11/7.6) applied to every new module, because each module then becomes another cross-tenant learning pipe unless the same gate sits in the core.
- New damage: the module contract's "outcome-to-action rules" and "policy values (data)" are cross-tenant by nature if one platform pack serves all tenants. A pack that is tuned from tenant data (windows, typical blockers, "the correct route") quietly turns tenant data into platform configuration. Require that platform packs are authored by CollectRx staff from non-tenant sources (public rules, carrier documents), and that data-derived changes are proposed to a tenant-scoped overlay first.

### 2.5 Recommended fix (concrete)
1. Immediately: filter synthesis and channel memory by `practiceId` for health-custodian tenants (or disable). No schema change needed for the stopgap. Priority: highest present exposure.
2. Add to every knowledge write: `purpose` (enum: `tenant_operation`, `platform_improvement`), `scope_kind`, `authorized_by` (contract id and clause version), `derivation` (structured, or free-text from call).
3. Allow `platform_improvement` only for structured-enum facts, only when the tenant's agreement authorizes it, only after an N-tenant threshold (the proposal already says N), and with no free text.
4. Delete path: knowledge rows carry source tenant ids (hashed) so tenant exit can remove or recompute contributions. Where a fact has N contributors it can remain only if it falls below identifiability (COUNSEL).
5. Change the customer-agreement language: the "owns anonymized analytics" clause must be reviewed by counsel against the agent definition before more custodians sign.

Evidence note: I checked the statute text directly. I did not read any Information and Privacy Commissioner decision on service-provider "own purposes" and recommend counsel look for one. Confidence that no helpful decision exists: unknown.

---

## 3. Human-assisted mode with a silent transcribing assistant

### 3.1 What the repo itself requires (CODE)
`docs/compliance/crtc-disclosure-decision.md`: the opening human-facing disclosure must identify the automated nature, the practice, a callback number; "Sequencing requirement: automation, practice identity, claims-status purpose, callback information, and recording/transcription notice must be delivered at the start of the live-representative interaction." The table of agents covers IVR_Navigator, Claims_Agent, Escalation_Closer, Resolution_Closer. It does not cover Hold_Sentinel in human-assisted mode, Claims_Scribe, or the transfer to staff.

`vapi-squad-config.json` `Claims_Agent.firstMessage` carries the disclosure (line 226). Hold_Sentinel and IVR_Navigator have empty first messages and wait (lines 8 to 9, 187 to 188). The human-assisted squad is not in the repo; its Claims_Scribe is SEEN as first message "Hello." with a prompt that forbids speaking (proposal 16.2.1; `vapi-live/claims-scribe.prompt.md`).

### 3.2 Gap analysis
| Point | Finding | Label |
|---|---|---|
| Notice to the rep of automation/transcription in human-assisted mode | Not delivered anywhere in the code or prompts I read. The disclosure lives in the Claims_Agent first message, which the human-assisted squad does not contain. Proposal 3.5 and EVIDENCE list "human-assisted mode gives no recording notice" as an internal defect. | CODE + proposal |
| The unplanned "Hello." | If spoken by a synthetic voice at the moment the rep answers, it is an automated utterance with no identification, which is the thing the disclosure decision forbids. Also, what the rep hears between answer and staff pickup (silence) looks like an automated dialer pattern. | SEEN + REASONING |
| Is it an ADAD call? | CRTC definition read: "any automatic equipment incorporating the capability of storing or producing telecommunications numbers" (SOURCE: primary-source-read file, excerpt tool, low to medium confidence on completeness). The call is placed by software. Whether a call that is automated to the point of answer and then handed to a human is within the definition is COUNSEL. Part IV s. 4(d) "clear message identifying the person on whose behalf" (partial excerpt). The conservative product control is the right posture; it is simply not applied to this path. | SOURCE + COUNSEL |
| Applicability to business lines | Part II (DNCL) does not apply to a telemarketing call to a business consumer; nothing found about Part IV for business calls (SOURCE: same file). Notice 2026-132 (June 2026) mentions artificial voice; outcome unknown. | SOURCE, confidence low |
| Transcription of the rep by a third-party speech service and an LLM, with the rep unaware | Collection of the rep's words and name. A rep's name is likely "business contact information", which PIPEDA's definition treats outside "personal information" when used to communicate about employment role (medium confidence, COUNSEL). The rep's statements about a claim are about the patient, not the rep. The issue is less statutory than relational: carriers can restrict recording of their staff, and the disclosure decision's own wording promises a recording notice. | REASONING + COUNSEL |
| Criminal Code interception (s. 184) | One-party consent is the general rule: a staff member who is a party to the call can consent. Whether an automated listener acting for that staff member qualifies, and whether the rep must be told for other statutes, is COUNSEL. I could not fetch the Criminal Code page (connection reset), so this is from memory, confidence medium. | REASONING, not verified |
| Honesty of "recorded for quality purposes" | Recording is off (`client.ts` line 403) but transcripts are stored and mined; "quality" understates. | CODE + REASONING |
| Rep suspicion flag | `automationSuspicionFlag` stores when the rep suspects automation. Operationally useful to detect blocks; as a persistent field it documents that the counterpart did not know. | CODE (schema line 2381) |

### 3.3 Verdict
Human-assisted mode with a silent transcribing assistant is **not demonstrably compliant with the repo's own decision as built**. Whether it is lawful is a separate question for counsel. It can be made consistent cheaply:
1. A one-line spoken notice at answer, before transfer to staff: automated assistant, on behalf of the practice, call transcribed, callback number. Delivered by the first assistant that speaks to a human, not by staff. Or script the staff greeting and have the system verify it appears in the transcript (the proposal already has a "disclosure proof" item).
2. Clear or silence the Scribe first message and test with the founder's own phones (already WP-0b).
3. Offer a no-transcribe path: if the rep objects, staff presses a key and the assistant stops transcribing and logs only "declined".
4. Remove or reword `automationSuspicionFlag` into a neutral `rep_asked_about_automation` event used only for CARRIER_BLOCK detection, not for learning.
5. Make the disclosure text a versioned, stored string per call.

### 3.4 Calls to individuals
The disclosure decision and carrier-tos research assume a corporate provider line. The new modules call adjusters, payees, restoration contacts, WSIB staff. Some will be individuals on direct lines or mobiles. The "business line" reasoning does not automatically extend. COUNSEL for each counterpart class; engineering default: treat any non-switchboard route as higher risk and require human-assisted mode plus disclosure.

---

## 4. Per-objective field allowlists (identity minimization)

### 4.1 Verdict: necessary, not sufficient, and enforceable only if pushed further
SUPPORT the direction. The present state is worse than the proposal admits: the same `variableValues` block (patient name, DOB, subscriber name and DOB, practice tax id, address) goes into `assistantOverrides` and is applied to every squad member (CODE: `client.ts` 397 to 450, including the comment "Everything call-scoped must ride in assistantOverrides, which Vapi applies to every squad member"). Hold_Sentinel and Claims_Scribe get DOB they never use (proposal 16.2.4).

### 4.2 Why a pack-level allowlist is not enough
1. **Granularity.** The squad shares one variable set. An allowlist per objective still gives the same fields to IVR_Navigator (needs policy number, NPI), Claims_Agent (needs name, DOB) and Scribe (needs only token). Allowlist must be per squad member. Verify that Vapi can scope variables per member; the proposal says per-member overrides are "unverified" (16.3). If not possible, split into separate member-specific variable names and give each prompt only its names, accepting that the values still exist in the call object (the model provider processes the full payload? unknown, COUNSEL/technical check).
2. **Availability is not use.** A variable in the prompt is sent to the model provider for the whole call even if never spoken. The lint test in 5.10 proves what was sent, not what was said or what the rep was told. Disclosure to the counterpart is governed by the prompt, which is advisory (the proposal says so itself in 7.5).
3. **Authority is not identity.** An auto insurer or WSIB may refuse to discuss a claimant file without a signed direction. The allowlist limits our data; it does not prove the caller may receive information. The `authorization_grants` idea is the correct piece; make the dispatch refuse without it (already in 17.6).
4. **Inbound side is unbounded.** Reps volunteer diagnoses, litigation status, injury details, other parties. The Scribe extraction list in its prompt is broad, the log schema has free text `callSummary`, `unresolvedFields`, `appealRights` (CODE: schema lines 2366 to 2384). Add an inbound allowlist (closed fields), reject out-of-list content at the tool endpoint, and keep full free-text summaries tenant-only with a short retention.
5. **Transcript scrubbing is pattern-based and dental-shaped.** It will not catch VINs, plates, property addresses, employer names (CODE: `vapiWebhook.ts` 40 to 50). Extending patterns per bundle (5.10) helps but regex over names and addresses is unreliable. Fail-safe is not to persist raw transcript text for sensitive bundle kinds beyond a short window, and to store structured results.
6. **Deepgram transcribes everything**, including the IVR and rep audio, regardless of allowlists (CODE: `vapi-squad-config.json` lines 35 to 37).

### 4.3 Concrete stronger design: late-bound identifiers (the "reveal on request" tool)
Keep identifiers out of the prompt. The prompt only knows field names. When the rep asks "date of birth?", the agent calls `reveal_identifier(field)`; the server checks the pack allowlist, the capability grant and a per-call count, logs the reveal, and returns the value for that turn only. Benefits: minimization by use, not by availability; per-call audit of what was actually disclosed; the Scribe and Hold_Sentinel never receive values. Costs: tool latency (20 s tool timeout, SEEN in proposal 16.1), the value still passes through the model provider when returned, and DTMF entry in IVR needs the value earlier (a server-side DTMF tool that sends the digits without the model seeing them would be better; feasibility unverified). Label: OPINION on tradeoff, design is original to this review. Worth a spike on one pack before generalizing.

---

## 5. Third-party data flows and implications

Known path (CODE: `vapi-squad-config.json`, `client.ts`, `humanAssistedProfiles.ts`):

| Hop | What flows | Notes |
|---|---|---|
| CollectRx to Vapi | Full ephemeral variables (names, DOBs, policy, claim, amounts, procedures, practice tax id, address, NPI) to all squad members | Option B decision. BAA/DPA with Vapi "pending" (CODE: `PHI-VAPI-BOUNDARY.md`, unchecked boxes, "BAA execution pending"). Transcript retention in writing "to confirm". Status today unknown. |
| Vapi to model provider | Prompts with variables; live conversation | Squad models are Anthropic Sonnet 4.5 and Haiku 4.5 per config (lines 11 to 12, 190 to 191, 229 to 230). Whether Vapi routes to Anthropic directly or through another cloud, region and retention terms: unknown. |
| Vapi to speech vendor | Raw call audio of IVR, rep and staff | Deepgram nova-2 (lines 35 to 37). Not listed in `PHI-VAPI-BOUNDARY.md` as a hop at all. A named subprocessor gap. Training-use terms: unknown. |
| Vapi to voice vendor | Agent text spoken | ElevenLabs voice in Claims_Agent (line 30). Any identifier the agent speaks (name, DOB, claim number) is sent to the TTS vendor. Not listed in the boundary decision. |
| Vapi to Twilio | Audio in transit, caller id, numbers | BAA/DPA with Twilio pending (same doc). Twilio recording: `recordingEnabled: false` is at the Vapi layer; Twilio-side recording/logging settings unknown. |
| CollectRx to Anthropic (direct API) | `callSummary` and other fields for profile synthesis, cross-tenant | Uses `LLM_RESIDENCY_HEADERS` `X-Data-Residency: Canada-Central` and `X-Processing-Region: ca-central-1` (CODE: `src/services/pii-vault.js` lines 40 to 43, comment says vendor-dependent). I could not confirm that Anthropic's API honours those headers. REASONING and prior knowledge: these are not documented as standard API controls, so they may be a no-op. Confidence low; verify before telling customers about Canadian processing. |
| Storage | Fly.io Postgres in Toronto (CODE: `HIA-Alberta-Clause.md` section 5) | Fine for residency. Vapi, Deepgram, ElevenLabs, model providers are probably not in Canada. |

Implications:
1. **Custodian must be able to name every subprocessor** and the customer agreement must flow down purposes and breach notice to each (EVIDENCE Tier A "signed service provider agreement ... subcontractor terms"). Today the list is incomplete (speech and voice vendors missing from the decision record). Missing from `LEGAL-REVIEW-PROMPT.md` subprocessor list too (it names Vapi, Twilio, SendGrid, Stripe, Fly.io).
2. **Cross-border.** If any hop leaves Canada, the dental promise "Canadian" must be qualified. PHIPA has no explicit residency ban per one source cited in EVIDENCE (secondary, not verified by me). Alberta and Quebec differ (HIA clause, Law 25 PIA exist in repo). Quebec: any expansion beyond Ontario triggers Law 25 transfer impact assessment (CODE: `Quebec-Law25-PIA.md` exists; not re-reviewed).
3. **New module data raises the stakes at every hop.** Injury details, addresses with loss dates, employer names flow through all of the above if they are in the prompt or spoken. This is why late-bound identifiers (section 4.3) and short-lived raw transcripts matter more than for dental.
4. **The Scribe is the weakest link for minimization**: it speaks nothing and needs only the token, yet receives everything (proposal 16.2.8, CODE).
5. **Sub-processor changes as a gate.** Because P12 versions model and settings per call, add vendor identity (STT, TTS, LLM, region) to the recorded call settings. That gives an auditable answer to "which subprocessors saw this call".

---

## 6. Vehicle, property and employer identifiers

### 6.1 What they are
VIN, licence plate, property address plus loss date, WSIB claim number, employer name and injury detail. The proposal's default (5.10): "Treat ... as sensitive by default ... same protections as health identity." I agree with the default. Reasoning on why:
- They are personal information about an identifiable individual in nearly every combination (plate or VIN plus owner or claim; address plus loss date). Legal class (PHIPA, PIPEDA, provincial) is COUNSEL (proposal marks [X]).
- They are "linkable". A VIN plus collision date plus shop is enough to identify a person to anyone who can read a licence or insurance database.
- Employer plus injury detail plus WSIB claim number reveals work injury, which is health-related. This is among the most sensitive of the new identifiers.

### 6.2 New risks
1. **Scrubber blind spot** (section 4.2.5). Highest immediate gap.
2. **Mixed legal classes in one tenant.** A clinic (custodian) that also bills MVA insurers, with claimant vehicle and loss details. The PHI vault would hold health identity and vehicle identity side by side with a single tenant-level setting. P13's "health-custodian tenants default tenant-only" is a tenant attribute; some data in a custodian tenant (the vehicle plate) is not PHI, and some data in a non-custodian tenant (a collision shop's claimant injury note) arguably is health information held by a non-custodian. Class should attach to the data bundle, not only the tenant.
3. **Third-party individuals' data.** Property owners, tenants displaced in emergency housing, vehicle owners who are not the shop's customer. They never dealt with CollectRx, so consent and notice rely on the tenant. COUNSEL.
4. **Vulnerable-person content.** Emergency housing implies displaced individuals; the forced-handoff list (lawyer, minor, deceased, threat) is good (7.5). Add "vulnerable circumstance" and "represented by counsel" as stops for all packs.
5. **Public-law edges.** Towing/storage and liens: the regime is statutory (TSSEA, RSLA, per the primary-source file) and a wrong statement to an owner is a liability. This is mostly a legal accuracy problem, but any call that touches the owner (not the insurer) is a consumer-protection and ADAD question. Keep staff-only (as 17.6 correction 5 says).
6. **Retention and deletion.** Statutory retention (Construction Act, liens, WSIB) vs privacy deletion obligations will conflict. Retention class per field (P4 change).
7. **Breach impact.** A breach now exposes plates, addresses and employment injuries across industries; notification duties differ per regime (PHIPA custodian-facing 14 days in the repo's runbook is the repo's own interpretation, marked as not counsel reviewed; verify; PIPEDA breach reporting is "as soon as feasible" for real risk of significant harm, my recollection, not fetched today, confidence medium).

---

## 7. New compliance surface per module and whether review is once or every time

### 7.1 Surface per module (my read of the proposal's modules)
| Module | Counterpart | Regime/legal edges | New privacy surface |
|---|---|---|---|
| W1 claims line (rehab, hearing) | extended-health carrier lines | PHIPA (custodian tenants), carrier ToS | Same as dental, plus injury and device content; extends PHIPA agent exposure. Low new engineering, high reuse of unresolved issue. |
| W2 MVA invoice trace | auto insurer adjusters (individuals), HCAI | SABS direction to pay (s. 48(2)(c), SOURCE primary-source file), FSRA guidance, PHIPA custodians | Direction to pay as authorization evidence; adjuster as named individual; mobile and direct lines; claim details with injury context. |
| W3 government programs | WSIB, ADP, VAC, CDCP-type programs | Program rules, WSIB confidentiality | Government counterpart policies on third-party callers; likely portal-only; PHI to government; authority via signed forms. |
| W4 restoration | adjusters, payees | Construction Act (prompt payment), commercial | Property address plus loss date; homeowner data; PIPEDA only; non-custodian pooling default. |
| W5 collision/tow/storage | insurers, owners, storage yards | TSSEA, RSLA, privacy of vehicle owners | VIN/plate; calls near disputes and litigation (court cases cited in EVIDENCE); staff-only legal edges. |
| W6 preauthorization | payers | Payer rules; for hearing, "payer says its portal is easiest" (EVIDENCE Tier C) | Pre-treatment clinical content, not just billing: highest sensitivity per call. EVIDENCE already says no evidence of need. |

### 7.2 Does the module design allow "review the core once, modules incrementally"?
**Partly. It could, if the contract is extended; as written it does not guarantee it.**
- What supports incremental review: P5's rule that a module may not change dispatch, vault or engine; typed fields with schema; small prompts; versioned packs with golden transcripts (P12). REASONING: these give counsel a discrete artifact (the pack) to read.
- What forces re-review of the core each time (current gaps):
  1. Learning/knowledge ingestion is not named as core-only. A module that writes knowledge or promotes channels changes the PHIPA purpose analysis for every tenant. Make knowledge ingestion a core function with a closed interface.
  2. Disclosure differs by counterpart class (switchboard, individual, government). If the disclosure text and the rule for when it must be spoken are per pack, each pack needs legal review for the CRTC/automated-call question. Put disclosure rules in the core by counterpart class; packs only select a class.
  3. Third-party list can change per module (a new STT, a new LLM for cost). Core must record vendor identities per call and the module may not add a data recipient without a core change.
  4. Tenant legal class and data-bundle class (section 6.2.2) must be core attributes, not module attributes.
  5. The mode function (7.7) and capability grants (7.5) are in core, good; but "pack maxMode" being module data means a module can request autonomous mode. Gate graduation on a core-owned, compliance-signed criterion.
- Proposed review structure (OPINION):
  - **Core review (once, then on change):** disclosure engine and sequencing, vault and bundles, allowlist mechanism, retention/deletion framework, knowledge ingestion gate, audit, subprocessor register, CARRIER_BLOCK and destination controls.
  - **Module review (per module, incremental):** a one-page privacy sheet filled from the contract in P5 (field allowlists, inbound allowlist, retention classes, counterpart classes, legal edges, stop triggers) plus counsel check of any statute-specific text spoken. Expect counsel hours per module, not a full audit.
  - **Triggers for a core re-review:** a new data bundle kind, a new subprocessor, any cross-tenant knowledge feature, any change to mode gating, any new counterpart class.

---

## 8. Issues the brief missed (ranked by severity)

1. **Cross-tenant learning and global channel memory are live today in dental** and affect PHIPA agent status and misdirected-disclosure risk (findings 1 and 4). CODE. Severity: high, present now. Fix first.
2. **Human-assisted path lacks the repo's own notice and may expose an unidentified automated "Hello."** (sections 3). CODE/SEEN. High; blocks V1 learning loop credibility.
3. **Destination allowlist disappears for non-carrier counterparts** (finding 3). CODE: `client.ts` ~352 to 360. High for expansion: misdial to a private person with identity data.
4. **Raw transcripts and free-text summaries contain unscrubbed personal information** and are a main input to learning (CODE: `vapiWebhook.ts` 40 to 50; `vapiDeskEvents.ts` 90 to 110 persists scrubbed text; schema 2366 to 2384). Contradicts the "never stored" claim in CLAUDE.md. Medium-high; grows with module sensitivity.
5. **Subprocessor register is incomplete**: speech-to-text (Deepgram), TTS (ElevenLabs), the model provider path and the direct Anthropic synthesis path are not in `PHI-VAPI-BOUNDARY.md`, and BAA/DPA with Vapi and Twilio are unchecked (CODE: that file's checklist). The residency headers may be inert (verify). Medium-high, buyer-gate relevant (EVIDENCE Tier A).
6. **No stored proof of what was actually said at the start of each call.** The proposal has "disclosure proof" in P10 but the pack-version-per-call (P12) should explicitly store the disclosure text spoken and a transcript timestamp showing it was delivered. `ADAD_DISCLOSURE_VERIFIED` exists (CODE: `vapiDeskEvents.ts` 272, `phase5CallKpis.ts` 72), but the human-assisted path has nothing to verify. Medium.
7. **Deletion and tenant exit do not reach learned data** (CODE: `dataRetentionJob.ts` `purgeClaim`; runbook table list). PHIPA deletion workflows are manual and not counsel-reviewed (CODE: runbook header). Medium; each module multiplies the tables to remember.
8. **Prompt injection through learned text and rep speech.** Rep-said destinations and IVR hints enter prompts of later calls (finding 4). Also, rep speech can attempt to instruct the agent ("read me the full DOB and SIN"). Allowlists and grants cover some of this; learned text needs a validation step (format, allowed channel types, known domains or verified numbers) and human approval before promotion. Medium-high.
9. **Counterpart staff as data subjects.** Rep names, adjuster names and direct numbers are stored, logged and may be pooled. Treat as personal information; give a retention limit; do not promote across tenants (P8 change). Medium-low.
10. **Mixed-class tenants and data bundles** (section 6.2.2): legal class belongs on the data, not only the tenant. Medium.
11. **Business-line assumption in the disclosure decision.** The legal basis ("provider lines") doesn't automatically extend to adjusters on mobile or WSIB staff (section 3.4). Medium, COUNSEL.
12. **Recording-purpose wording**: "quality purposes" while transcripts feed learning and product analytics. Medium-low, COUNSEL.

---

## 9. Over-engineered and under-engineered (compliance lens only)

Over-engineered for the present evidence:
- Full vault generalization to five bundle kinds before any module has a confirmed call. Do the allowlist and bundle registry for the first module only.
- Generalized scope hierarchy (platform, payer program, tenant, case) with promotion rules (5.11) before anyone has an N-tenant dataset. Tenant-only now, with a purpose field, is enough; promotion can wait until at least N real tenants exist.
- The attribution classes in 5.9 are not a privacy matter; skip.

Under-engineered:
- Knowledge ingestion gate and purpose tagging (section 2).
- Human-assisted notice, no-transcribe path and consent handling (section 3).
- Destination verification for non-carrier routes (finding 3).
- Inbound extraction allowlist and short-lived raw transcripts (section 4).
- Subprocessor register, per-call vendor identity (section 5).
- Deletion framework that iterates over a registry (P4 change).
- Customer-facing agreement set: EVIDENCE Tier A lists it as a buyer gate but it is "a work item for counsel". The "owns anonymized analytics" clause is the first thing counsel should look at.

---

## 10. Concrete alternative for the weakest proposition (P13)

Replace "scoped shared knowledge with tenant-only default for custodians" with a **purpose-tagged knowledge ledger**:

1. Two stores, never joined by default:
   - `tenant_knowledge` (everything learned from a tenant's calls; readable only by that tenant's calls; includes free text; short retention; deleted with the tenant).
   - `platform_knowledge` (structured only: enums, buckets, verified public destinations; written only by a core job; each row records contributing tenant count, rule version, approver).
2. One-way, narrow bridge: a core job proposes `platform_knowledge` entries from `tenant_knowledge` only when (a) the tenant agreement authorizes `platform_improvement` for that tenant, (b) fields are structured, (c) at least N distinct authorized tenants confirm, (d) human approval, (e) counsel has signed off on the mechanism once.
3. Default for all tenants (not just custodians): bridge off. Custodians cannot switch it on without a separately signed clause. Non-custodians can opt in.
4. Free text never crosses. Rep-said destinations are `tenant_knowledge` unless verified against a public or carrier-published source (then `platform_knowledge`).
5. Prompt injection rule: only `platform_knowledge` and the tenant's own `tenant_knowledge` can reach the tenant's prompts; nothing else.
6. Cost: two tables plus a job; gives counsel a single place to read and a single switch for a regulator. It also cleanly answers "what do we do on tenant exit".

What would make this wrong: if counsel concludes the agent definition allows service-improvement from custodian data with an appropriate agreement, then the bridge may be broader. If counsel concludes it never does, the bridge should be removed entirely and platform knowledge sourced only from non-tenant material.

---

## 11. Points that need counsel (explicit list)

1. Whether CollectRx remains an "agent" under PHIPA given any cross-tenant learning, de-identification for platform use, or "owns anonymized analytics" clauses, and what the agreement must say.
2. Whether Ontario non-custodian tenants (restoration, collision) fall under PIPEDA only, and what their agreements must say about third-party individuals' data.
3. CRTC: whether the human-assisted handoff and calls to adjusters or government staff fall under ADAD/UTR Part IV, what identification is required, and effect of Notice 2026-132.
4. Recording/transcription: notice content and timing for reps; interception rules for an automated listener acting for a staff party; wording "recorded for quality purposes".
5. Cross-border and subprocessor terms for Vapi, Deepgram, ElevenLabs, model providers, Twilio; PHIPA service-provider obligations; Quebec/Alberta overlays if expanding.
6. Whether vehicle, property and employer identifiers count as health information in a custodian's hands, and in a non-custodian's.
7. Breach notification timing per regime (the repo's 14 day statement is not counsel-reviewed).
8. Direction-to-pay evidence standard for SABS (s. 48(2)(c)) and when an insurer may or must speak to a provider's agent.

## 12. Confidence summary
- PHIPA agent definition and s. 17(1), s. 11.2(1) text: high (fetched from ontario.ca today).
- Code findings (cross-tenant synthesis, scrubber patterns, allowlist guard, disclosure decision, squad config): high; I read the lines cited. I did not run anything.
- CRTC applicability, Criminal Code, PIPEDA business-contact exclusion, PIPEDA breach timing: medium or low, from memory or partial excerpts; marked COUNSEL.
- Whether Anthropic honours the residency headers: low (unverified).
- Behaviour of the live human-assisted squad (transfer mode, Scribe "Hello." audibility): unknown, matches the proposal's own open items.
