# Vendors, AI Governance and Standards: Policy Research for CollectRx

## L1 verification update (2026-10-13)

Vendor pages were read in Chrome this session (EVIDENCE-LOG-2026-10-13.md E18 to E21). The method note below ("No external page was fetched") is superseded for these rows. Public documentation is not a contract; written confirmation is still required (VAPI-QUESTIONS.md).

| Row | New tag | Statement |
|---|---|---|
| 1 | VERIFIED | Vapi: HIPAA "is an organization-level setting ... and it cannot be enabled through the API"; "a paid compliance add-on" (price not shown); limits providers to HIPAA compliant ones |
| 2 | VERIFIED | "HIPAA mode and Zero Data Retention (ZDR) are mutually exclusive." Under ZDR Vapi retains no recordings, transcripts, messages, summaries, structured outputs or detailed logs; keeps call history, cost, latency and billing metadata. Outcomes can still be delivered through the end-of-call-report webhook if configured before enabling |
| 3 | CONTRADICTED (ZDR) | "ZDR does not require a separate purchase." HIPAA price still unknown |
| New | VERIFIED | Vapi default: "By default, Vapi records your calls and stores logs and transcriptions." |
| 9 | VERIFIED | inference_geo: "global" or "us"; workspace geo "us" only; unsupported on Sonnet 4.5 (labelled deprecated) and Haiku 4.5 |
| 13 | VERIFIED (quoted sentences, keyword scan) | ElevenLabs: data residency is an Enterprise feature; default storage in the U.S.; isolated environments EU and India; processing may occur outside the selected location. No Canada |
| 17 | VERIFIED | Fly sub-processors (last updated 2026-09-24): US, UK, Germany only; AWS backups US; Fly's internal AI tooling may process "platform log lines, which include whatever your application writes to stdout" |
| 18 | VERIFIED (status) | Bill C-36 (Protecting Privacy and Consumer Data Act) at second reading; no federal AI regulation statute found in force |
| 24 | VERIFIED | 2026-132 explicitly asks about AI and synthesized voices (Q2, Q10, Q11) |

Researched 2026-10-13. Not legal advice. Prepared for "code informed by policy".

## Evidence tags and method limits

- VERIFIED: I read the primary text myself in this run. In this run that means ONLY the repo's own files (paths cited). No external page was fetched.
- SEARCH-EXCERPT: appeared in a web-search result summary (often a secondary source or a paraphrase). Not read in full. Do not rely on it for a contract or compliance decision.
- UNVERIFIED: recalled, inferred, or contradicted by sources, or no source found.
- Sandbox limit: WebFetch failed with DNS errors (`getaddrinfo ENOTFOUND`) for vapi.ai, docs.vapi.ai, fly.io and canada.ca. Vendor and government primary pages could NOT be opened. Every external claim below is therefore SEARCH-EXCERPT or UNVERIFIED. None is VERIFIED.
- Dates, prices and plan names from vendors change often. Treat every number as a lead to confirm.

## Stack actually in the repo (VERIFIED, from files)

| Layer | What the code says | Path |
|---|---|---|
| Squad LLM | `anthropic` provider, `claude-sonnet-4-5-20250929` (4 agents), `claude-haiku-4-5-20251001` (Hold_Sentinel) | `Collect-RX-main/vapi-squad-config.json` (lines ~10, 189, 228, 441, 604) |
| TTS | `11labs` for most agents, `vapi` voice for Hold_Sentinel | same file (~30, 201, 270, 458, 621) |
| STT | `deepgram` `nova-2` for all agents | same file (~36, 205, 276, 464, 627) |
| Orchestration | Vapi squad API, `assistantOverrides` carries call variables, `artifactPlan: { recordingEnabled: false }` | `Collect-RX-main/src/vapi/client.ts` (~397-403, ~528) |
| Server-side agents / marketing | Gemini (per CLAUDE.md `gemini-2.0-flash`); Gemini code in `src/server/agents/agentRunner.ts`, `src/server/marketing/geminiClient.ts`, `callSummary.ts`, `replyIntelligence.ts`, `src/server/learning/providers/geminiGrounding.ts` | those paths |
| Hosting | Fly.io `primary_region = 'yyz'` | `Collect-RX-main/fly.toml` line 35 |
| Telephony | Twilio referenced in server code (webhooks, notifications) | `src/server/vapi/vapiWebhook.ts`, `src/server/index.ts` |

Note: so the live provider chain for one call is Vapi + Twilio + Anthropic + ElevenLabs + Deepgram, then Gemini for server-side summaries. That is at least 5 to 6 third parties that can hear or see patient name, DOB and policy numbers (Option B in `PHI-VAPI-BOUNDARY.md`).

## Repo's current stated posture (VERIFIED, read in full or in part)

- `Collect-RX-main/docs/compliance/PHI-VAPI-BOUNDARY.md`: Option B, ephemeral PHI in Vapi `variables`; UUID only in metadata; `recordingEnabled: false`; checklist items for signed BAA/DPA with Vapi and Twilio, written Vapi transcript retention, and PIA update are all UNCHECKED.
- `docs/compliance/VENDOR-AGREEMENTS.md`: tracker table with every "Executed?" cell blank.
- `docs/compliance/Vendor_DPA_Review_Checklist.md`: dated June 2026; says Vapi DPA is enterprise-only and GDPR-framed, no public Canadian residency statement; Fly.io sub-processors listed as US-based including Tigris and AWS backups (these are the repo's own claims, not re-checked by me).
- `Collect-RX-main/docs/compliance/Quebec-Law25-PIA.md`: Draft v1.0, "Pending Privacy Officer Sign-Off"; claims Fly `yyz` hosting; says "Data is not retained beyond the call duration by third-party AI providers" as a required agreement term; section 5 lists automated decision-making as "yes" for AI estimates. It still lists patient payment collection (Stripe) in scope, which CLAUDE.md says is retired. Stale.
- `Collect-RX-main/docs/compliance/crtc-disclosure-decision.md`: conservative AI disclosure script in `Claims_Agent.firstMessage`; IVR_Navigator silent; downstream agents do not re-disclose.
- `Collect-RX-main/docs/compliance/REGULATORY-LANES.md`: cites CRTC Notice 2026-132 as the thing to watch for AI voice.
- Repo-wide grep for `ZDR`, `zero data`, `hipaaEnabled`, `42001`, `SOC 2`, `27001` in docs found no policy doc adopting any of these (VERIFIED by grep of `docs` dirs; result list was empty beyond the files above).

## (1) Requirements table

Columns: requirement or vendor term | source | who it affects | required technical control | acceptance test | current-code status | evidence tag.

| # | Requirement or vendor term | Source (URL) | Affects | Required technical control | Acceptance test | Current-code status | Tag |
|---|---|---|---|---|---|---|---|
| 1 | Vapi HIPAA mode needs Enterprise plan or add-on plus signed BAA; org-level setting, not settable via API | https://docs.vapi.ai/security-and-privacy/hipaa (not opened) | Vapi, all calls | Obtain BAA; enable org-level HIPAA mode; record in vendor tracker | Written BAA on file; Vapi dashboard shows HIPAA mode on; tracker row filled | Tracker blank (`docs/compliance/VENDOR-AGREEMENTS.md`). No `hipaaEnabled` in code. | SEARCH-EXCERPT |
| 2 | Vapi Zero Data Retention (ZDR) add-on and HIPAA mode described as mutually exclusive; under ZDR recordings, transcripts, summaries not kept, only metadata | https://docs.vapi.ai/security-and-privacy/zero-data-retention (not opened) | Vapi | Choose ONE: ZDR (no vendor content storage) or HIPAA mode. Architecture decision | Decision recorded in an ADR; test call shows no transcript/summary retrievable from Vapi after call | Code sets `recordingEnabled:false` only. Transcripts, `analysisPlan` summaries and structured data (`vapi-squad-config.json` lines 55, 290, 483, 646) still produced and consumed by `vapiWebhook.ts`. ZDR vs analysis dependence is unresolved. | SEARCH-EXCERPT |
| 3 | Add-on prices cited as HIPAA $1,000 to $2,000 per month and ZDR $1,000 per month; sources conflict | https://support.vapi.ai/t/33254972/hipaa-compliance (excerpt) | Budget | Cost model entry | Quote from Vapi in writing | Not modelled | UNVERIFIED |
| 4 | Vapi docs say only HIPAA-compliant providers can be selected in HIPAA mode; third-party BAAs remain customer responsibility | https://docs.vapi.ai/security-and-privacy/hipaa | Provider choice (Anthropic, ElevenLabs, Deepgram) | Provider allowlist in config sync; CI check that every provider in `vapi-squad-config.json` is on an approved list | CI fails if a squad uses a provider without a recorded BAA/DPA | No allowlist. Config uses `anthropic`, `11labs`, `deepgram`, `vapi` | SEARCH-EXCERPT |
| 5 | Vapi DPA enterprise-only, GDPR-framed; no public statement on Canadian residency; says no EU servers | `docs/compliance/Vendor_DPA_Review_Checklist.md` citing https://security.vapi.ai/ | Vapi | Treat Vapi as US processing; cross-border disclosure in privacy notices; contractual PHIPA/Law 25 language | Counsel sign-off on transfer terms | Repo assumes a transfer agreement is pending | UNVERIFIED (repo's own claim, source not opened) |
| 6 | Vapi sub-processor list and DPA obtainable via trust center | https://security.vapi.ai/ | Vapi | Download list; subscribe to change notices | Dated copy stored in DMS; diff process exists | None | UNVERIFIED |
| 7 | Anthropic: commercial/API inputs and outputs not used for training by default | Anthropic Commercial Terms (primary not opened); secondary: https://conductatlas.com/platform/anthropic/anthropic-commercial-terms/output-ownership-and-no-model-training/ | LLM for squad | Contract clause or DPA copy on file; ensure calls go through API key under commercial terms (via Vapi's account or BYO key, see Q4) | DPA/Commercial Terms PDF on file with date | Provider is `anthropic` in squad config. Whose key and whose contract unknown | SEARCH-EXCERPT |
| 8 | Anthropic API default retention reported as 30 days (one source says 7 days); ZDR by agreement; safety classifier results retained even under ZDR; an unconfirmed "covered models" 30-day policy dated June 2026 reported | https://www.getvoibe.com/resources/claude-api-data-retention/ and https://unsigned.char.com/blog/anthropic-data-retention-policy/ (secondary) | LLM | Obtain ZDR in writing if PHI reaches model; verify model-specific exclusions for `claude-sonnet-4-5` and `claude-haiku-4-5` | Written confirmation naming the exact model IDs | None | UNVERIFIED (sources conflict) |
| 9 | Anthropic `inference_geo` accepts only `global` or `us`; reported unsupported on Sonnet 4.5 / Haiku 4.5; no Canada option found | https://platform.claude.com/docs/en/build-with-claude/data-residency | LLM residency | Assume US or global inference; do not claim Canadian processing | Disclosure text states cross-border processing | Squad models are 4.5 generation. PIA claims Canadian residency for DB only | SEARCH-EXCERPT |
| 10 | Anthropic HIPAA BAA availability | No primary source found | LLM | Ask Anthropic or Vapi for written BAA position | BAA or written refusal on file | None | UNVERIFIED |
| 11 | Gemini API paid tier: prompts and responses not used to improve products; prompt logging for abuse detection; Google says guaranteed ZDR and enterprise terms are via Vertex AI; grounding with Google Search keeps data 30 days | https://ai.google.dev/gemini-api/docs/zdr.md.txt | Server agents, marketing, `callSummary.ts` | Use paid tier or Vertex only; strip PHI before any Gemini call; disable Search grounding for PHI paths | Unit test that Gemini client rejects payloads containing detokenized fields; billing account shows paid tier | `geminiClient.ts`, `agentRunner.ts`, `callSummary.ts`, `geminiGrounding.ts` exist. Whether they receive PHI not audited by me | SEARCH-EXCERPT |
| 12 | Vertex AI Canadian regions (Montreal, Toronto) availability for Gemini | None found | Gemini residency | Confirm region list and model availability with Google | Region listed in written confirmation | Not configured | UNVERIFIED |
| 13 | ElevenLabs: HIPAA-eligible config needs Zero Retention Mode plus BAA, Enterprise only; EU residency exists; no Canadian region found | https://elevenlabs.io/docs/eleven-agents/legal/hipaa and https://elevenlabs.io/docs/overview/administration/data-residency | TTS (text spoken to carrier includes patient name) | Enterprise plan, ZRM, BAA, or switch TTS vendor/Vapi-native voice | BAA on file; ZRM confirmed per workspace | `11labs` voice on 4 agents | SEARCH-EXCERPT |
| 14 | Deepgram: BAA on request for eligible healthcare customers; model-improvement opt-out flag `mip_opt_out`; regional endpoints (Global, EU, Australia, India); no Canada endpoint found | https://deepgram.com/learn/deepgram-india-endpoint-now-generally-available and https://www.accountablehq.com/post/is-deepgram-hipaa-compliant-baas-phi-and-security-explained | STT (hears DOB, names, policy numbers) | Set `mip_opt_out=true` where Vapi allows; BAA; confirm Vapi passes the flag | Deepgram written confirmation; Vapi config shows opt-out | `nova-2` for all agents, no opt-out setting visible in config | SEARCH-EXCERPT |
| 15 | Twilio: BAA via account manager; eligible-services PDF lists Call Recordings and Storage, Call Transcription, Media Streams with conditions; third parties say HIPAA traffic limited to US area codes; Programmable Voice end-of-life date Dec 5, 2026 shown in the PDF | https://twilio.com/content/dam/twilio-com/global/en/other/hippa/pdf/HIPAA-Eligible-Services.pdf and https://www.twilio.com/docs/iam/twilio-editions/hippa | Telephony | BAA; HTTP auth on recording URLs; confirm Canadian numbers and Vapi-imported numbers are covered; plan for Programmable Voice change | BAA on file; test that recording URLs require auth | Twilio row blank in tracker. Recordings off at Vapi level; Twilio-side recording not checked | SEARCH-EXCERPT |
| 16 | Twilio Canadian data residency | None found | Telephony | Ask Twilio for region options | Written answer | Unknown | UNVERIFIED |
| 17 | Fly.io: pre-signed BAA, healthcare docs; sub-processors mostly US, some UK and Germany, none Canadian; healthcare page says covered under PHIPA | https://fly.io/healthcare/ , https://fly.io/legal/sub-processors/ , https://fly.io/docs/blueprints/going-to-production-with-healthcare-apps/ | Hosting, DB, backups | Sign BAA; keep PHI out of Tigris and off-site backups, or document the US touchpoint; encrypt volumes and snapshots | Written list of what leaves `yyz` (snapshots, logs, metrics); backup restore drill | `fly.toml` `primary_region='yyz'`. Backup location not verified by me | SEARCH-EXCERPT |
| 18 | Federal AIDA died: Bill C-27 lapsed on prorogation Jan 6, 2025; post-election status not checked by the search | https://gowlingwlg.com/en/insights-resources/articles/2025/privacy-and-cyber-bills-what-to-expect-post-election and https://fasken.com/en/knowledge/2025/01/prorogations-digital-impact | Federal AI law | None binding; use as design benchmark only | Counsel confirms no successor bill in force as of launch | No AIDA-based requirements in repo | SEARCH-EXCERPT (death in Jan 2025); UNVERIFIED (anything after Apr 2025, including reintroduction) |
| 19 | Canada voluntary generative-AI code of conduct (Sept 27, 2023); signatory lists partial | https://www.canada.ca/en/innovation-science-economic-development/news/2024/05/eight-organizations-to-join-canadas-voluntary-ai-code-of-conduct.html | Voluntary | Optional adoption of the six principles (accountability, safety, fairness, transparency, human oversight, validity) | Public statement of alignment if adopted | None | SEARCH-EXCERPT (existence, dates); UNVERIFIED (six principle names, current status) |
| 20 | Treasury Board Directive on Automated Decision-Making: governs federal institutions; page modified 2025-06-24; existing systems have until 2026-06-24 | https://www.tbs-sct.canada.ca/pol/doc-eng.aspx?id=32592 | Federal departments only; CollectRx not directly bound | Use as benchmark (impact assessment, human-in-loop levels). Relevant only if a federal customer buys the product | None required | None | SEARCH-EXCERPT. Whether vendors are bound: UNVERIFIED (no source found; I infer no) |
| 21 | Ontario Bill 194 (Strengthening Cyber Security and Building Trust in the Public Sector Act, 2024) enacted as S.O. 2024 c.24; Schedule 1 Enhancing Digital Security and Trust Act covers public sector entities (FIPPA/MFIPPA institutions, children's aid societies, school boards); AI duties apply in prescribed circumstances by regulation | https://www.ontario.ca/laws/statute/s24024 and https://www.mccarthy.ca/en/insights/blogs/techlex/ontario-bill-194-strengthening-cyber-security-and-building-trust-in-the-public-sector | Public sector; private dental practices not directly covered | None directly. If a customer is a public body (hospital-based dental clinic, public health unit), they may flow AI-disclosure/oversight terms into contracts | Customer-type flag at onboarding | No customer-type flag found | SEARCH-EXCERPT. Royal Assent date and in-force dates: UNVERIFIED |
| 22 | Quebec Law 25 s.12.1: decision based exclusively on automated processing must be notified; person may ask for PI used, reasons and principal factors, and submit observations to a human who can review; reported in force Sept 22, 2023 | Quebec private-sector Act (statute not opened); secondary: https://www.mccarthy.ca/en/insights/blogs/techlex/key-operational-considerations-ahead-major-law-25-entry-force-phase | Quebec practices and patients | If any exclusively-automated decision about an individual is made (e.g., write-off, patient-balance routing, eligibility estimate shown to patient), notify and offer human review. Carrier-claim follow-up calls are likely not decisions about individuals | Decision inventory; if any qualify, notice text and a human-review queue; test that review request reaches a person | `docs/compliance/Quebec-Law25-PIA.md` says ADM "yes" for estimates but no notice or review mechanism found in code (not exhaustively searched) | SEARCH-EXCERPT |
| 23 | Law 25 cross-border communication needs a PIA and written agreement (as stated by repo) | `Collect-RX-main/docs/compliance/Quebec-Law25-PIA.md` section 3.2 | Quebec data sent to US vendors | PIA covering Vapi, Twilio, Anthropic, ElevenLabs, Deepgram, Google; agreements | Signed PIA; agreements on file | PIA is draft, unsigned, and predates the current provider list (Gemini, Deepgram not named) | VERIFIED (repo text); statutory section number UNVERIFIED (repo cites "Section 17"; real citation should be checked by counsel) |
| 24 | AI-caller disclosure: CRTC proceeding Notice 2026-132 reviewing Unsolicited Telecommunications Rules; AI-voice content of the notice not confirmed | https://www.m3aawg.org/sites/default/files/doc_files/m3aawg-crtc-2026-132-comments-july-24-2026.pdf (intervention, excerpt) | Every call | Keep opening disclosure of automation, practice, callback, recording; log evidence per call | Transcript sample for 100% of test calls shows disclosure within first utterance by Claims_Agent | `Claims_Agent.firstMessage` has it (line ~226). IVR_Navigator silent by design. Hold_Sentinel silent. A human who answers while Claims_Agent is in handoff delay may hear nothing; first-utterance timing not tested by me | VERIFIED (repo firstMessage text); SEARCH-EXCERPT (CRTC proceeding exists); UNVERIFIED (what it requires) |
| 25 | If the transfer to practice staff happens in Hold Sentinel mode, Claims_Scribe listens to the rep | `CLAUDE.md` | Recording and transcription notice | Disclose that a transcribing assistant is listening when staff talks to the rep | Script covers it | `firstMessage` mentions recording. Claims_Scribe script not located in squad config | VERIFIED (CLAUDE.md); status UNVERIFIED |
| 26 | ISO/IEC 42001:2023 (AI management system), published Dec 18, 2023; reported certifications for AWS (Nov 2024), Anthropic (Jan 2025), Microsoft (Jul 2025) | https://blog.rsisecurity.com/what-is-the-difference-between-iso-42001-and-iso-27001/ (secondary) | Standards bar | Ask each vendor for certificate and scope; adopt AIMS-lite (policy, risk register, impact assessment, oversight, incident process) | Vendor certificates on file with scope statements | No AI policy or risk register in `docs` | SEARCH-EXCERPT |
| 27 | ISO/IEC 27001:2022 and SOC 2 | https://verifywise.ai/de/ai-governance-library/standards-and-certifications/iso-27001-information-security (secondary) | Vendors and CollectRx | Collect SOC 2 Type II reports and ISO certificates from Vapi, Twilio, Fly.io, Deepgram, ElevenLabs, Anthropic, Google; map CollectRx controls to them | Reports under NDA in DMS, reviewed dates within 12 months | `docs/compliance` has no SOC 2 mapping | SEARCH-EXCERPT (27001 facts); UNVERIFIED (each vendor's current report status) |
| 28 | NIST AI RMF 1.0 (Jan 26, 2023; GOVERN, MAP, MEASURE, MANAGE) and Generative AI Profile NIST AI 600-1 | NIST (primary not opened) | Voluntary benchmark | Adopt as risk-register template | Risk register with owner per function | None | SEARCH-EXCERPT (RMF 1.0); UNVERIFIED (AI 600-1, no result returned) |
| 29 | PHI never in Vapi metadata; ephemeral variables only | `Collect-RX-main/docs/compliance/PHI-VAPI-BOUNDARY.md`, `src/vapi/client.ts` | Vapi and all downstream | Keep tests that metadata has UUID only | Contract test on `initiateCall()` payload | Present in code comments and doc. Variables like `practice_tax_id` also ride in `assistantOverrides` | VERIFIED |
| 30 | Recording off, transcripts still possible | `src/vapi/client.ts` lines ~397-403 | Vapi | Also set transcript/summary storage off or move to ZDR | Post-call API fetch returns no transcript | Only `recordingEnabled:false` set | VERIFIED (code); vendor behavior UNVERIFIED |

## Strictest-common-denominator design notes (inferences, not sourced)

- Treat all providers as US-processing. No Canadian region was confirmed for Vapi, Anthropic, Twilio, ElevenLabs, Deepgram or Gemini; do not claim Canadian processing of voice or PHI. Only Fly `yyz` compute is claimed.
- ZDR vs HIPAA mode choice at Vapi is a fork that changes post-call analytics. Decide before relying on `analysisPlan` outputs.
- Data minimization is the strongest control available without vendor cooperation: spoken PHI should be the minimum a carrier needs (name, DOB, policy), nothing more.
- Adopt ISO 42001 / NIST AI RMF structure internally (policy, risk register, impact assessment, human oversight, incident log) because AIDA is dead and no binding federal private-sector AI law was found.

## (2) Vendor due-diligence checklist

For each of Vapi, Twilio, Fly.io, Anthropic (and Vapi's resale of it), ElevenLabs, Deepgram, Google Gemini:

- [ ] Signed DPA on file, version and date recorded in `docs/compliance/VENDOR-AGREEMENTS.md`
- [ ] BAA or PHIPA-equivalent language, or written statement it is not offered
- [ ] Current sub-processor list saved, with subscription to change notices
- [ ] Data locations by data class: audio, transcript, summary, logs, metadata, backups
- [ ] Retention default and ZDR availability, for the exact model/plan in use
- [ ] Training on customer data: default state and contractual prohibition
- [ ] Which party holds the contract with the model provider (CollectRx key vs Vapi-managed key)
- [ ] Breach notification window in hours
- [ ] Deletion on termination and on request, with proof
- [ ] SOC 2 Type II report and ISO 27001 certificate, scope covers the service used
- [ ] ISO 42001 certificate where the vendor supplies AI
- [ ] Right to audit or attestation substitute
- [ ] Law enforcement / foreign-access disclosure policy (US CLOUD Act exposure)
- [ ] Notice period for provider or model changes (Vapi can swap defaults)
- [ ] Evidence that Canadian carrier calls and numbers are in scope of the HIPAA/PHI offering
- [ ] CI check that squad config providers match the approved list

## (3) Questions for counsel

1. Is a US-processed voice/LLM chain acceptable under PHIPA, PIPEDA and Law 25 for dental claim data, and what notice and consent wording do practices need?
2. Is CollectRx an agent or a service provider under PHIPA for each practice, and does that change who signs vendor agreements?
3. Does Quebec s.12.1 apply to any CollectRx output (patient estimates, balance routing) and what notice and review process is sufficient?
4. Do carrier provider-line calls fall under the CRTC automated-call rules, and does Notice 2026-132 change the AI disclosure wording?
5. Should the first utterance on a human answer be spoken before handoff completes, and what if the carrier rep hangs up during the silent handoff gap?
6. Is a two-party recording/transcription notice at the start of the live portion sufficient, including when practice staff are on the call (Hold Sentinel mode)?
7. Is Vapi's BAA/DPA enough, or do we need direct agreements with Anthropic, ElevenLabs, Deepgram?
8. Is a Law 25 PIA required per vendor, and who is the named privacy officer to sign?
9. Is there a successor federal AI bill after AIDA lapsed, and does any provincial AI law apply to private dental practices?
10. If a public-sector customer (Ontario Bill 194 entity) signs, what flow-down terms will they require?
11. Is the CASL/CRTC lane analysis in `REGULATORY-LANES.md` still correct given AI voice?

## (4) Primary pages a human must read in full

None of these were opened by me (sandbox DNS block). Read each directly.

- Vapi HIPAA: https://docs.vapi.ai/security-and-privacy/hipaa
- Vapi ZDR: https://docs.vapi.ai/security-and-privacy/zero-data-retention
- Vapi trust center, DPA, sub-processors: https://security.vapi.ai/
- Twilio HIPAA eligible services PDF and HIPAA edition page: https://twilio.com/content/dam/twilio-com/global/en/other/hippa/pdf/HIPAA-Eligible-Services.pdf , https://www.twilio.com/docs/iam/twilio-editions/hippa
- Fly.io healthcare, compliance, sub-processors, healthcare blueprint: https://fly.io/healthcare/ , https://fly.io/compliance , https://fly.io/legal/sub-processors/ , https://fly.io/docs/blueprints/going-to-production-with-healthcare-apps/
- Anthropic Commercial Terms, DPA, API data retention page, data residency: https://platform.claude.com/docs/en/build-with-claude/data-residency (plus Anthropic privacy center, URL not confirmed)
- Google Gemini API ZDR and Vertex data governance: https://ai.google.dev/gemini-api/docs/zdr.md.txt , https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance
- ElevenLabs HIPAA and data residency: https://elevenlabs.io/docs/eleven-agents/legal/hipaa , https://elevenlabs.io/docs/overview/administration/data-residency
- Deepgram data privacy and BAA pages (URL not found in search results)
- Ontario Bill 194 statute: https://www.ontario.ca/laws/statute/s24024
- TBS Directive on Automated Decision-Making: https://www.tbs-sct.canada.ca/pol/doc-eng.aspx?id=32592
- Quebec Act respecting the protection of personal information in the private sector, s.12.1 and cross-border provisions (official consolidated text, URL not retrieved)
- CRTC Notice of Consultation 2026-132: https://www.crtc.gc.ca/eng/archive/2026/2026-132.htm (link from `REGULATORY-LANES.md`, not opened)
- Parliament LEGISinfo for Bill C-27 and any successor AI bill (not searched)
- ISO/IEC 42001:2023, ISO/IEC 27001:2022, NIST AI RMF 1.0 and NIST AI 600-1 (iso.org, nist.gov)

## Repo doc hygiene issues found

- `Quebec-Law25-PIA.md` still lists patient payment collection and Stripe links as in scope, contradicting CLAUDE.md product boundary.
- `PHI-VAPI-BOUNDARY.md` says "Closed (Option B)" but all legal-control checkboxes are open.
- `Vendor_DPA_Review_Checklist.md` has duplicate copy "Vendor_DPA_Review_Checklist 2.md"; several other " 2" / " 3" duplicate files exist in `docs/compliance/`.
