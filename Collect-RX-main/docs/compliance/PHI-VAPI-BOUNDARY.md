# PHI / Vapi Boundary — Decision Record

> Reviewed against research 2026-10-13; not legal advice; see policy-research/SYNTHESIS.md.

**Status:** Option B selected. Engineering controls listed below. Legal and vendor controls are open (unchecked), so this record is not closed  
**Date:** 2026-06-20  
**Owner:** CollectRx engineering + legal counsel (written agreements with Vapi and Twilio pending)

---

## Decision

CollectRx uses **Option B: Ephemeral PHI via Vapi call variables** with strict controls.

Carriers routinely require patient name and date of birth to locate a claim during a
provider-line call. A PHI-free-only design (Option A) would fail on a material share of
calls. Option B is selected because the product needs these identifiers to locate a claim. Whether this design satisfies PHIPA and PIPEDA is a counsel question (PENDING_COUNSEL; see `policy-research/health-privacy.md` and `policy-research/private-sector-privacy.md`).

---

## What crosses the boundary (and what does not)

| Data | Stored in CollectRx DB | Sent to Vapi | Notes |
|------|------------------------|--------------|-------|
| Patient name, DOB | **No** (UUID token only) | **Yes — ephemeral `variables` only** | Injected at `initiateCall()` |
| Policy / group number | **No** (in piiVault) | **Yes — ephemeral** | Required for IVR and rep lookup |
| Claim ref, amounts, dates | **Yes** | **Yes — ephemeral** | Not PHI alone |
| `patientToken` UUID | **Yes** | **Metadata only** | Links call back to DB |

**Never in Vapi metadata:** patient name, DOB, health card number.

---

## Controls (engineering)

1. **`piiVault.detokenize()`** — PHI resolved server-side immediately before dispatch only.
2. **`initiateCall()`** — PHI in `variables` payload; `metadata` is UUID-only.
3. **`recordingEnabled: false`** — Vapi recording off; post-call audio deletion enforced.
4. **`logger.js`** — PHI field names scrubbed from all logs.
5. **`PhiAccessLog`** — every detokenization audited (`PHI_TOKEN_RESOLVED`).
6. **Squad prompt** — template placeholders only; no real PHI in published config files.

---

## Controls (legal / operator — before production scale)

- [ ] Signed written agreement with Vapi covering PHI processing and out-of-Ontario transfer (PHIPA s. 50; PENDING_COUNSEL). Canadian processing is not established; no Canadian region is confirmed in the vendor research
- [ ] Signed written agreement with Twilio covering telephony transit (PENDING_COUNSEL)
- [ ] Confirm Vapi transcript retention policy in writing
- [ ] Privacy Impact Assessment updated to reference ephemeral PHI transit

---

## Prompt files

- `vapi-system-prompt.md` — reference template (placeholders, not live PHI)
- `vapi-squad-config.json` — squad variable names for Vapi dashboard sync
- Runtime injection — `src/vapi/client.ts` → `variables` block

---

## Audit

Run **Vapi Squad Auditor** before every prompt publish and monthly in production.
Run **PHI Access Log Reviewer** monthly.
