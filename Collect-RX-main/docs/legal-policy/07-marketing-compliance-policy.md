# 07. Marketing compliance policy

> DRAFT. Not reviewed by a lawyer. Positions per the founder's signed risk register; the marketing position has no register row yet (proposed as R11 under policy 08). Open items listed at the end. Replaces `docs/marketing/CASL-OUTREACH.md` once accepted.

## Purpose

Rules for CollectRx's own email, calls and prospect data, from L2a (`policy-research/CASL-AND-OWN-MARKETING.md`).

## Who it binds

Anyone sending marketing messages or placing sales calls for CollectRx, and the code in `src/server/marketing/`.

## Obligations implemented (research rows from CASL-AND-OWN-MARKETING.md)

| Rule | Source | Tag |
|---|---|---|
| Consent before any commercial electronic message | CASL s.6(1) (#1) | VERIFIED |
| Conspicuous publication implied consent conditions | CASL s.10(9)(b) (#2) | VERIFIED |
| Existing business relationship limits | CASL s.10(10) (#3) | VERIFIED |
| Identification with mailing address | SOR/2012-36 s.2(1) (#5) | VERIFIED |
| Unsubscribe readily performed, effective within 10 business days | CASL s.11; SOR/2012-36 s.3(2) (#6) | VERIFIED |
| Express consent for telemarketing via ADAD | UTR Part IV s.2, Part V (#9) | VERIFIED (text); ADAD status of LLM agents open |
| No telemarketing to healthcare facilities | UTR Part III s.28 (#10) | VERIFIED (text); definition open |
| Telemarketing hours, identification, internal do-not-call list | UTR Part III ss.8 to 12, 17, 23 (#11 to #13) | VERIFIED |

## Policy

### Email
1. Send only to an address with a recorded consent basis: express consent (form or reply with stored wording version), conspicuous publication (store the URL and capture date; the address must be the practice's published business address, the page must not say "no solicitations", and the message must relate to the recipient's business role), existing business relationship (purchase or contract within two years, inquiry within six months), referral (first message names the referrer in full), or a reply to the recipient's own inquiry.
2. Never send to addresses guessed from patterns, bought lists, or personal addresses found by enrichment services.
3. Every message: CollectRx's legal business name, a mailing address (PENDING_FOUNDER_DECISION), an email or web contact, and an unsubscribe link or reply address that works in one step. Contact details stay valid 60 days.
4. Unsubscribes are applied at once and never later than 10 business days; suppression survives re-harvest and re-import.
5. Consent requests state the purpose, identify CollectRx with mailing address and contact, and say consent can be withdrawn.

### Calls
6. AI voice sales calls are off by default. They may be placed only to a number with a recorded express consent to receive automated calls from CollectRx, in a form listed in UTR Part V, and only after the founder signs a reading on whether dental offices are "healthcare facilities".
7. Any sales call: weekdays 9:00 a.m. to 9:30 p.m. or weekends 10:00 a.m. to 6:00 p.m. recipient local time; opening identifies CollectRx, the caller, and that the caller is automated where it is; contact number and address available on request; do-not-call requests recorded at once and honoured for 3 years and 14 days.
8. Preferred channel: inbound (the prospect books or calls), which is not an unsolicited telecommunication.

### Claims and content
9. No compliance, certification or residency claims; the phrase list in `scripts/policy-lint-rules.json` is enforced in CI. No invented statistics, testimonials or customer names.
10. No marketing use of any patient or claim data (PHIPA ss.32, 33; SYNTHESIS F13).

### Records
11. Keep consent basis, evidence and opt-out history per address and number; keep this policy versioned (UTR Part VII due diligence).

## Open items

1. Mailing address for emails (PENDING_FOUNDER_DECISION).
2. Whether AI voice sales calls are needed at all in the next 90 days (recommend removing).
3. Remove `pattern` and Hunter `type=personal` sources from enrichment, or keep them for research only with sending blocked (follow-up code change).
4. One-step unsubscribe link (replace "reply with unsubscribe in the subject line").

## Code control and test

| Control | Test | Status |
|---|---|---|
| AI sales calls blocked without a recorded express ADAD consent and a signed healthcare-facility reading; off by default | `tests/marketing/salesCallPolicyGate.test.ts` (L4 PR) | L4 PR |
| Policy lint for forbidden claims in marketing templates and product copy | `scripts/policy-lint.cjs` (L4 PR) | L4 PR |
| Consent-basis field and send gate | Not built | Follow-up |
| Footer mailing address | Snapshot test on `emailLayout.ts` | Not built (needs open item 1) |
| National DNCL check before sales calls | `dnclCheck.ts` | Present |
