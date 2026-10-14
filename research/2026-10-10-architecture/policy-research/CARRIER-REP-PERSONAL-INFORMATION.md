# L2c. Carrier representatives' names and voices in transcripts

Date: 2026-10-13. Status: research record, not legal advice, not reviewed by a lawyer. Evidence: EVIDENCE-LOG-2026-10-13.md E7, E16, E18. Tags as in CORRECTIONS.md.

## Facts from the code (default branch, read this session)

- `CallAttempt.repName`, `CallAttempt.referenceNumber`, `CallAttempt.transcriptText` (`prisma/schema.prisma`, model CallAttempt).
- `HumanAssistedCallLog.repName`, `referenceNumber`, `amountStatedByRep`, `callSummary` (model HumanAssistedCallLog).
- Audio recording is disabled per call (`recordingEnabled: false`), but Vapi's default is to store logs and transcriptions (Vapi HIPAA page, VERIFIED E18). Speech is transcribed in real time by the STT vendor configured in the squad.
- Cross-tenant learning reads transcripts and human-assisted logs (see private-sector-privacy.md section 4; W3 PR #125 adds default-deny flags and a lesson text scan).

## Is a rep's name and what they said "personal information"?

| Question | Text | Reading | Tag |
|---|---|---|---|
| PIPEDA exclusion for business contact information | s.2: business contact information "means any information that is used for the purpose of communicating or facilitating communication with an individual in relation to their employment, business or profession such as the individual's name, position name or title, work address, work telephone number..." s.4.01: Part 1 "does not apply ... in respect of the business contact information of an individual that the organization collects, uses or discloses solely for the purpose of communicating or facilitating communication with the individual in relation to their employment, business or profession" | The rep's name used only to address them, or to ask for them on a callback, fits the exclusion. The same name stored as evidence of who said what, attached to a transcript, used to build carrier playbooks, or analysed across tenants is not "solely" for communicating with them, so the exclusion does not cover those uses | Text VERIFIED; application is analysis |
| What the rep said (statements, reference numbers, behaviour notes) | PIPEDA s.4(1)(a): Part 1 applies to personal information collected in the course of commercial activities | Statements linked to a named or identifiable rep are personal information of the rep while linked. A claim reference number alone is about the claim, not the rep | Text VERIFIED; application analysis |
| Voice | Recording disabled; real-time STT only | No retained voiceprint under current settings. If recording is ever enabled, voice audio is personal information of the rep and the practice-side speaker | Analysis |
| Which statute | PIPEDA s.4(1)(a); s.26(2)(b) exemption orders apply "in respect of the collection, use or disclosure of personal information that occurs within that province" where a substantially similar provincial law applies | Ontario: PIPEDA applies to CollectRx's handling. Quebec reps: P-39.1 also applies (s.12 use limits; s.13 communication to third persons). Alberta and BC: their PIPA business contact provisions were NOT read this session | PIPEDA VERIFIED; exemption orders, AB and BC provisions UNVERIFIED |

## Obligation table

Groups: A = autonomous calls; B = human-assisted calls; L = learning pipeline.

| # | Obligation | Source | Groups | Required control | Acceptance test | Current-code status | Tag |
|---|---|---|---|---|---|---|---|
| 1 | Collect only what is needed for identified purposes | PIPEDA Sched. 1 cl. 4.4, 4.4.1 | A, B | Store rep first name or rep ID as given, and the reference number; no surname unless the carrier gives only a full name | Schema comment and extraction prompt limit the field | `repName` free text; no limit | VERIFIED (text) |
| 2 | Identify purposes and use only for them; new purposes need consent | PIPEDA Sched. 1 cl. 4.2, 4.2.4, 4.5; P-39.1 s.12 | A, B, L | Declared purpose for rep data: "record of the claim status conversation for the practice's follow-up". Excluded: carrier-rep profiling, cross-tenant lessons that name a rep | Lesson text scan rejects rep names (W3 scan) | W3 PR #125 adds an identifier scan on lesson text; rep-name coverage to be confirmed in that PR | VERIFIED (text) |
| 3 | Openness about practices | PIPEDA Sched. 1 cl. 4.8, 4.8.2 | A, B | Public privacy notice states that calls to carriers are transcribed, that rep first names and reference numbers are recorded, and why (docs/legal-policy/01) | Notice text contains the statement | No notice | VERIFIED (text) |
| 4 | Retention limited to purpose; minimum and maximum periods | PIPEDA Sched. 1 cl. 4.5.2, 4.5.3; P-39.1 s.23 | A, B | Rep name retained with the claim record for the practice's retention period; nulled when the claim record is purged | Retention dry run reports rep fields | Retention job off by default; W7 planned | VERIFIED (text) |
| 5 | Access and correction on request | PIPEDA s.8, Sched. 1 cl. 4.9 | A, B | Rep data searchable by name for an access request from a carrier employee | Runbook step exists | Not present | VERIFIED (text) |
| 6 | Accuracy | PIPEDA Sched. 1 cl. 4.6 | A, B | Rep statements recorded as "stated by rep" with timestamp, never as verified facts | Outcome schema field naming | Field `amountStatedByRep` follows this pattern | VERIFIED (text) |

## Reading adopted for drafting (founder to sign)

Rep names and statements are personal information when stored as evidence or analysed. Collect first name or rep ID and the reference number, disclose this in the public notice, keep them with the claim record, and exclude them from anything shared across practices.

## Open questions for the founder

1. Keep `repName` at all? A reference number usually identifies the conversation for the carrier; the name adds little. Dropping it removes most of this exposure.
2. Should the carrier opener say the call is transcribed (W6 PR scope)?
