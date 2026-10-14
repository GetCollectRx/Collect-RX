# Evidence log: policy gap research, read 2026-10-13

Status: research record, not legal advice, not reviewed by a lawyer. Scope: five gaps in priority order (CRTC 2026-132; IPC Ontario AI scribes; RCDSO and Dentistry Act; FSRA billing agents; vendor residency and sub-processors). No vendor, insurer or regulator was contacted. No account was created.

## Method and tag definitions

- Reads were made with a web fetch tool that returns text extracted by a summarizing model, not the raw page DOM. Quotations below are therefore as returned by that extraction and were not confirmed character-for-character against the page. For this reason no item is tagged VERIFIED in this log. Every quotation is tagged EXCERPT.
- EXCERPT: the primary URL was reached and the quoted span (under 15 words) was returned from it.
- UNVERIFIED: the primary page was not reached, or the page did not contain the requested text.
- Paraphrases are marked "(paraphrase)" and are not quotations.
- Read date: 2026-10-13 (the date of this session). The filename carries the 2026-10-14 date given in the brief.
- Quotations were chosen to contain no dash characters.
- Upgrade path: re-read each EXCERPT in a browser session (Claude in Chrome or the founder's browser) to convert to VERIFIED. The entries marked UNVERIFIED are the priority.

---

## G1 CRTC Notice of Consultation 2026-132

URL https://crtc.gc.ca/eng/archive/2026/2026-132.htm (PDF: https://www.crtc.gc.ca/eng/archive/2026/2026-132.pdf)
Read 2026-10-13. Page "date modified" returned: 2026-06-11.

- EXCERPT: "The Commission will accept interventions that it receives on or before 27 July 2026."
- EXCERPT: "Deadline for submission of replies: 11 August 2026"
- Decision or outcome on the page: none stated. The page is the launch notice.
- Outcome search: https://crtc.gc.ca/eng/whatsnew/releases2026.htm returned monthly headings only, with no individual release titles. It did not reference 2026-132 or the Unsolicited Telecommunications Rules. This page is therefore not sufficient to confirm the absence of a decision.
- A search returned CRTC Decision 2026-140 (https://crtc.gc.ca/eng/archive/2026/2026-140.htm, 18 June 2026, "Expansion of network-level blocking framework"). It does not mention 2026-132. It is not a decision on the consultation.
- Content of the consultation questions (AI voice within the ADAD definition, non-live caller disclosure, 10-second message start, healthcare facility definition): carried from the prior 2026-10-13 log (CRTC-UTR-CARRIER-AND-SALES-CALLS.md, W1). Not re-read in this session.

Tags: Notice EXCERPT. Outcome UNVERIFIED.

---

## G2 Information and Privacy Commissioner of Ontario: AI scribes

Primary document: "AI Scribes: Key Considerations for the Health Sector", dated January 2026.
URL https://www.ipc.on.ca/en/media/6177/download?attachment= (located through a search of ipc.on.ca)
Read 2026-10-13. Document date returned: January 2026.

- EXCERPT (consent): "Therefore, consent of individuals would generally be required."
- EXCERPT (notice): "Custodians must be transparent about their personal health information practices."
- EXCERPT (partial sentence, source truncated): "Custodians who procure AI systems should have a robust service agreement in place"
- Data residency: section 4.6 was reported to state that PHIPA does not prevent personal health information from being stored outside Ontario or Canada, and that custodians remain responsible for protecting it. Paraphrase; no quotation captured. Tag EXCERPT (paraphrase).
- Patient authorization as a separate requirement: not identified in the text reached. The document was truncated before the consent section ended. Status: UNVERIFIED for the full consent section.

Not the primary guidance: https://www.ipc.on.ca/en/media-centre/past-presentations/ai-scribes-health-sector-guidance-ontarios-information-and-privacy-commissioner (dated May 29, 2026). It is a summary of a session about the guidance and states no recommendations.

Not found: the IPC Resources index (https://www.ipc.on.ca/en/resources-and-decisions) lists no AI-scribe guidance on its own page. The search-based route above is the one that reached the document.

Tags: Guidance EXCERPT. Full consent section UNVERIFIED.

---

## G3 RCDSO and Dentistry regulation

### G3a RCDSO Guideline "Dental Recordkeeping"

URL https://cdn.agilitycms.com/rcdso/pdf/guidelines/RCDSO_Guidelines_Dental_Recordkeeping.pdf
Read 2026-10-13. Approval shown: November 2019 (approved by Council). Section: "Retention of Dental Records".

- EXCERPT: "Dentists may store archived records off-site."
- EXCERPT: "An electronic copy of claim forms on a properly backed-up system is acceptable."
- Third-party storage: the same section was reported to say that moving patient records to a third-party storage facility outside the dentist's control requires patient consent under privacy legislation. Paraphrase only; sentence exceeded 15 words. Tag EXCERPT (paraphrase).

Note: the RCDSO guideline page (https://www.rcdso.org/en-CA/Resources/Guidelines-and-Standards) returned a fetch error on two attempts. The PDF is the document reached.

### G3b Dentistry Act regulation, R.R.O. 1990, Reg. 201

URL https://www.ontario.ca/laws/regulation/900201 (also tried https://www.ontario.ca/laws/regulation/900201/v30)
Read attempted 2026-10-13. Both returned an e-Laws page that requires JavaScript and contained no regulation text. No currency date was visible.

Tags: UNVERIFIED. Record-keeping and third-party provisions of Reg. 201 are NOT reached. The 2026-10-13 log's statement that the underlying regulation was not read still holds.

---

## G4 FSRA: billing agents and adjusters acting for practices

### G4a FSRA individual adjuster licence

URL https://www.fsrao.ca/licensing/individual-adjuster/apply-new-insurance-adjuster-licence
Read 2026-10-13. No page date shown.

- EXCERPT: "Public adjusters and independent adjusters need to be licensed by FSRA."
- Billing agents, third-party agents, or representation of health service providers: not mentioned on this page.

### G4b FSRA health service provider licence

URL https://www.fsrao.ca/consumers/health-service-providers/about-fsra-licence
Read 2026-10-13. No page date shown.

- EXCERPT: "authorization to receive payment directly from auto insurers" (phrase from a longer sentence)
- EXCERPT: "this licence is mandatory"
- Billing agents, third-party agents, or representatives acting for a provider: the page does not mention these. It does not say whether a provider can use one to receive direct payment.

Tags: G4a EXCERPT. G4b EXCERPT. Question "may a billing agent act for an HSP" NOT FOUND on either page read.

---

## G5 Vendor data residency and sub-processors

### G5a Vapi

- Data residency, EU region: https://docs.vapi.ai/security-and-privacy/eu-region (read 2026-10-13, no page date shown)
  - EXCERPT: "build and run voice agents hosted in the European Union."
  - Each organization is tied to one region, and "every resource (assistants, tools, phone numbers, SIP trunk credentials) lives with it." (EXCERPT, partial quotation of a list) The page names no default US storage location and no sub-processors.
- Data flow: https://docs.vapi.ai/security-and-privacy/data-flow (read 2026-10-13, no page date shown)
  - EXCERPT: "Supported: OpenAI, Anthropic, Azure OpenAI, Google Gemini, Groq, DeepSeek" (providers for bring-your-own-key LLMs)
  - EXCERPT: "call recordings and call logs are uploaded to your infrastructure" (applies when custom bucket storage is configured)
  - EXCERPT (paraphrase): orchestration models process data in real time and run on Vapi infrastructure.
- HIPAA page (read in the 2026-10-13 session, re-read 2026-10-13): https://docs.vapi.ai/security-and-privacy/hipaa
  - EXCERPT: "When enabling HIPAA compliance, only HIPAA compliant providers may be chosen."
  - No residency or sub-processor statement on this page.
- Sub-processor list: the Vapi Trust Center (https://security.vapi.ai/) was identified in a search and was NOT reached.

Tags: EXCERPT for the pages above. Vapi sub-processor list UNVERIFIED.

### G5b Twilio

- Sub-processors: https://www.twilio.com/legal/sub-processors (read 2026-10-13, page "Last Updated: September 2026")
  - EXCERPT: "Customer Content is stored and processed in the region selected (Ireland or Australia)." Applies to Regional Twilio for supported products.
  - EXCERPT: "will continue to be processed in the United States" (for account data outside Customer Content)
  - Exceptions: "Exceptions will occur as necessary to investigate issues of fraud and abuse."
  - Sub-processor locations reported as: AWS "USA*, EU, AU"; Google (Segment and Twilio Engage) "USA or EU (Zurich & London) as selected by Customers". Quotation marks indicate table text as returned; EXCERPT.
  - Transfer Impact Assessments: reported as performed for sub-processor transfers that require them. Paraphrase.
- DPA: https://www.twilio.com/en-us/legal/data-protection-addendum (read 2026-10-13, page "last updated April 9, 2026")
  - EXCERPT: "Telecommunications providers used by Twilio to provide the Services are not considered sub-processors."
- The sub-processor page text beyond 100,000 characters was not read. The full list was therefore not reviewed.

Tags: EXCERPT. The full sub-processor table is partially read.

### G5c Deepgram

- Data privacy: https://developers.deepgram.com/trust-security/data-privacy-compliance (read 2026-10-13, no page date shown)
  - EXCERPT: "Deepgram provides an EU-specific endpoint at api.eu.deepgram.com"
  - EXCERPT: "the think step runs on the third-party provider's infrastructure" (voice agent with a third-party LLM)
  - EXCERPT: "should confirm that provider's residency and processing guarantees independently" (same context)
  - Australian residency is also stated for AU customers (EXCERPT: "It runs exclusively on Australian infrastructure.")
  - No sub-processor list is linked on this page.
- Deepgram Trust Center (https://deepgram.com/trust-center) and security page (https://deepgram.com/security-and-compliance) returned fetch errors or were not read.

Tags: EXCERPT. Deepgram sub-processor list UNVERIFIED.

### G5d Google Gemini

- Requested URL https://cloud.google.com/gemini/docs/discover/data-governance returned a 404. Not usable.
- Data terms: https://cloud.google.com/terms/data-residency (read 2026-10-13, "Last modified September 8, 2026")
  - Gemini is listed in the "General" data location section and the "AI/ML Data Location" section. Listed products include "Gemini Enterprise (except when certain features are enabled)" and "Gemini for Google Cloud (Gemini Code Assist only)".
  - Specific storage or processing regions for Gemini: not named on this page. The page points to Gemini Enterprise locations documentation.
- Sub-processor list for Google Cloud: NOT read.

Tags: EXCERPT for the data terms page. Gemini storage regions UNVERIFIED. Google sub-processor list UNVERIFIED.

---

## Summary table

| Item | Primary URL | Read (2026-10-13) | Key finding as read | Tag |
|---|---|---|---|---|
| G1 CRTC 2026-132 notice | crtc.gc.ca/eng/archive/2026/2026-132.htm | Yes | Interventions 27 July 2026; replies 11 August 2026 | EXCERPT |
| G1 CRTC 2026-132 outcome | crtc.gc.ca releases 2026 | Headings only | No 2026-132 decision seen; page incomplete | UNVERIFIED |
| G2 IPC AI scribes guidance (Jan 2026) | ipc.on.ca media/6177 | Yes, partial | Consent "generally be required"; notice duty; residency paraphrase | EXCERPT |
| G2 IPC consent section complete | same | Truncated | Full consent and authorization text not reached | UNVERIFIED |
| G3a RCDSO Dental Recordkeeping (Nov 2019) | rcdso cdn PDF | Yes | Off-site archive permitted; third-party storage needs consent (paraphrase) | EXCERPT |
| G3b Dentistry Act Reg. 201 | ontario.ca/laws/regulation/900201 | No (JavaScript page) | Record-keeping text not reached | UNVERIFIED |
| G4a FSRA adjuster licence | fsrao.ca individual-adjuster page | Yes | Adjusters need FSRA licence; billing agents not mentioned | EXCERPT |
| G4b FSRA HSP licence | fsrao.ca HSP page | Yes | Licence needed for direct payment; billing agents not mentioned | EXCERPT |
| G5a Vapi residency | docs.vapi.ai eu-region, data-flow, hipaa | Yes | EU region exists; no default US location or sub-processor list stated | EXCERPT |
| G5a Vapi sub-processors | security.vapi.ai | No | Not reached | UNVERIFIED |
| G5b Twilio residency | twilio.com/legal/sub-processors (Sept 2026) | Yes, partial | Regional storage Ireland or Australia; other data in US | EXCERPT |
| G5c Deepgram residency | developers.deepgram.com data privacy | Yes | EU endpoint; AU residency; third-party LLM "think" step outside Deepgram | EXCERPT |
| G5c Deepgram sub-processors | deepgram.com trust or security pages | No | Not reached | UNVERIFIED |
| G5d Gemini data location | cloud.google.com/terms/data-residency (Sept 8, 2026) | Yes | Gemini listed by product; specific regions not named | EXCERPT |
| G5d Gemini storage regions and Google sub-processors | Gemini docs (404); Google sub-processor list | No | Not reached | UNVERIFIED |

Counts: EXCERPT 9. UNVERIFIED 6. VERIFIED 0 (no item was confirmed against raw page text; see Method).
