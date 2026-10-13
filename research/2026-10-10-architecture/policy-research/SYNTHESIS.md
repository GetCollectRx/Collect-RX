# Policy synthesis: compliance profiles, workflow gates, and what the code must enforce

Date: 2026-10-13. Author: Claude, for Khalid. Status: engineering design input, not legal advice. Every legal conclusion needs counsel. Built only from the six files in this folder plus the repo; each claim keeps the evidence tag it had in its source file (VERIFIED, SEARCH-EXCERPT, UNVERIFIED). Nothing here was re-fetched; where a source file could not read a primary page, this document inherits that limit.

Source files: health-privacy.md (HP), private-sector-privacy.md (PS), telecom-and-recording.md (TR), insurance-licensing-collection.md (IL), industry-statutes-stop-points.md (IS), vendors-ai-governance-standards.md (VG). Row references look like HP#9.

---

## 0. Bottom line

1. A single blanket privacy standard is wrong in both directions. It over-burdens non-custodian customers (tow, restoration) and it hides the fact that the customers who ARE custodians (dental, most rehab, pharmacy) are not compliant today.
2. The compliance regime is determined at three levels, not one: tenant (who carries the duty and what paper must exist), data field (what handling applies), and workflow (which counterpart, clocks and stop points apply). Section 1 gives the exact split and the evidence for it.
3. The shipping dental product has gaps that matter before any new vertical: no patient-consent attestation (HP#9), no custodian agent permission record (HP#1), every vendor agreement cell blank (VG), retention purge off and never run (PS#10, HP#12), no breach tooling (HP#2, PS#12), cross-tenant learning from transcripts (HP#14, PS#15), "may be recorded" while recording is off (TR#2). These are Tier 0 in section 9.
4. The vendor chain is a design fork, not a detail. The research found no Canadian processing region at any voice or LLM vendor (VG#9, #13, #14, #16), Vapi ZDR and HIPAA mode reported as mutually exclusive (VG#2), and HIPAA mode reported as an org-level setting (VG#1). If those reports hold, health workflows and commercial workflows need separate Vapi organizations, not just separate prompts. All SEARCH-EXCERPT, so confirm with Vapi before designing around it.
5. The strongest rule the research supports for new verticals: a policy parameter that is not VERIFIED and counsel-signed is a hard stop, never a default. The research itself found modules (ADP, ODSP vendor billing, Veterans Affairs) where nothing could be verified; those modules cannot launch.
6. Licensing risk is a script-content problem, not a registration problem. On the text read, calling an incorporated insurer about a client's receivable is outside the Collection and Debt Settlement Services Act (IL#2) and the real exposure is the Insurance Act adjuster definition and the motor/SABS negotiation ban (IL#9, #12). The enforcement point is what the agent is allowed to say, which makes it a prompt and tool-schema constraint plus a transcript audit.

---

## 1. How the regime is determined (answers: per client or per claim?)

Per the statutes read, it is all three levels, each answering a different question. Treating any one of them as the whole answer is what produces the blanket error.

| Level | Question it answers | Statutory basis | Stored as | Who sets it |
|---|---|---|---|---|
| Tenant | Who is the responsible party, and what agreements and attestations must exist before any call? | PHIPA binds the custodian (s. 3(1)); CollectRx is an agent only when acting for the custodian's purposes (s. 2 "agent", s. 17) (HP conclusions 1, 2). Non-custodians fall under PIPEDA or a provincial private-sector statute (HP conclusion 3, PS framing) | `regime_determination` record per tenant (below) | Counsel-owned rule, applied at onboarding; engineer never decides |
| Data field | How must this specific information be handled? | PHI is defined by the information, identifying plus health-related, in oral or recorded form (PHIPA s. 4, HP#13). Health numbers have their own rules (s. 34, HP#15). Redaction and minimum-necessary apply per field (HP#10, PS#9) | `dataClass` tag on each vault field and each import column: HEALTH, PERSONAL, FINANCIAL, GENERAL | Schema, per field, fixed in code |
| Workflow | Which counterpart, deadlines, stop points, and speech limits apply? | Industry statutes (IS), adjuster and public-adjuster rules (IL#9, #12), collection rules by debtor kind (IL#1, #2), call rules (TR) | Workflow manifest with required grants and a policy pack | Engineering from verified rows; counsel signs |

Rules that follow:

- Duties attach to the tenant; handling attaches to the data. A tow operator tenant is never a custodian, but an injury note on its file is still personal information that must be minimized and kept out of learning. A dental tenant's every claim row is PHI because the tenant is a custodian and the content is health-related.
- Data class can raise handling inside a profile and never lower it. A field tagged HEALTH is handled as PHI for any tenant that holds it.
- Custodian status is a determination, not a flag the customer self-selects. Proposed record:

```text
regime_determination
  tenantId
  tenantKind          RHPA_MEMBER | PHARMACY | OTHER_HEALTH_PROVIDER | COMMERCIAL_CONTRACTOR | OTHER
  provinces[]         where the tenant operates and where data subjects live
  custodianStatus     CONFIRMED | PRESUMED | NOT_CUSTODIAN | UNDETERMINED
  privacyRegimes[]    PHIPA | HIA_AB | PIPEDA | PIPA_AB | PIPA_BC | QC_PRIVATE_SECTOR
  basisRef            counsel memo or checklist version
  determinedBy, determinedAt, reviewDueAt
```

- UNDETERMINED behaves as CONFIRMED. HP Q6 shows hearing-aid dispensers, equipment vendors and non-regulated rehab turn on whether the tenant's "primary function is to provide health care for payment" (PHIPA s. 2 definition, VERIFIED text, application unresolved). Until counsel decides a tenant type, the stricter profile applies.
- Mixed tenants are normal. A rehab clinic billing motor vehicle insurers carries a health profile and the Statutory Accident Benefits Schedule pack at once. Profiles therefore combine per workflow; they are not exclusive tenant types.
- Province overlays key on tenant location and on data-subject location, not one or the other. Quebec's rules on communication outside Quebec (PS#3) depend on where the information originates; whether a Quebec patient of an Ontario tenant triggers it is open (PS Q6).

---

## 2. Applicability matrix by customer group

Privacy regime, counterpart and licensing envelope differ by group. Unknowns are marked as unknowns and treated as the stricter case.

| Group | Tenant is a PHIPA custodian? | Default profile | Main counterpart | Licensing and scope envelope | Hard stops found |
|---|---|---|---|---|---|
| Dental (current product) | Yes, presumed: RHPA member who provides health care (HP conclusion 3; RHPA Schedule 1 not read, UNVERIFIED) | Health | Group insurers (corporate) | Status check only; CDSA out per Reg. 74 s. 19.7 on the text (IL#2) | Insurer payment into court is not a dental concern; dispute assertion hands off |
| Auto rehab and allied health | Mostly: RHPA members yes; non-regulated types undetermined | Health + SABS pack | Auto insurers, adjusters | Highest licensing exposure: Insurance Act s. 397 adjuster licence, s. 398 ban on negotiating motor and SABS claims for compensation for a claimant (IL#10, #12); s. 48(2)(c) direction to pay (IL#14); s. 62 voids assignment (IL#15) | Late SABS notices, treatment-plan disputes, insurer paying into court, anything adjusting-adjacent |
| Property restoration and emergency housing | No (not health care providers) | Commercial + Construction Act tracking | Property insurers, adjusting firms | Adjuster definition; "agent of the property insured" exclusion unresolved (IL Q2) | Any lien in play, holdback and adjudication decisions, payee ambiguity |
| Collision, tow, storage | No | Commercial + RSLA/TSSEA pack | Auto insurers; sometimes individuals (owners) | TSSEA s. 32(1): amounts above published rates, or charged without consent or invoice, are not collectable (IS 1.2) | Disputed lien, sale, retention proposals, payment into court |
| Pharmacy | Yes (PHIPA s. 3(1) para 4 iii, HP conclusion 3) | Health | Group plans, government programs | Status only; payer kinds differ | ODSP/ADP-linked work stops until verified |
| Hearing, equipment, disability | Undetermined (HP Q6) | Health (by rule above) | ADP, ODSP, WSIB, Veterans Affairs, group plans | WSIB: practitioner may not bill the worker, no action beyond the Board (IS 1.5) | ADP, ODSP vendor billing, Veterans Affairs: nothing verified, module cannot launch |

Not researched: employer HR and disability (the earlier brief asked for a separate assessment). Nothing here covers it.

---

## 3. Shared floor: controls every tenant needs

These come from obligations that attach to CollectRx itself or to every commercial relationship regardless of profile. The reason to share them is that splitting them adds cost without adding protection.

| # | Control | Basis (file, row) | Why it is floor | Code state today |
|---|---|---|---|---|
| F1 | Debtor-kind gate on every dispatch: corporate insurer allowed; individual, sole proprietor, partner, guarantor, or unknown type routes to human review | IL#1, #2, #5 | CDSA exposure falls on the client too (s. 24) | Absent |
| F2 | Scope limit enforced in prompts and tool schemas: status, dates, references, document receipt. No negotiation, coverage argument, demand language, or legal conclusions | IL#4, #9, #12; IS Q4 | Adjuster definition and s. 398 turn on what is said | Prompts not audited for this; Escalation_Closer is the highest risk (IL#9) |
| F3 | Authorization grants: letter of authority per payer, scoped to status inquiry, expiry and revocation honoured before next dial | IL#20 | Insurer practice and agent paper trail | `authorization_grants` not in schema |
| F4 | Retention job on by default, covering transcripts, call attempts, breach records, human-assisted logs, lesson provenance | PS#10, HP#12, TR#16 | PIPEDA retention, destruction; 12-month default conflicts with unverified 7-year dental records claim (PS Q9) | Off by default, never run live, skips several tables |
| F5 | Breach register capturing every breach (not only high risk), 24-month retention, prescribed report fields, province routing | PS#12, #13 | PIPEDA ss. 10.1 to 10.3 and SOR/2018-64 verified | Model exists with no route; lacks required fields |
| F6 | Subject access export and deletion workflow | PS#14 | PIPEDA s. 8; Quebec 30 days | Absent |
| F7 | Sub-processor register with region, contract ref, review date; CI fails on an unregistered vendor domain or squad provider | PS#1, VG#4, VG checklist | Accountability principle; PHIPA s. 50 record | Blank trackers |
| F8 | Truthful call notices: opening names the automation, the principal, a callback number and mailing address; recording statement matches reality | TR#2, #4, #8; PS#17; VG#24 | OPC openness; possible ADAD identification rule (CRTC text unread) | "may be recorded" while recording is off; no mailing address |
| F9 | Recipient-local calling window, intersection of legal and carrier-staffed hours; handles Newfoundland half-hour offset and Saskatchewan | TR#10, #21 | Hard-coded Eastern breaks outside Eastern | Hard-coded Eastern 08:00 to 17:00 |
| F10 | Voicemail detection in config, not prompt-only | TR#15 | A left message is itself a recorded message with identification duties | Prompt-only |
| F11 | Remote-hangup disconnect measured under 10 seconds | TR#9 (SEARCH-EXCERPT) | Cheap to prove, expensive to learn wrong | Not measured |
| F12 | Learning pipeline default-deny: only de-identified content, tenant contribution and consumption flags, automated identifier scan on lesson text, provenance expiry | PS section 4, HP#14 | Purpose limitation; PHIPA agent definition | Cross-tenant, provenance link kept, no flags |
| F13 | Marketing engine hard wall from claims data | HP#16 | PHIPA ss. 32 to 33 for custodians; good practice for all | Wall unverified |
| F14 | Statute-versioned policy parameters with evidence tag; unverified parameter blocks its module | IS section 4 note | Several Ontario provisions are amended but not in force | No policy pack mechanism |

---

## 4. Health profile: additions on top of the floor

Applies to every tenant whose custodian status is CONFIRMED, PRESUMED or UNDETERMINED, and to any workflow touching a HEALTH-class field.

| # | Control | Basis | Test | Code state |
|---|---|---|---|---|
| H1 | Per-tenant agent permission record scoped to purposes (claim status inquiry); blocks secondary use | PHIPA ss. 17(1) to (3) (HP#1) | Attempt a secondary-use job on an identifiable transcript; it refuses and logs | Absent; the BAAL gate is carrier authorization, not this |
| H2 | Consent attestation by the practice that patients' express, knowledgeable consent covers insurer communications; calling disabled without it; attestation version in the audit log | PHIPA ss. 18(3)(a), 18(5), 29(a) (HP#9). Payment permission in s. 38(1)(b) does not cover private insurers | Tenant without attestation cannot enable calling | Absent |
| H3 | Minimum necessary: variable allowlist per call type and per carrier; identifiers spoken only on request | PHIPA s. 30 (HP#10); PIPEDA 4.4.1 (PS#9) | Variable set equals allowlist; a scripted rep who never asks for DOB never hears it | All identifiers loaded for every call; IVR_Navigator reads policy number unprompted |
| H4 | Incident routing to the custodian at first reasonable opportunity, with a breach packet (affected tokens, data elements, timeline, vendors) | PHIPA s. 17(4)(b), s. 12(2)(a), O. Reg. 329/04 s. 6.3 (HP#2, #3). No 14-day rule exists | Seeded breach yields the packet and a notification record | Absent; the runbook cites a 14-day rule that does not exist |
| H5 | Annual incident counters exportable per tenant by category | O. Reg. 329/04 s. 6.4 (HP#4) | Export returns four category counts | Absent |
| H6 | Audit trail on every PHI read path, built now even if PHIPA s. 10.1 is not proclaimed | HP#6 | Detokenize, transcript read, export all write events | Partial |
| H7 | Transfer record for out-of-Ontario disclosure; basis recorded as consent or the payment-administration permission | PHIPA s. 50(1)(a), (f) (HP#11) | Register shows region per vendor | Absent |
| H8 | Transcripts, summaries and structured outputs treated as PHI everywhere they land | PHIPA s. 4 (HP#13) | Inventory of every store for transcript, summary, audio | Partial |
| H9 | Health numbers not collected unless CollectRx is clearly an agent; import drops them otherwise | PHIPA s. 34 (HP#15) | Import with health-card column is rejected or dropped | Field exists in `PatientPHI`; flow unconfirmed |
| H10 | Alberta: information manager agreement on file before enabling; breach routing to custodian | HIA ss. 60.1, 66 (HP#19) | Flag per Alberta tenant | Doc only, mis-cited |
| H11 | Quebec: PIA reference and agreement reference per outbound vendor before dispatch; human review path if any decision is exclusively automated | Law 25 s. 17, s. 12.1 as enacted (PS#3, #7) | QC tenant without PIA ref is blocked | No gate; PIA draft stale and unsigned |
| H12 | No cross-tenant learning from HEALTH-class content unless counsel confirms de-identification standard | HP#14, PS#15 | Opt-out tenant yields zero learning rows | Not enforced |

---

## 5. Commercial profile: additions on top of the floor

Applies to restoration and collision/tow/storage tenants, and to any tenant not custodian-confirmed that also carries no HEALTH-class fields.

| # | Control | Basis | Note |
|---|---|---|---|
| C1 | PIPEDA purposes recorded per tenant, including whether secondary use (learning) is authorized | PIPEDA ss. 5(3), 6.1, Sched. 1 cl. 4.2, 4.3 (PS#8) | Tenant is the accountable organization for its data; CollectRx is processor unless it uses data for its own purposes |
| C2 | Import rejects health fields for commercial tenants | HP#23 | Keeps a tow tenant outside the health handling it does not need |
| C3 | Payer entity-type capture | IL#2 | Reciprocal exchanges, Lloyd's, Crown or government payers need review |
| C4 | Alberta and BC private-sector notices for foreign service providers; BC retention (one year after decision use) | PS#20, #10 | BC PIPA text read contains no mandatory breach notification (PS#13) |

The commercial profile needs less of the vendor chain: invoice numbers, claim numbers and business names carry far less identifying health content than dental calls.

---

## 6. Counterpart and licensing envelope (applies per workflow)

| Counterpart kind | Rule found | Control |
|---|---|---|
| Incorporated insurer | CDSA does not apply on the text of Reg. 74 s. 19.7; exemption excludes individuals, sole proprietors, partners and personal guarantors (IL#2) | Allow, with entity type recorded |
| Unincorporated or unknown payer | Not exempt | Human review |
| Individual (patient, policyholder, owner) | CDSA contact rules apply: notice first, 3 contacts per 7 days, hours, no contact with family or employer (IL#6). Patient SMS, email and pay links are blocked in code; voice is not mentioned (IL#6) | Hard block today, including voice. Add voice to the policy file |
| WSIB | Practitioners may not bill the worker; no action beyond the Board (WSIA s. 33(5), (6), IS 1.5) | WSIB-covered file forces patient contact off |
| ADP, ODSP, Veterans Affairs | Nothing verified | Module cannot launch |
| Adjuster-adjacent conduct | Licence offence (s. 397); ban on negotiating motor and SABS claims for compensation (s. 398); direction to pay required for direct SABS payment (O. Reg. 34/10 s. 48(2)(c)); assignment of SABS benefits void (s. 62) | F2 script limits plus F3 grants; pricing never a percentage of a SABS payment stream |

Pricing implication from IL section 2: flat or per-call fees are safest in every vertical; a percentage of an insurer payment on SABS invoices is the highest-risk model, and the current tiers (`src/billing/tiers.ts`) are flat plus overage, which fits.

---

## 7. Call mode and telecom profile

Two modes carry different obligations (TR groups A and B).

| Mode | Consent logic | Controls |
|---|---|---|
| Autonomous (AI speaks to the rep) | Practice via CollectRx is originator and a party; one-party consent suffices on the Criminal Code text (ss. 183, 183.1, 184(2)(a) VERIFIED) | F8, F9, F10, F11 |
| Human-assisted (Hold Sentinel, V1) | Practice staff are a party; the carrier rep is an unnotified third party to Claims_Scribe's transcription (TR#19) | Pre-transfer or early-in-call notice to the rep, per-tenant switch to disable transcription, staff consent clause in the customer agreement. The learning loop already skips human-assisted calls (TR#3), which is the right conservative default; keep it |

Everything CRTC (hours, ADAD identification, 10-second disconnect, telemarketing status of B2B calls, Notice 2026-132) is SEARCH-EXCERPT at best; no CRTC primary page was readable. 2026-132 is a Notice of Consultation, not a Telecom Regulatory Policy (TR#12). The design stance that survives that uncertainty: build to the stricter reading as a floor (identification with address, disconnect timing, recipient-local hours) because each is cheap and none is wasted if the rules turn out not to apply.

---

## 8. Policy packs: encoding rules

Packs are data per industry (IS tables). Rules drawn from the research:

1. Every parameter carries `statute`, `section`, `consolidationDate`, `evidenceTag`, `counselSignedAt`. IS access note: several Ontario provisions carry "day to be named" amendments; storing the consolidation date makes drift detectable.
2. Only VERIFIED and counsel-signed parameters can drive agent speech. Others may drive internal staff alerts only (for example, 90 day and 30 day warnings before a limitation date), never statements to a counterpart.
3. The agent asks and records; it does not conclude. Prohibited outputs include "deemed proper", "deemed approved", "you have no lien", any interest figure, and any limitation advice (IS 1.1 to 1.3, IS Q4). Test: transcript lint on these phrases plus a prompt-level ban.
4. Acknowledgment events: an insurer's acknowledgment of a liquidated debt to the claimant's agent can restart a limitation period (Limitations Act s. 13). Log the words and the date as an event and surface it to the tenant. The agent must not invite or draft acknowledgments. Whether this applies to CollectRx as agent is a counsel question (IS Q7).
5. Dispute assertion on any file (non-payment notice, lien dispute, SABS dispute, objection) halts automated calls on that file and creates a human task (IS 1.1, 1.2, 1.3).
6. Date arithmetic uses the statute's own rule: SABS counts business days, excludes the reference day and cuts off at 5 p.m. local (O. Reg. 34/10 s. 64); Construction Act, RSLA and Insurance Act use different counting. Do not share one calendar function.
7. Module launch requires every blocking parameter in its pack to be VERIFIED and signed. Blocked today: ADP, ODSP vendor billing, Veterans Affairs; also any pack row marked UNVERIFIED in IS and IL.

Known verified clocks worth encoding first (all in IS, Ontario e-Laws text read 2026-10-13): SABS 10 business days for treatment-plan notice and 30 days for invoice payment, two years to the Licence Appeal Tribunal; Construction Act 7 day deficiency notice, 28 day payment, 14 day non-payment notice, 90 day adjudication window; RSLA 15 or 60 day storer notice by permit status, 15 day notice of intention to sell, 30 day retention objection; Insurance Act one year on auto physical damage and on property conditions; WSIB 6 month billing band with 25, 50 and 100 percent reductions.

---

## 9. Vendor route implications

Findings (all SEARCH-EXCERPT unless noted):

- Providers in one call chain: Vapi, Twilio, Anthropic (Sonnet 4.5 and Haiku 4.5, VERIFIED in `vapi-squad-config.json`), ElevenLabs, Deepgram nova-2; Gemini for server-side summaries and marketing. Identifiers reach at least five of them (VERIFIED in code and doc).
- No Canadian region found for any of them (VG#9, #13, #14, #16). Only Fly `yyz` compute is claimed. Anthropic residency reported as global or US only.
- Vapi HIPAA mode and ZDR reported as mutually exclusive; HIPAA mode reported as an org-level setting not settable per call (VG#1, #2).
- The code relies on Vapi-side structured output (`analysisPlan`) in `vapi-squad-config.json` (lines 55, 290, 483, 646 per VG#2), which ZDR would remove.
- Every agreement tracker cell is blank (VG, repo).

Consequences for design:

| Question | Implication if the reports hold |
|---|---|
| Do health and commercial workflows share a Vapi organization? | If HIPAA or ZDR is org-level, health workflows need their own organization (their own keys, numbers and squad set); commercial workflows run in a standard organization. Prompts and tools are separate regardless |
| Can the health route keep using Vapi analysis output? | Under ZDR, no. Outcomes must come from tool calls that CollectRx's server receives. Claims_Scribe already logs outcomes through `log_call_outcome` tool calls (vapi-live files), so the pattern exists |
| Does cost change? | Reported add-on prices are $1,000 to $2,000 per month for HIPAA and about $1,000 for ZDR, with sources conflicting (VG#3, UNVERIFIED). A health route would carry that as fixed cost. At the Hold Sentinel plan a fully used tenant yields about $379 gross a month (from the capacity review: $649 revenue less $270 delivery cost), so a reported $1,000 to $2,000 fixed cost needs roughly 3 to 6 fully used tenants to cover. This is the only quantitative effect I can derive; the prices themselves are unverified |
| Can a health claim ever be made about Canadian data residency? | No. Remove any such statement until a vendor contract supports it (VG#9, PS Q10). `LLM_RESIDENCY_HEADERS` is sent to Anthropic with no evidence it is honoured (PS, HP) |

This is a direct challenge to the premise that one shared platform needs no segregation. The conclusion I would draw: shared codebase and shared floor, yes; one vendor route for all data classes, only if the vendors can supply BAA-equivalent and ZDR terms for the whole chain. Confirm with Vapi in writing before designing around either reading.

---

## 10. Gaps ranked

Tier 0: gaps in the shipping dental product, measured against the obligations the research read, before any new vertical. These are gaps against the research, not findings of non-compliance; counsel decides which obligations apply.

| Gap | Rows |
|---|---|
| No consent attestation, no agent permission record | HP#9, #1 |
| Vendor agreements blank; no sub-processor register | VG, PS#1, HP#7, #11 |
| Cross-tenant learning from redacted transcripts, shipped to Anthropic (US), provenance link kept, no flags | HP#14, PS#15, section 4 |
| Retention off and never run; skips breach and human-assisted tables | PS#10, HP#12, TR#16 |
| No breach workflow; the runbook states a nonexistent 14-day rule and wrong deletion cites | HP#2, #3, conclusion 6 |
| "May be recorded" while recording is off; no notice to the rep when Claims_Scribe transcribes | TR#2, #19 |
| Quebec: no dispatch gate; PIA contradicts the Vapi variable design and cites a 72 hour deadline absent from the enacted text | PS#3, #4, HP conclusion 6 |

Tier 1: required before any non-dental workflow launches.

Debtor-kind gate (F1), scope enforcement and transcript lint (F2), authorization grants (F3), regime determination record (section 1), workflow manifest preflight, recipient-local hours (F9), policy pack mechanism with evidence gating (F14), field data classes, import field rejection for commercial tenants (C2).

Tier 2: before scale or additional provinces.

Subject access export (F6), Alberta and BC specifics, annual incident exports (H5), voicemail detection and hangup measurement (F10, F11), vendor route split, CI vendor allowlist (F7).

---

## 11. Corrections to documents, earlier notes, and my own earlier statements

| Item | Correction |
|---|---|
| PHIPA runbook | No 14-day breach deadline; s. 12(2) says first reasonable opportunity; ss. 65 to 68 are damages and Commissioner powers; ss. 37 to 39 are use and disclosure permissions, no erasure right exists (HP conclusion 6) |
| HIA-Alberta-Clause | s. 66 is the information manager agreement; affiliate breach duty is s. 60.1 (HP) |
| Quebec PIA | 72 hours is not in the enacted s. 3.5 text ("promptly"); states identifiers never reach voice agents, contradicted by `src/vapi/client.ts`; lists retired patient payments; 7 year retention claim unverified (PS section 5) |
| "Ontario Reg 74/05" | That is a sheet metal worker regulation; the collection regulation is R.R.O. 1990, Reg. 74 (IL naming note). I used 74/05 in my own earlier message to Khalid; read it as Reg. 74 |
| ARCHITECTURE-PROPOSAL 17.6 item 5 | Both 15 day periods exist: storer notice for a vehicle with an HTA permit (O. Reg. 427/15 s. 4(3)) and notice of intention to sell (RSLA s. 15(2)); the 60 day period applies without a permit (IS 1.2) |
| CRTC 2026-132 | Notice of Consultation issued 11 June 2026, not a Telecom Regulatory Policy; contents unread (TR#12) |

---

## 12. Counsel questions, grouped by what they block

The six files hold roughly 70 questions with overlap. Deduplicated and ordered by the module each one blocks.

Blocks all launches, including current dental:

1. Is CollectRx a PHIPA agent, a non-agent electronic service provider, or both, and what written instrument per practice? (HP Q1)
2. Does consent already collected on a standard claim form satisfy express, knowledgeable consent for an AI caller, or must the practice attest separately? (HP Q3)
3. Do transfers to US-hosted sub-processors fit PHIPA s. 50(1)(f) or need consent? (HP Q4, VG Q1)
4. Are the sub-processors agents of CollectRx, of the custodian, or neither? (HP Q2, VG Q7)
5. Is cross-tenant learning from redacted transcripts de-identification for PHIPA and Quebec purposes; is custodian opt-in required? (HP Q5, PS Q5)
6. Is transcription by Vapi and storage by CollectRx an interception, and what notice does a carrier rep need in each call mode? (TR Q1, VG Q6)
7. Retention: what period per dental records and per transcript, and should purge be default-on? (HP Q10, PS Q9, TR Q9)

Blocks the rehab/SABS workflow:

8. Is a provider's own invoice follow-up caught by Insurance Act s. 398? Does status-checking amount to adjusting under s. 1(1)? (IL Q2, Q3)
9. Does FSRA require written insured authorization for a provider's agent to discuss a file; may a billing agent act for a licensed health service provider? (IL Q6, open item)
10. Does Aviva v. Catic (UNVERIFIED) change what the agent may say about the 10 business day notice consequence? (IS Q12)

Blocks restoration and collision/tow/storage:

11. Do Construction Act prompt payment clocks bind or benefit a restoration contractor invoicing an insurer? (IS Q1 to Q3)
12. Where are TSSEA published rates, and may the agent quote them? (IS Q6)
13. Which limitation clock governs the policy form: Insurance Act s. 148 condition 14, s. 259.1, or the Limitations Act? (IS Q8)

Blocks government-payer workflows:

14. WSIB provider dispute route and standing under WSIA s. 120. (IS Q9)
15. ODSP, ADP and Veterans Affairs: nothing verified; need the vendor manuals read by a person.

Blocks pricing and sales:

16. Percentage-of-recovery fees: SABS s. 62, s. 398 and adjuster-compensation risk; flat subscription safer in every vertical? (IL Q4)
17. CDSA: does s. 19.7 cover unincorporated or Crown payers? (IL Q1)

Blocks new provinces:

18. Quebec: PIA per vendor, s. 12.1 application, per-province collection and adjuster rules (PS Q6, Q7; IL section 5, all UNVERIFIED).
19. Recipient-local calling hours required by law for non-telemarketing calls, or business practice only? (TR Q11)

Open classification:

20. Customer-level versus claim-level custodian test for edge cases (my Q from the last exchange; no source settles it).

---

## 13. What was not verified

- CRTC primary text, all of it (403 and DNS failures).
- Every vendor page (Vapi, Twilio, Anthropic, ElevenLabs, Deepgram, Google, Fly); every vendor claim is SEARCH-EXCERPT or UNVERIFIED.
- IPC Ontario guidance (AI scribes, vendor guidance); FSRA and HCAI pages; Legisquebec current consolidation; CanLII and all case law.
- ADP, ODSP vendor billing, Veterans Affairs; provincial equivalents outside Ontario except Alberta HIA, Alberta and BC PIPA, which were read.
- PIPEDA meaningful-consent guidance (skimmed only); RHPA Schedule 1 (to confirm dentists are members).
- Employer HR and disability assessment from the original brief.

---

## 14. Premise check

| Premise | Result |
|---|---|
| One shared platform serves every industry | Holds for codebase, floor controls, scheduler and vault. Fails for vendor route if HIPAA or ZDR is org-level, and fails for any single privacy standard |
| Dental is the compliant baseline new verticals extend from | Does not hold. The research shows dental is itself missing Tier 0 controls. Compliance work on dental precedes, and is the template for, the health profile |
| Non-dental verticals are simply dental with different clocks | Does not hold. Restoration and collision tenants are not custodians, the counterpart envelope differs, and in rehab the licensing exposure is higher than in dental |
| Strictest-common-denominator is the build target | Partly. Use it as default for undetermined cases and for cheap floor controls; do not impose health consent mechanics on tenants who are not custodians |
