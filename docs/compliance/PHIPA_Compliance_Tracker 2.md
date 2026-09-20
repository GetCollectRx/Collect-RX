# CollectRx — PHIPA Compliance Action Tracker

Last updated: June 30, 2026. No lawyer engaged on this file per Khalid's decision — status column reflects self-serve work, not legal sign-off.

## Status summary

| # | Item | Status | Owner | Next action |
|---|------|--------|-------|--------------|
| 1 | PHIPA s.17 agent agreement (practice-facing) | Draft ready, unreviewed | Khalid | Fill placeholders, get a fixed-fee document review (see Section 3 below), start requiring signature before onboarding new practices |
| 2 | Cross-border DPAs — Vapi | Not started | Khalid | Request Vapi's enterprise DPA + BAA list from security.vapi.ai; run through checklist in `Vendor_DPA_Review_Checklist.md` |
| 3 | Cross-border DPAs — Fly.io | Not started | Khalid | Request Fly.io's DPA/BAA from sales@fly.io; confirm Tigris/backup sub-processor exposure (see finding below) |
| 4 | Canadian-region infra migration | **Done** — migrated off Railway to Fly.io | Khalid | Confirm with Fly.io in writing which parts of the stack (backups, object storage) still touch US sub-processors |
| 5 | AI usage disclosure in onboarding materials | Draft ready | Khalid | Paste into onboarding contract/terms — see `AI_Disclosure_Paragraph.txt` |

## 1. Practice-facing agreement — what changed from the original ask

Original ask was "a lawyer familiar with Ontario health privacy law should draft this." Khalid has said no lawyer. The self-serve alternative:

- `CollectRx_PHIPA_Agent_Agreement_DRAFT.docx` restates PHIPA s.17 statutory obligations (permitted collection/use/disclosure, breach notification, safeguards) and IPC guidance in contract form, with a cross-border sub-processor schedule naming Vapi and Fly.io.
- It is explicitly flagged inside the document as not reviewed by counsel, with the specific clauses (indemnification, liability allocation) called out as the ones most likely to bite if wrong.
- This is usable as a starting point, not a finished, execution-ready contract. The realistic risk if it goes out unreviewed: an unenforceable indemnification clause, or a gap that only surfaces during an actual IPC complaint or breach — at which point the fix is much more expensive than a review would have been.

**Lower-cost paths to a second set of eyes, if a full retainer is off the table:**

| Option | Rough cost/effort | What it buys |
|--------|-------------------|---------------|
| Fixed-fee "document review only" from an Ontario health-privacy lawyer | Low hundreds to ~$1,500, one-time | A lawyer reads and redlines your draft — not from-scratch drafting, most firms will quote this separately from an engagement |
| Law Society of Ontario Lawyer Referral Service | Free 30-minute consult | A starting point to find someone who'll quote a fixed fee for review only |
| Check your E&O / cyber liability insurance policy | Free (you likely already pay for the policy) | Some policies require or discount for a legal review of vendor/customer contracts handling PHI — worth checking before assuming this is a pure out-of-pocket cost |
| Self-serve, no review | $0 | Fastest, but you are personally underwriting the risk that the liability/indemnification language holds up if a practice or the IPC ever contests it |

This isn't an argument to reverse the no-lawyer call. It's the menu of what "some legal input" can look like short of a full engagement, since a document that allocates PHI breach liability is a different risk class than an ordinary vendor contract.

## 2. Infra migration — the part that isn't actually finished

Migrating to Fly.io's Toronto (`yyz`) region resolves the "where does compute run" question. It does not, on its own, resolve the "where does all the data touch" question. Fly.io's own published sub-processor list (fly.io/legal/sub-processors) shows every listed sub-processor as US-based, including:

- **Tigris** — object storage backing "Fly Volumes"/Sprites, US-incorporated
- **AWS** — used for backup storage
- Various support/analytics tools (lower risk, unlikely to touch PHI directly)

If the application writes PHI to Fly volumes that get backed up, or uses Tigris/object storage for anything (call recordings, transcripts, attachments), that data may leave Canada even though compute sits in `yyz`. This is worth nailing down with Fly.io directly (they'll answer via sales@fly.io or security@fly.io) before treating the infra item as fully closed for PHIPA purposes — not a legal question, an operational one you can resolve yourself.

Fly.io does state it is SOC2 Type 2 audited and will sign BAAs (their healthcare/HIPAA page), which is a reasonable signal, but a BAA is a HIPAA construct, not a PHIPA one — the DPA you get from them needs PHIPA-equivalent-protection and breach-notification language added or confirmed, not just a HIPAA BAA.

## 3. Sources checked

- PHIPA s.17(1)/(2)/(3) — statutory obligations on agents (paraphrased from search results and the IPC FAQ; the current in-force full text should be pulled directly from ontario.ca/laws/statute/04p03 before final drafting, since that page requires JavaScript and could not be fetched directly in this session)
- [IPC Ontario — PHIPA FAQ](https://www.ipc.on.ca/sites/default/files/legacy/2015/11/phipa-faq.pdf)
- [IPC Ontario — General resources for health information custodians](https://www.ipc.on.ca/en/health-privacy-ontario/general-resources-for-health-information-custodians)
- [Fly.io — Regions](https://fly.io/docs/reference/regions/) (confirms `yyz` Toronto region)
- [Fly.io — Sub-processors](https://fly.io/legal/sub-processors/) (confirms all listed sub-processors are US-based)
- [Fly.io — Healthcare apps on Fly](https://fly.io/docs/about/healthcare/) (SOC2 Type 2, will sign BAAs)
- [Fly.io — Security practices and compliance](https://fly.io/docs/security/security-at-fly-io/)
- [Vapi — Trust Center](https://security.vapi.ai/) and [Vapi — HIPAA Compliance docs](https://docs.vapi.ai/security-and-privacy/hipaa) (enterprise-only DPA, BAAs signed with OpenAI/Azure/Google/Anthropic/Deepgram/ElevenLabs/Cartesia/PlayHT, no EU servers)

None of the above is a substitute for pulling the current in-force PHIPA text directly for final citations, or for a document review before the practice-facing agreement goes out for signature.
