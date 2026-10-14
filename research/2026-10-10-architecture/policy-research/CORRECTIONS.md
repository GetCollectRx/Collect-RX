# L1 corrections: primary-source verification pass

Date: 2026-10-13. Author: Claude (legal and policy workstream), for Khalid. Status: research record, not legal advice, not reviewed by a lawyer. Positions remain the founder's to sign in INTERPRETATION-AND-RISK-REGISTER.md.

## How this pass was done

- No Cowork report (policy-verification-report.md) or new reviewer response was supplied. This pass therefore did the Cowork batches directly: primary pages were opened in the founder's Chrome through Claude in Chrome (the sandbox proxies return 403 for ontario.ca, Justice Laws, CRTC, FSRA and Legisquebec; the browser does not).
- Every quotation relied on below is recorded verbatim, with URL and the page's own currency statement, in EVIDENCE-LOG-2026-10-13.md (entries E1 to E21). That log is the source of truth for this pass.
- Tags: VERIFIED = primary text read this session. EXCERPT = search snippet, secondary source, or a primary document whose words reached me only through a summarizing fetch tool. UNVERIFIED = not read. The legacy tag SEARCH-EXCERPT in the six source files means EXCERPT.
- Section numbers for the CRTC Unsolicited Telecommunications Rules (UTR) were confirmed from the page's ordered-list structure, not inferred, and match the internal cross references in the text and in Notice 2026-132 (for example "Part IV, section 4.d").

## A. Corrections that change a position or a control (read these first)

| # | Earlier statement | What the primary text says | Tag | Effect |
|---|---|---|---|---|
| A1 | ARCHITECTURE-PROPOSAL 17.6 design change 3: the product's 08:00 to 17:00 Eastern window "is stricter and stays" | UTR Part IV s.4(b): non-solicitation ADAD calls "are restricted to 9:00 a.m. to 9:30 p.m. on weekdays ... the hours refer to those of the person receiving the telecommunication" (E1). 08:00 is earlier than 09:00, so the current window is NOT stricter at the start of the day | VERIFIED | If the ADAD rules apply to carrier calls (register R10, open), calls placed 08:00 to 08:59 recipient local time fall outside the permitted window. Founder decision D1. Code location: `isWithinCallWindow()` in `src/carriers/adapter.ts` (hour >= 8). Not changed in this workstream because three open PRs (#121, #122, #124) modify the same file |
| A2 | ADAD identification requires "a mailing address" (TR#8, COWORK C3, SYNTHESIS F8) | Part IV s.4(d): "an electronic mail address or postal mailing address and a local or toll-free telecommunications number" (E1). Either address satisfies it; the 2014 change is confirmed by Notice 2026-132 ("expanding the mailing address requirement to include either a postal or email address") (E2) | VERIFIED | The cheapest fix to the opener is an email address plus the callback number, not a street address. Also: the message must begin with "a brief description of the purpose", and be repeated at the end if the message exceeds 60 seconds |
| A3 | Collect-RX-main/CLAUDE.md: disclosure "is mandatory within 10 seconds of a live representative answering" under "CRTC UTR Part IV Rule 4" | Part IV s.4 contains no 10 second disclosure deadline. The only 10 second figure is s.4(h): equipment must disconnect "within ten (10) seconds of the person receiving the telecommunication hanging up" (E1). A 10 second start requirement appears only as a consultation question (2026-132 Q14(a)) (E2) | VERIFIED | Doc correction on the default branch (separate docs PR). `crtc-disclosure-decision.md` already states this correctly |
| A4 | Vapi ZDR "is a paid add-on" (RISK-REGISTER-REVIEW-RESULT X5; VG#3 "about $1,000" per month) | Vapi docs: "ZDR does not require a separate purchase." HIPAA mode is "a paid compliance add-on" (price not shown) (E18) | VERIFIED (public docs, not a contract) | The "no vendor add-on spend" constraint does not block ZDR. ZDR stops Vapi storing recordings, transcripts, summaries and structured outputs; outcomes can still reach CollectRx through the end-of-call-report webhook if configured before enabling. Founder decision D2. Still needs written confirmation per VAPI-QUESTIONS rule |
| A5 | "Recording disabled per call" treated as limiting Vapi storage | Vapi docs: "By default, Vapi records your calls and stores logs and transcriptions." (E18) `recordingEnabled:false` addresses recording only; logs and transcripts remain stored under default settings | VERIFIED | Strengthens TR#2 and the pitch boundary: never say "we do not record" without stating transcripts and logs exist at the vendor |
| A6 | CollectRx's own AI sales calls (`src/server/marketing/vapiSalesCall.ts`) treated as needing only a DNCL scrub (REGULATORY-LANES Lane 3) | UTR Part IV s.2: no telemarketing via an ADAD "unless express consent has been provided by the consumer"; Part III s.28: no telemarketing "to any emergency line or healthcare facility"; Part IV s.4(a) also bars non-solicitation ADAD calls to "healthcare facilities" (E1). "Healthcare facility" is undefined today; the proposed definition expressly includes "doctors' offices and physiotherapy, chiropractic, or acupuncture clinics" (E2). Whether a synthesized-voice agent is an ADAD is an open consultation question (2026-132 Q2) | VERIFIED (text); application UNVERIFIED | AI voice sales calls to dental offices are the highest-risk marketing activity found. The current route places them on demand with no express-consent record, no healthcare-facility check, no automation disclosure and no hours check. Recommend: off by default behind a fail-closed gate (L4 PR). Founder decision D3 |
| A7 | CASL footer requirements: "Clear sender identity ... Unsubscribe mechanism" (docs/marketing/CASL-OUTREACH.md) | SOR/2012-36 s.2(1)(d): every commercial electronic message must set out "the mailing address, and either a telephone number providing access to an agent or a voice messaging system, an email address or a web address" (E4). CASL s.11(3): unsubscribe effective "no later than 10 business days" (E3) | VERIFIED | `emailLayout.ts` footer has no mailing address. Gap recorded in L2a; policy in docs/legal-policy/07 |
| A8 | Quebec penalties "s.91 ($25M or 4%)" | s.91: "a fine of $5,000 to $100,000 in the case of a natural person and, in all other cases, of $15,000 to $25,000,000, or, if greater, the amount corresponding to 4% of worldwide turnover for the preceding fiscal year" (E16) | VERIFIED (current consolidation, "À jour au 12 août 2026") | Range confirmed; minimums added |
| A9 | O. Reg. 329/04 s.6.4 annual report has "four category counts" (SYNTHESIS H5, HP#4) | s.6.4(1) lists five: stolen, lost, used without authority, disclosed without authority, and "collected by the custodian by means of the electronic health record without authority" (E10) | VERIFIED | Export should support five categories; the fifth will normally be zero for CollectRx tenants |
| A10 | PIPEDA reform "AIDA died; post-election status not checked" (VG#18) | LEGISinfo: Bill C-36, "An Act to enact the Protecting Privacy and Consumer Data Act, to amend the Personal Information Protection and Electronic Documents Act ...", "At second reading in the House of Commons", first reading June 15, 2026 (E14). PIPEDA consolidation also lists an amendment not in force, 2026, c. 3, s. 389, adding data mobility (s.10.4 to 10.6) (E7) | VERIFIED | Watch list items W3 and W4 |
| A11 | Anthropic models in the squad are current | Anthropic docs label "Claude Sonnet 4.5 (deprecated)"; inference_geo is unsupported on Sonnet 4.5 and Haiku 4.5 (400 error) (E19) | VERIFIED | `vapi-squad-config.json` uses claude-sonnet-4-5-20250929. Vendor policy: track model deprecation as a vendor change event |

## B. Claims confirmed (tag raised to VERIFIED)

| Claim (source file row or Cowork claim) | Primary text | Evidence |
|---|---|---|
| COWORK C1: hours 9:00 to 21:30 weekdays, 10:00 to 18:00 weekends, recipient local time | Part III s.23 (telemarketing); Part IV s.4(b) (non-solicitation ADAD) | E1 |
| COWORK C2 / TR#9: disconnect within 10 seconds | Part IV s.4(h) | E1 |
| COWORK C3 / TR#8 (corrected wording, see A2) | Part IV s.4(d) | E1 |
| COWORK C4 / TR#7: ADAD rules apply without solicitation | Part IV s.4 opening words; 2026-132 Background | E1, E2 |
| COWORK C5 / TR#12: 2026-132 is a Notice of Consultation dated 11 June 2026, file 1011-NOC2026-0132, interventions 27 July 2026, replies 11 August 2026 | 2026-132 header | E2 |
| TR#5: Part II DNCL, Part III Telemarketing, Part IV ADAD | UTR Part headings | E1 |
| TR#6: telemarketing means solicitation; Telemarketing Rules do not apply to non-solicitation calls "including ... account collection" | Part I definitions; Part III s.6 | E1 |
| TR#11: DNCL Rules do not apply to telemarketing to a business consumer; internal do-not-call list kept 3 years and 14 days, updated within 14 days | Part II s.2; Part III ss.8 to 12 | E1 |
| VG#24 / TR#12: 2026-132 addresses AI voice | Q2 (ADAD definition and AI), Q10 (disclose non-live caller), Q11 (non-solicitation ADAD use), Q12 to Q14 (contact info, identify both service provider and client, 10 second start) | E2 |
| COWORK S1: CEM needs express or implied consent; unsubscribe alone insufficient | CASL s.6(1)(a),(b) and s.6(2) | E3 |
| COWORK S2: CASL penalty maximums | s.20(4): $1,000,000 individual; $10,000,000 any other person | E3 |
| CASL does not apply to interactive two-way voice between individuals or voice recordings to a telephone account | s.6(8)(a),(c); Telecommunications Act s.41(2) leaves those to the CRTC | E3, E6 |
| UTR administrative monetary penalties | Telecommunications Act s.72.01: up to $1,500 individual, up to $15,000 corporation per violation; s.72.03 each day separate | E6 |
| COWORK H2 / HP conclusion 3: dentistry is an RHPA Schedule 1 profession | RHPA Schedule 1 | E8 |
| HP#6: PHIPA s.10.1 audit log not in force | "On a day to be named by proclamation" note, e-Laws currency 2026-10-08 | E9 |
| COWORK I1 / IL#22 (first sentence): FSRA licence is required for direct payment from auto insurers for listed expenses | FSRA "About the FSRA Licence" | E12 |
| COWORK I2: independent and public adjusters need an FSRA licence; insurer staff adjusters do not | FSRA adjuster licence page | E12 |
| COWORK Q1: Quebec s.3.5 says "promptly", no 72 hours | P-39.1 s.3.5 | E16 |
| COWORK Q2: s.12.1 notice and observations to staff who can review | P-39.1 s.12.1 | E16 |
| COWORK Q3: s.17 PIA before communication outside Quebec, plus written agreement, also when entrusting a body outside Quebec | P-39.1 s.17 | E16 |
| PS#3 to PS#7, PS#13, PS#19 (Quebec rows): previously VERIFIED only against the 2021 enacting Act | Current consolidation read for ss.3.3 to 3.8, 12, 12.1, 13, 17, 18.3, 23, 91 | E16 |
| COWORK V1: Vapi HIPAA mode and ZDR mutually exclusive | Vapi HIPAA and ZDR pages | E18 |
| COWORK V2: HIPAA mode org-level, not settable via API | Vapi HIPAA page | E18 |
| COWORK V5: Anthropic inference_geo only "global" or "us" | Anthropic data residency page | E19 |
| COWORK V7: Fly.io lists no Canadian sub-processor | Fly sub-processors, last updated 2026-09-24 | E20 |
| PS framing: PIPEDA business contact exclusion | s.2 definition and s.4.01 | E7 |
| PHIPA ss.2 agent, 12(1) to (3), 13, 17, 18(3),(5),(6), 50(1), 72(1) to (3),(5),(8) re-read; O. Reg. 329/04 ss.6(1), 6.3, 6.4, 7 re-read | No change to earlier readings beyond A9 | E9, E10 |

## C. Claims contradicted or partly contradicted

| Claim | Status | Detail |
|---|---|---|
| VG#3 ZDR price | CONTRADICTED | See A4 |
| ARCHITECTURE 17.6 window "stricter" | CONTRADICTED | See A1 |
| CLAUDE.md "within 10 seconds" disclosure | CONTRADICTED | See A3 |
| COWORK V3 (Vapi Core 10 concurrent calls, $10 per line) | NOT CHECKED | Pricing page not read |
| COWORK V4 (Twilio 1 CPS) | NOT CHECKED | |
| COWORK V6 (no vendor offers Canadian region) | PARTIAL | Confirmed for Anthropic (E19), ElevenLabs default storage US with EU, India and Singapore isolated environments only (E21; Singapore added in L2 after a full read), Fly sub-processors (E20). Not read: Vapi regions, Twilio, Deepgram, Google |

## D. Still unverified after this pass (moved to the Cowork reading list in section E)

| Item | Why |
|---|---|
| RCDSO dental record retention (COWORK H3) | The PDF opened in Chrome but the PDF viewer would not accept navigation and curl is blocked. The retention sentences ("at least ten years from the date of the last entry"; claim forms "at least two years") reached me only through a summarizing fetch tool. Tag EXCERPT. Underlying Dentistry Act regulation not read |
| IPC Ontario AI scribe guidance (COWORK H1) | The IPC link is a file download; it triggered a browser download instead of a page view. Content not read. UNVERIFIED |
| CRTC 2026-132 outcome | No decision found on the CRTC 2026 releases page (short recent list). UNVERIFIED either way |
| FSRA position on third-party billing agents and insured authorization | Not found on the FSRA pages read. Open |
| OPC meaningful consent guidance, Quebec CAI PIA guidance, Alberta and BC collection licensing, ADP, ODSP, VAC, WSIB, TSSEA rates, CanLII (Aviva v. Catic) | Not attempted in this pass |
| Vapi pricing and concurrency, Twilio, Deepgram, Google Gemini terms | Not attempted in this pass |
| Ontario Consumer Protection Act, 2023 definitions | Not in force; not read |

## E. Cowork reading list (remaining), in the COWORK-VERIFICATION-PROMPT format

Paste into Cowork with the HARD RULES and OUTPUT FORMAT from COWORK-VERIFICATION-PROMPT.md.

```text
BATCH R1: DENTAL RECORDS
Pages:
 a. RCDSO Guidelines, Dental Recordkeeping (Approved by Council, November 2019): https://cdn.agilitycms.com/rcdso/pdf/guidelines/RCDSO_Guidelines_Dental_Recordkeeping.pdf , section "Retention of Dental Records" (page 12 per the contents list) and "Financial Records" (page 10).
 b. O. Reg. 547 under the Dentistry Act, 1991 (ontario.ca/laws), record-keeping and retention sections.
Claims to check:
 H3a Clinical and financial records must be kept for at least ten years from the date of the last entry.
 H3b Copies of dental claim forms must be kept for at least two years.
 H3c The retention period is set by regulation (give the section) and not only by the guideline.

BATCH R2: IPC ONTARIO
Pages:
 a. IPC "AI Scribes: Key Considerations for the Health Sector" (January 2026). The ipc.on.ca/en/media/6177/download link downloads a PDF; open it from the downloads folder.
 b. IPC guidance on electronic service providers and agents under PHIPA.
Claims to check:
 H1 The guidance says PHIPA collection, use and disclosure rules apply to AI tools and recommends restrictive treatment of vendor model training.

BATCH R3: CRTC OUTCOME
Pages: https://crtc.gc.ca/eng/8045/n2026.htm , the 2026-132 public record (1011-NOC2026-0132), and the CRTC decisions and regulatory policies lists for 2026.
Claims to check:
 C7 As of the date read, no decision or regulatory policy has been issued in the 2026-132 proceeding.

BATCH R4: VENDORS NOT YET READ
Pages: Vapi pricing and concurrency, Vapi trust center sub-processors, Twilio HIPAA eligible services and Canadian region statements, Deepgram data privacy and regional endpoints, Google Gemini API ZDR and Vertex regions (Montreal, Toronto).
Claims to check: V3, V4, V6 for each vendor not yet covered.

BATCH R5: FSRA
Pages: FSRA Automobile Insurance Claims Handling guidance; SABS invoice guideline; any FSRA statement on a provider's billing agent or representative contacting an insurer.
Claims to check:
 I3 FSRA requires written authorization from the insured for a provider's agent to discuss a SABS file (CONFIRMED, CONTRADICTED or NOT FOUND).
```

## F. Files changed in this PR

- CORRECTIONS.md (this file), EVIDENCE-LOG-2026-10-13.md (new).
- Addenda added to the top of: telecom-and-recording.md, private-sector-privacy.md, health-privacy.md, insurance-licensing-collection.md, vendors-ai-governance-standards.md. industry-statutes-stop-points.md has a one-line note (nothing in it was re-read).
- INTERPRETATION-AND-RISK-REGISTER.md: R7 and R10 updated with the text now read; R3 vendor facts updated. No row is signed or decided by this change.
- SYNTHESIS.md: section 0 item 4, section 3 F8, F9, F11, section 7, section 9, section 13 updated by an L1 note.
- RISK-REGISTER-REVIEW-RESULT.md: X5 note.
- VAPI-QUESTIONS.md: V2 and V3 marked as answered in public docs, written confirmation still required.
- ARCHITECTURE-PROPOSAL.md: correction note under 17.6.

## G. Open questions for the founder raised by this pass

- D1. Move the carrier call window start from 08:00 to 09:00 recipient local time now, or wait for your R10 reading? (Nothing is live, so the cost of moving now is only the code change.)
- D2. Plan the health route on Vapi ZDR (free per docs, no BAA) or HIPAA mode (paid, BAA, vendor storage)? They are mutually exclusive.
- D3. Turn off AI voice sales calls to dental offices until your marketing position is signed? The L4 gate does this by default.
- D4. Accept RCDSO ten years as the working minimum for practice-owned billing records even though the text is EXCERPT, pending Cowork batch R1?
