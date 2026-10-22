# 01. Privacy notice for practices and patients

> DRAFT. Not reviewed by a lawyer. Positions per the founder's signed risk register (R1 to R7 are unsigned as of 2026-10-13, so the positions below are OPEN). Open items listed at the end.

## Purpose

Tell practices, and through them their patients, what CollectRx collects, why, who processes it and where, how long it is kept, and how to exercise rights. Replaces the template at `src/pages/LegalPrivacy.tsx`, which still describes retired patient reminders and payment links.

## Who it binds

CollectRx, as the publisher of the notice. Practices remain responsible for their own patient notices; section B is a model paragraph practices may adapt.

## Obligations implemented

| Obligation | Source (research file#row) | Tag |
|---|---|---|
| Openness: name or title and address of the accountable person, types of information, uses, access route | PIPEDA Sched. 1 cl. 4.8.2 (private-sector-privacy.md#1, #2) | VERIFIED |
| Identify purposes at or before collection | PIPEDA Sched. 1 cl. 4.2 | VERIFIED |
| Notice of purposes supports knowledgeable consent | PHIPA s.18(5), (6) (health-privacy.md#9) | VERIFIED |
| Disclose processing outside Ontario and Canada | PHIPA s.50(1) (health-privacy.md#11); register R3 | VERIFIED (text); reading OPEN |
| Carrier representative data handled openly | CARRIER-REP-PERSONAL-INFORMATION.md#3 | VERIFIED (text) |
| Quebec: officer contact, purposes, communication outside Quebec | P-39.1 ss.3.1, 8 (private-sector-privacy.md#5, #6) | ss.8 and 3.1 read only in the 2021 enacting Act; current consolidation read for 3.3 to 3.8, 12, 12.1, 17 |

## Draft text

### A. CollectRx privacy notice

**Who we are.** CollectRx provides software and automated calling that follows up on dental insurance claims with insurance carriers for the dental practices that use it. For patient information, the practice is the health information custodian and CollectRx acts for the practice and only for the practice's purposes.

**Accountable person.** Privacy contact: PENDING_FOUNDER_DECISION (title, mailing address, email).

**What we collect.**
- From practices: account details for practice staff; practice identifiers carriers require (provider numbers, practice address and callback number); claim records the practice imports (claim number, carrier, dates, amounts, procedure codes, claim status).
- Patient identifiers needed for a carrier to locate a claim (name, date of birth, policy and member numbers). These are stored encrypted, kept separate from claim records, and passed to the calling system only for the duration of a call.
- From calls with carriers: a written transcript of the call, the outcome (status, reference number, dates), and the first name or ID of the carrier representative and what they stated about the claim.
- We do not collect patient payment card data and do not contact patients.

**Why.** To follow up on insurance claims for the practice, record outcomes for the practice, and operate and secure the service. We do not use patient information for marketing. We do not use one practice's call content to serve other practices unless that practice turns on learning contribution and the content has passed an identifier scan (see Open item 3).

**Calls and transcripts.** Audio recording is turned off for each call. Calls are transcribed in real time and transcripts are stored, by CollectRx and, under the voice platform's default settings, by the voice platform. See Open item 2.

**Who processes information for us, and where.** Service providers process information on our behalf under contract. Current providers and their processing locations are listed in our sub-processor register (published at PENDING_FOUNDER_DECISION, maintained under policy 03). As of 2026-10-13: application hosting in Toronto, Canada (Fly.io), with backups and some support tooling in the United States; voice orchestration, speech recognition, speech synthesis and AI language models provided by companies that process in the United States. Information processed outside Canada may be accessible to authorities of those countries under their laws.

**How long.** We keep information only as long as needed for the purposes above and as set in our retention schedule (policy 06). When a practice leaves, we export its data to it on request and then delete it, subject to legal holds.

**Your rights.** Patients: please contact your dental practice first; it controls your health information and we will help it respond. Carrier staff and practice staff may ask us for access to or correction of information about them at the privacy contact above.

**Changes.** Version and date of this notice are shown at the top of the published page.

### B. Model paragraph for practices to give patients (practice adapts and owns it)

"We may use an automated service, CollectRx, to contact your insurance company on our behalf about the status of claims we submit for you. To locate your claim, the service gives the insurer identifiers such as your name, date of birth and policy number. Calls are transcribed and the service uses providers that may process information in the United States. You may ask us not to use this service for your claims."

## Open items

1. Privacy contact title, address and email (PENDING_FOUNDER_DECISION).
2. Vapi ZDR decision (founder decision D2): if ZDR is enabled, replace the transcript sentence with "the voice platform does not store transcripts after the call".
3. Learning: confirm wording once W3 (PR #125) merges and its defaults are settled.
4. Register R3 (out-of-Ontario processing) unsigned; the notice discloses US processing under either reading.
5. Vendor regions for Vapi, Twilio, Deepgram, Google not yet read (CORRECTIONS.md section D).

## Code control and test

| Control | Test | Status |
|---|---|---|
| Notice text lives in a versioned constant rendered by `LegalPrivacy.tsx` | Snapshot test that the page shows the version and the sub-processor link | Not built (follow-up; page change is product copy) |
| Sub-processor register drives the vendor list | W8 CI check (planned) | Planned |
| Policy lint blocks residency and compliance claims in product copy | `scripts/policy-lint.cjs` (L4 PR) | L4 PR |
