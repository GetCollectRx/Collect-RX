# Compliance launch tracker — Group E

**Not legal advice.** Fill dates/owners. Product: Practice → Insurance (no patient/client payment collection).

Master index: [PHASE5-COMPLIANCE.md](PHASE5-COMPLIANCE.md). Launch path: [PATH-TO-DELIVERY.md](../operations/PATH-TO-DELIVERY.md).

## Vendor agreements (P5-05)

| Vendor | Role | Where to execute the DPA/BAA | BAA/DPA status | Owner | Date |
|--------|------|------------------------------|----------------|-------|------|
| Fly.io | Hosting / Postgres — PHI at rest | Standard DPA incorporated in terms; review https://fly.io/legal/ and request countersigned DPA via support if needed | [ ] | | |
| SendGrid (Twilio) | Email | Twilio DPA covers SendGrid: https://www.twilio.com/en-us/legal/data-protection-addendum (self-serve, incorporated) | [ ] | | |
| Twilio | Telephony transport | Same Twilio DPA as above | [ ] | | |
| Stripe | Practice SaaS Billing only (no PHI) | DPA incorporated into Stripe's services agreement: https://stripe.com/legal/dpa | [ ] | | |
| Vapi | Voice agents (ephemeral PHI in call variables) | Terms include DPA: https://vapi.ai/terms-of-service ; HIPAA mode + BAA info: https://docs.vapi.ai/security-and-privacy/hipaa ; trust center: https://security.vapi.ai — **ask Vapi for HIPAA mode/BAA explicitly; their BAAs with sub-providers (Anthropic, Deepgram, etc.) are listed on the trust center** | [ ] | | |
| Backup vendor | DB backups (Fly snapshots today) | Covered by Fly if snapshots stay on Fly; separate DPA only if an external backup target is added | [ ] | | |

> Note: most of these are self-serve (incorporated into the vendor's standard terms) — the action is to confirm the current version, record the date, and file a copy. The only one likely needing an actual request is Vapi's HIPAA mode/BAA. Links verified 2026-07-18; confirm current text at execution time.

## Reviews

| Item | Status | Owner | Date | Notes |
|------|--------|-------|------|-------|
| Encryption at rest confirmed on prod DB (P5-02) | [ ] | | | Screenshot / host console evidence |
| HIPAA / health privacy gap review (P5-06) | [ ] | | | Or written pilot exception |
| PIPEDA / provincial (P5-07) | [ ] | | | Jurisdiction + breach contact |
| Terms + Privacy counsel review (P9-02) | [ ] | | | Templates in app until signed off |
| Pen test (P5-11) | [ ] scheduled / [ ] exception | | | Attach report or exception memo |
| Messaging counsel (P5-08) | [ ] N/A (no patient outreach) / [ ] reviewed | | | Patient balance outreach out of scope |

## Sign-off

| Role | Name | Date |
|------|------|------|
| Engineering | | |
| Ops | | |
| Legal / counsel | | |
