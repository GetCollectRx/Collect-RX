# L2d. Consumer protection and AI disclosure rules for calls between businesses

Date: 2026-10-13. Status: research record, not legal advice, not reviewed by a lawyer. Evidence: EVIDENCE-LOG-2026-10-13.md E1, E2, E7, E13, E14. The question was answered from text, not assumed.

## Findings

| # | Candidate rule | Text read | Applies to CollectRx carrier calls? | Tag |
|---|---|---|---|---|
| 1 | Ontario Consumer Protection Act, 2002 | s.1: "consumer" means "an individual acting for personal, family or household purposes and does not include a person who is acting for business purposes"; s.2(1) applies to "consumer transactions"; s.2(2)(c) excludes "financial products or services regulated under the Insurance Act" | No. A practice (or CollectRx for it) calling an insurer about a claim is not a consumer transaction, and insurance products are excluded. The Act is to be repealed by the Consumer Protection Act, 2023 on a day to be named; the 2023 Act was not read | 2002 Act VERIFIED; 2023 Act UNVERIFIED |
| 2 | Quebec Consumer Protection Act | Not read | Not determined | UNVERIFIED |
| 3 | CRTC UTR identification | Part IV s.4(d) requires identifying the person on whose behalf the call is made, its purpose and contact details; it does not require stating that the caller is automated | Possibly (see CRTC-UTR-CARRIER-AND-SALES-CALLS.md). Identification yes; AI nature not required by current text | VERIFIED |
| 4 | CRTC proposal to require disclosure that the caller is not a live person | 2026-132 Q10, limited to telemarketing | Not today; would affect CollectRx sales calls if adopted | VERIFIED (proposal) |
| 5 | PIPEDA openness and consent | Sched. 1 cl. 4.2, 4.3, 4.8 (VERIFIED) | Applies to personal information handling (rep data, patient identifiers), not to whether the caller is an AI. OPC generative AI principles (non-binding guidance, read in the earlier research) recommend openness | VERIFIED (statute); guidance as previously tagged |
| 6 | Quebec automated decisions | P-39.1 s.12.1 applies to "a decision based exclusively on an automated processing" about the person concerned | Not to the carrier call itself (no decision about the rep or the patient is made by the call). Possibly to automated estimates shown to Quebec patients (PS#7) | VERIFIED (text) |
| 7 | Federal AI statute | LEGISinfo: no federal AI regulation statute in force; Bill C-36 (privacy) at second reading; C-34 (online safety) at second reading; C-277 (deepfakes, private member) outside the order of precedence | No binding federal AI disclosure rule found | VERIFIED (status only; bill texts not read) |
| 8 | Competition Act deceptive marketing | Not read | Relevant to sales and marketing claims, not to carrier calls | UNVERIFIED |
| 9 | Criminal Code interception | ss.183, 183.1, 184(2)(a) (VERIFIED in earlier research) | One-party consent is about recording and interception, not AI disclosure | VERIFIED (earlier pass) |

## Conclusion from the text read

No statute read requires a caller to disclose to a business counterpart that it is an AI system. The current UTR require identification of the principal, purpose and contact details for ADAD calls. CollectRx discloses automation anyway as product policy (`crtc-disclosure-decision.md`); keep it, because 2026-132 is moving that way for telemarketing and because concealment would breach the carrier relationship (CARRIER_BLOCK risk), not because a statute requires it today.

## Controls

| Control | Basis | Status |
|---|---|---|
| Keep the automation disclosure in every opener; never instruct an agent to claim to be human | Product policy; 2026-132 Q10 direction | Present in Claims_Agent first message |
| Add purpose and an email address to the opener | UTR Part IV s.4(d) | Gap (CRTC-UTR file row 3) |
| Do not represent CollectRx marketing claims as "compliant" or "certified" | Policy lint (L4); Competition Act not read | L4 PR |

## Open questions for the founder

1. Keep automation disclosure as a policy commitment even if the CRTC decides it is not required? (Recommended yes.)
2. Any Quebec practices in the 90-day plan? If yes, the Quebec Consumer Protection Act and French-language obligations need a read.
