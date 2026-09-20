# Vendor DPA Review Checklist — Vapi & Fly.io

Use this when you get paperwork back from either vendor. It's built to catch the specific gaps PHIPA cross-border disclosure needs, not a generic contract-review checklist. Not legal advice — a lawyer would still be the one to tell you if language actually holds up, but this tells you what to look for and what's missing before you get to that point.

## What to request

- **Vapi**: email/use the enterprise contact via [security.vapi.ai](https://security.vapi.ai/) to request their DPA (Vapi states it is free but enterprise-tier only) and their current sub-processor list. Ask specifically whether they'll add PHIPA-equivalent-protection and breach-notification language, since their public DPA is written for GDPR.
- **Fly.io**: email sales@fly.io or security@fly.io, reference healthcare/PHI use, and ask for (1) their standard DPA (public docs show it's written for GDPR by default), (2) written confirmation of which sub-processors touch data for apps pinned to the `yyz` region, and (3) whether backups and object storage (Tigris) can be excluded or kept in-region for your use case.

## Checklist — run this against whatever comes back

| # | Requirement | Vapi | Fly.io |
|---|-------------|------|--------|
| 1 | Names all sub-processors that will touch PHI, with location | [ ] | [ ] |
| 2 | Restricts sub-processor's use of PHI to providing the contracted service only (no model training on your data) | [ ] | [ ] |
| 3 | Requires the sub-processor to notify you of a breach "without unreasonable delay" or a specific number of hours | [ ] | [ ] |
| 4 | Requires flow-down of equivalent safeguards to any further sub-processor (i.e., their own vendors) | [ ] | [ ] |
| 5 | Gives you the right to object to a new sub-processor or a change in processing location | [ ] | [ ] |
| 6 | Confirms data-at-rest and data-in-transit encryption | [ ] | [ ] |
| 7 | Specifies data return/deletion on contract termination | [ ] | [ ] |
| 8 | Explicitly references PHIPA or, at minimum, doesn't limit itself to GDPR/HIPAA only | [ ] | [ ] |
| 9 | Confirms audit or compliance-attestation rights (SOC 2, etc.) | [ ] | [ ] |

## Known gaps as of this review (June 2026)

- **Vapi**: DPA is enterprise-only — confirm your account tier qualifies before assuming you have one. Vapi does not monitor or guarantee the compliance of the underlying model/transcription/voice providers it routes through; each of those (OpenAI, Azure, Google, Anthropic, Deepgram, ElevenLabs, Cartesia, PlayHT) has its own terms. Vapi states it does not have EU servers — no public statement found on Canadian data residency, so don't assume it.
- **Fly.io**: Public DPA is framed around GDPR. Their published sub-processor list (fly.io/legal/sub-processors) shows every listed sub-processor — including Tigris (object storage) and AWS (backup storage) — as US-based. Compute in `yyz` does not by itself keep backups or object storage in Canada. Get this confirmed or re-architected (e.g., avoid Tigris/off-site backup for anything containing PHI, or accept and disclose the residual US touchpoint) before calling the infra migration "done" for PHIPA purposes.

## Sources

- [Vapi Trust Center](https://security.vapi.ai/)
- [Vapi HIPAA Compliance docs](https://docs.vapi.ai/security-and-privacy/hipaa)
- [Fly.io Sub-processors](https://fly.io/legal/sub-processors/)
- [Fly.io Healthcare apps on Fly](https://fly.io/docs/about/healthcare/)
