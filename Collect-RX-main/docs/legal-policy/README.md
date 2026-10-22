# Legal and policy documents

> DRAFT. Not reviewed by a lawyer. Positions follow the founder's signed risk register (`research/2026-10-10-architecture/policy-research/INTERPRETATION-AND-RISK-REGISTER.md`); a position whose register row is unsigned is marked OPEN. Open items are listed in each document.

These documents turn the policy research into rules that bind CollectRx, its staff and its code. Each one names the obligations it implements (by research file and row), the draft text, the open items, and the code control and test that enforce it. The traceability matrix (`TRACEABILITY.md`, added by the L5 PR) links every obligation to its document, control and test.

| # | Document | Binds | Status |
|---|---|---|---|
| 01 | [Privacy notice for practices and patients](01-privacy-notice.md) | CollectRx (published notice) | DRAFT |
| 02 | [Customer agreement addendum](02-customer-agreement-addendum.md) | CollectRx and each practice | DRAFT |
| 03 | [Vendor management policy and DPA request letters](03-vendor-management-policy.md) | CollectRx staff; vendors by contract | DRAFT |
| 04 | [AI use and call disclosure policy](04-ai-use-and-call-disclosure-policy.md) | CollectRx staff, agent prompts, squad config | DRAFT |
| 05 | [Incident response and breach procedure](05-incident-response-and-breach-procedure.md) | CollectRx staff | DRAFT |
| 06 | [Retention and disposal schedule](06-retention-and-disposal-schedule.md) | CollectRx systems | DRAFT, periods PENDING_FOUNDER_DECISION |
| 07 | [Marketing compliance policy](07-marketing-compliance-policy.md) | CollectRx marketing and sales | DRAFT |
| 08 | [Risk acceptance process](08-risk-acceptance-process.md) | Founder and anyone proposing a legal position | DRAFT |

## Rules for these documents

- Evidence tags: VERIFIED (primary text read), EXCERPT (secondary or summarized), UNVERIFIED. Source quotations are in `policy-research/EVIDENCE-LOG-2026-10-13.md`.
- No compliance or certification claims. Write "implements control X for obligation Y". The forbidden phrase list lives in `scripts/policy-lint-rules.json` (L4 PR) and is checked in CI.
- No em dashes or en dashes in these documents (also checked by the policy lint).
- No hardcoded practice names, emails or credentials; no PHI; synthetic examples only.
- Values that need a founder decision are written as `PENDING_FOUNDER_DECISION` and listed under Open items.

## Related work on other branches

| Item | Where |
|---|---|
| Doc corrections to PHIPA runbook, HIA clause, Quebec PIA, Vapi boundary | PR #123 (privacy controls W1) |
| Consent attestation and agent permission gate (records attestation wording version) | PR #124 (W2) |
| Learning default-deny and lesson text scan | PR #125 (W3) |
| Breach register, variable allowlist, truthful notice constant, retention coverage, sub-processor register, Quebec gate, audit coverage | Planned W4 to W10 in `policy-research/FIX-PROMPT-PRIVACY-GAPS.md` |
| L1 verification and corrections; L2 research gap files | PRs #126, #127 |
