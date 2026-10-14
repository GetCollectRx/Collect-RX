# 03. Vendor management policy and DPA request letters

> DRAFT. Not reviewed by a lawyer. Positions per the founder's signed risk register (R3, R4 unsigned). Letters are drafts only and have NOT been sent. Open items listed at the end.

## Purpose

Decide which service providers may receive personal information, on what terms, and how that is recorded and re-checked. Provide a request letter per vendor.

## Who it binds

CollectRx staff and anyone adding a dependency, API key, squad provider or model to the product.

## Obligations implemented

| Obligation | Source (research file#row) | Tag |
|---|---|---|
| Comparable protection by contract when a third party processes | PIPEDA Sched. 1 cl. 4.1.3 (private-sector-privacy.md#1) | VERIFIED |
| Reasonable safeguards; staff and providers agree to restrictions | PHIPA s.12(1); O. Reg. 329/04 s.6(1) para 3 (health-privacy.md#5, #7; register R4) | VERIFIED |
| Out-of-Ontario disclosure basis recorded | PHIPA s.50(1)(a), (f) (health-privacy.md#11; register R3) | VERIFIED (text); reading OPEN |
| Quebec PIA and written agreement before communication outside Quebec | P-39.1 s.17 (FSRA-RCDSO-QUEBEC.md#11) | VERIFIED |
| Know each vendor's storage and region facts | vendors-ai-governance-standards.md rows 1 to 17 and L1 addendum | Mixed; see register |

## Policy

1. **Register.** Every provider that can see personal information is listed in the sub-processor register (W8, planned) with: role, data classes, region, contract reference, retention setting, training setting, last review date. A provider not in the register must not receive personal information. CI fails when a squad provider or vendor domain in code is missing from the register (W8).
2. **Minimum terms before real patient data flows** (go-live condition for register R4): signed DPA or equivalent terms covering purpose limitation, no training on customer content, breach notice to CollectRx in a stated number of hours, sub-processor list and change notice, deletion on termination with confirmation, assistance with access requests, and region of processing. If a vendor will not provide terms, record its written refusal and the founder's risk acceptance (policy 08).
3. **Retention settings.** Use the shortest vendor-side retention available. Vapi Zero Data Retention requires no separate purchase per Vapi docs (VERIFIED, public docs) and stops Vapi storing recordings, transcripts, summaries and structured outputs. Founder decision D2 chooses between ZDR and HIPAA mode (mutually exclusive). Until decided, treat Vapi as storing logs and transcripts.
4. **Changes.** A change of model, voice, transcriber, telephony number source or hosting region is a vendor change: update the register before the change merges. Track model deprecations (Anthropic labels Claude Sonnet 4.5 deprecated, VERIFIED).
5. **Logs.** Never write personal information to stdout or logs. Fly.io's own support tooling may process "platform log lines, which include whatever your application writes to stdout" with AI vendors (VERIFIED, Fly sub-processors page).
6. **Review.** Re-read each vendor's terms and region pages every 6 months and on any notice of change.
7. **No residency claims.** Do not claim or imply Canadian data residency for the service; only Fly.io application compute in Toronto is supported by the facts read.

## Vendor facts as of 2026-10-13

| Vendor | Role | Region facts read | Retention facts read | Tag |
|---|---|---|---|---|
| Vapi | Voice orchestration | Not read | Default stores logs and transcriptions; ZDR no separate purchase; HIPAA paid add-on; org-level; mutually exclusive | VERIFIED (docs) for retention; region UNVERIFIED |
| Twilio | Telephony | Not read | Not read | UNVERIFIED |
| Anthropic | LLM (squad, lesson extraction) | inference geo "global" or "us" only; workspace geo "us" only | Not read this session | VERIFIED (region) |
| ElevenLabs | TTS | Default storage U.S.; EU, India, Singapore isolated environments, Enterprise only | Zero Retention Mode optional | VERIFIED |
| Deepgram | STT | Not read | Not read | UNVERIFIED |
| Google (Gemini) | Server-side summaries and marketing | Not read | Not read | UNVERIFIED |
| Fly.io | Hosting | Compute region yyz (repo); sub-processors US, UK, Germany; AWS backups US | n/a | VERIFIED (sub-processors) |

## DPA request letter (template; one per vendor, not sent)

> Subject: Data processing terms for CollectRx (Canada), account [ACCOUNT ID]
>
> CollectRx is a Canadian company that follows up on dental insurance claims with insurers for dental practices. Practices are health information custodians under Ontario's Personal Health Information Protection Act, 2004; CollectRx acts as their agent. Through our use of [SERVICE], the following may reach you: [DATA CLASSES: for example patient name, date of birth, policy number spoken or passed as call variables; call transcripts; carrier representative first names].
>
> Please confirm in writing, with the name and role of the person confirming:
> 1. Your current data processing agreement, and whether you will sign one with terms suitable for Canadian health information (purpose limitation, agent flow-down, written agreement for transfers outside Quebec).
> 2. Every region where our content is processed and stored, including backups and logs, and whether any Canadian region exists.
> 3. Default retention for each artifact type and the shortest retention or zero retention setting available to us, with any price.
> 4. Whether our content is used to train or improve models, by you or your sub-processors, and how to opt out.
> 5. Your current sub-processor list, how changes are notified, and our right to object.
> 6. Breach notification time to customers, in hours, and the contact route.
> 7. Deletion on request and on termination, with timeline and confirmation.
> 8. Your policy on law enforcement and foreign government access requests and whether customers are notified.
> 9. Current SOC 2 Type II report or ISO/IEC 27001 certificate and scope.
> [VENDOR-SPECIFIC QUESTIONS]
>
> We are not live with patient data and will not route patient data to you until these terms are settled.

### Vendor-specific questions

| Vendor | Add to the letter |
|---|---|
| Vapi | VAPI-QUESTIONS.md V1 to V26, in particular: two organizations under one contract (V2), written confirmation of the HIPAA and ZDR documentation, HIPAA price, whether call variables appear in logs or dashboards (V16), which contracts cover Anthropic, ElevenLabs and Deepgram traffic routed through Vapi (V10) |
| Twilio | Whether any recording or media storage is active on our numbers; HIPAA eligibility of Canadian numbers; STIR/SHAKEN attestation on Canadian outbound calls |
| Anthropic | Zero data retention eligibility for the models we use; whether traffic via Vapi is under Vapi's or our agreement; model deprecation schedule for claude-sonnet-4-5 and claude-haiku-4-5 |
| ElevenLabs | Zero Retention Mode availability on our plan; whether text sent for synthesis (which contains patient names) is retained |
| Deepgram | Model improvement opt-out (`mip_opt_out`) and whether Vapi passes it; regional endpoints |
| Google | Whether our Gemini usage is on terms that exclude training; whether any patient or transcript content reaches Gemini paths (`callSummary.ts`, `agentRunner.ts`) |
| Fly.io | Location of Postgres backups and snapshots; whether support tooling can access database contents; BAA or DPA |

## Open items

1. Founder decision D2 (ZDR or HIPAA mode).
2. Who sends the letters, and from which address (PENDING_FOUNDER_DECISION). Nothing is sent by this workstream.
3. Register R3 and R4 unsigned.

## Code control and test

| Control | Test | Status |
|---|---|---|
| Sub-processor register and CI check for unregistered providers | W8 (planned) | Planned |
| No PHI in logs | Existing logger scrubbing (`src/server/observability/logger.ts`); log-scan tests per FIX-PROMPT | Partial |
| Policy lint blocks residency claims | `scripts/policy-lint.cjs` (L4) | L4 PR |
