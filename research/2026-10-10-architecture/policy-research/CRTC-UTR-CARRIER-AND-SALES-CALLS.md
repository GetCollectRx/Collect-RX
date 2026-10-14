# L2b. CRTC Unsolicited Telecommunications Rules: carrier calls and sales calls

Date: 2026-10-13. Status: research record, not legal advice, not reviewed by a lawyer. Evidence: EVIDENCE-LOG-2026-10-13.md E1, E2, E6, E15. The UTR page is an amalgamation dated 2014-03-31; Notice 2026-132 confirms no change since 2014. Tags as in CORRECTIONS.md.

## Definitions that decide applicability (VERIFIED, UTR Part I)

- "Automatic Dialing-Announcing Device" or "ADAD": "any automatic equipment incorporating the capability of storing or producing telecommunications numbers used alone or in conjunction with other equipment to convey a pre-recorded or synthesized voice message to a telecommunications number".
- "Telemarketing": "the use of telecommunications facilities to make unsolicited telecommunications for the purpose of solicitation". "Solicitation": "the selling or promoting of a product or service, or the soliciting of money or money's worth, whether directly or indirectly and whether on behalf of another person."
- "Unsolicited telecommunication" is not defined.

## Are calls to insurers covered? (determined from text; no assumption)

| Question | Text | Answer from text | Tag |
|---|---|---|---|
| Are claim-status calls telemarketing? | Telemarketing requires "the purpose of solicitation"; Part III s.6: Telemarketing Rules do not apply to non-solicitation calls "including ... account collection" | No. Parts II and III do not apply to carrier claim-status calls | VERIFIED |
| Can the ADAD Rules apply without solicitation? | Part IV s.4: "A person using an ADAD to make unsolicited telecommunications where there is no attempt to solicit, shall comply with the following conditions" | Yes, if (1) the system is an ADAD and (2) the call is "unsolicited" | VERIFIED |
| Is a Vapi LLM voice agent an ADAD? | Definition covers equipment that dials stored or produced numbers and conveys a "synthesized voice message". 2026-132 Q2 asks whether the definition is "sufficient to capture ... artificial intelligence" | Unresolved. The text plausibly reaches it (automatic dialling plus synthesized voice); the CRTC treats the point as open | Text VERIFIED; application UNVERIFIED |
| Is a call to a carrier's provider line "unsolicited"? | Undefined | Unresolved. Carriers publish provider lines for these inquiries, which supports "not unsolicited"; the word is not defined | UNVERIFIED |
| Do business recipients change anything? | Part II s.2: DNCL Rules do not apply to business consumers. Part IV s.4 has no business exception | Business status does not remove Part IV s.4 | VERIFIED |
| Status of 2026-132 | Notice of Consultation, 11 June 2026, 1011-NOC2026-0132; interventions 27 July 2026; replies 11 August 2026 | Consultation; no decision found on the CRTC 2026 releases page | VERIFIED (notice); outcome UNVERIFIED |

## Obligation table (applies if the ADAD Rules apply; built as a floor regardless)

Groups: A = autonomous carrier calls; B = human-assisted (Hold Sentinel) carrier calls; C = CollectRx AI sales calls (see CASL-AND-OWN-MARKETING.md rows 9 to 15 for telemarketing duties).

| # | Obligation | Source | Groups | Required control | Acceptance test | Current-code status | Tag |
|---|---|---|---|---|---|---|---|
| 1 | No calls to emergency lines or healthcare facilities | UTR Part IV s.4(a) | A, B, C | Carrier number registry holds only insurer provider lines; sales calls to clinics blocked (C) | Dispatch to a number not in the carrier registry is refused | Carrier calls go to carrier numbers (`CARRIER_PHONE_MAP`); sales calls go to dental offices (GAP for C) | VERIFIED |
| 2 | Hours 9:00 a.m. to 9:30 p.m. weekdays, 10:00 a.m. to 6:00 p.m. weekends, recipient local time; stricter provincial activity hours apply | UTR Part IV s.4(b), (c) | A, B, C | Window = intersection of legal window and carrier staffed hours, in the recipient's local time zone | Unit tests: 08:30 Eastern refused; 09:00 Eastern allowed; Pacific line at 09:00 Eastern refused | `isWithinCallWindow()` allows Mon to Fri 08:00 to 17:00 America/Toronto. 08:00 to 08:59 is outside s.4(b). GAP (CORRECTIONS A1) | VERIFIED |
| 3 | Begin with a clear message identifying the person on whose behalf the call is made, a brief purpose description, an email or postal address and a local or toll-free number; repeat at end if message exceeds 60 seconds | UTR Part IV s.4(d) | A, B, C | Opener template includes practice name, purpose, practice callback number and an email address; repeat rule documented | Opener snapshot contains all four elements | Claims_Agent first message has practice name, callback number and purpose ("following up on a claim"); no email or postal address. Human-assisted mode: staff speak; no scripted identification found | VERIFIED |
| 4 | Display originating number or an alternate number where the originator can be reached | UTR Part IV s.4(e) | A, B, C | Use a number that rings back to the practice or a staffed CollectRx line | Callback to the displayed number reaches a person or voicemail | Single Vapi number (`getPhoneNumberId()`); inbound handling not found (TR#20). GAP | VERIFIED |
| 5 | No sequential dialling | UTR Part IV s.4(f) | A, B, C | Calls only to registry numbers | n/a | Met by design | VERIFIED |
| 6 | Disconnect within 10 seconds of the recipient hanging up | UTR Part IV s.4(h) | A, B, C | Measure in Twilio or Vapi logs | 20 of 20 test calls end within 10 s of far-end hangup | Not measured (TR#9) | VERIFIED |
| 7 | Contact details valid for 60 days after the call | UTR Part IV s.4(j) | A, B, C | Practice contact details versioned; offboarding keeps the callback route 60 days | Offboarded practice's number still routes for 60 days | Not present | VERIFIED |
| 8 | Due diligence defence: written policies, training, monitoring | UTR Part VII s.1(a) | All | docs/legal-policy/04 (AI use and call disclosure) | Policy exists, versioned | Present after this workstream (draft) | VERIFIED |
| 9 | Penalties | Telecommunications Act s.72.01 (up to $15,000 per violation for a corporation), s.72.03 (each day separate) | All | n/a | n/a | n/a | VERIFIED |

## What the consultation could change (2026-132)

| Question | Possible effect on CollectRx |
|---|---|
| Q2 AI within ADAD definition | If yes, Part IV s.4 clearly applies to carrier calls |
| Q10 disclose that the caller is not a live person (telemarketing) | Already product policy; would become mandatory for sales calls |
| Q11 regulate non-solicitation ADAD use at all | Could narrow or confirm application to carrier calls |
| Q12, Q13 contact info and naming both provider and client | May require naming CollectRx as well as the practice |
| Q14 message within 10 seconds of answer, no interaction required | Silent hold handoff gap (Hold_Sentinel to Claims_Agent) must not delay identification |
| Proposed "healthcare facility" definition | Confirms risk for AI sales calls to clinics |

## Reading proposed for the register (R10), founder to sign

Build to Part IV s.4 for carrier calls as a floor. The cost is three changes: window start 09:00 recipient local; add an email address to the opener; measure hangup disconnect. Treat CollectRx AI sales calls as telemarketing via ADAD (express consent, no calls to healthcare facilities, telemarketing hours and identification). Re-read after the 2026-132 decision.

## Open questions for the founder

1. D1: change the 08:00 start now or after the R10 signature?
2. Which email address appears in the carrier opener: the practice's or a CollectRx relay that forwards to the practice? (A relay keeps practice addresses out of prompts but adds a CollectRx inbox to monitor.)
3. Should human-assisted calls get a scripted identification line from staff (UI prompt), since s.4(d) attaches to the call, not the speaker?
