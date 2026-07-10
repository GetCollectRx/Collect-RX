# Phase 5 — operator & legal checklist

Engineering deliverables are in [PHASE5-COMPLIANCE.md](PHASE5-COMPLIANCE.md). Items below require **legal/ops execution** — track completion outside git.

## Vendor BAAs / DPAs

| Vendor | Data processed | Status |
|--------|----------------|--------|
| Fly.io (hosting + Postgres) | PHI at rest | [ ] Signed |
| Vapi | Ephemeral call variables | [ ] Signed |
| Twilio | Telephony metadata | [ ] Signed |
| SendGrid | Email addresses, message content | [ ] Signed |
| Stripe | Payment metadata (no PAN in scope) | [ ] Signed |
| Sentry | Error payloads (must scrub PHI) | [ ] Signed |

Template: store executed PDFs in secure ops vault (not in git).

## HIPAA / PIPEDA

- [ ] Internal or external HIPAA gap review completed
- [ ] PIPEDA breach notification process documented for Canadian practices
- [ ] Collections message templates reviewed by counsel ([PHASE5-COMPLIANCE.md](PHASE5-COMPLIANCE.md))

## PCI

- [ ] Confirm Stripe Checkout / hosted fields — CollectRx does not touch PAN ([PCI scope doc](PHASE5-COMPLIANCE.md))

## Pen test

- [ ] Annual PHI pen test scheduled
- [ ] Remediation plan for critical/high findings

## Engineering completed (in repo)

- [x] CSP enabled in production (`src/server/security/contentSecurityPolicy.ts`)
- [x] Password reset tokens stored as SHA-256 hash
- [x] Deprecated Vapi webhook handler removed
- [x] Audit log + admin query path
- [x] Semgrep in CI
