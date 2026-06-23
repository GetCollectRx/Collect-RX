# PHI / Vapi Boundary — Decision Record

**Status:** Closed (Option B)  
**Date:** 2026-06-20  
**Owner:** CollectRx engineering + legal counsel (BAA execution pending)

---

## Decision

CollectRx uses **Option B: Ephemeral PHI via Vapi call variables** with strict controls.

Carriers routinely require patient name and date of birth to locate a claim during a
provider-line call. A PHI-free-only design (Option A) would fail on a material share of
calls. Option B is required for the product to work while staying PHIPA/PIPEDA-aligned.

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

- [ ] Signed **BAA/DPA** with Vapi covering Canadian PHI
- [ ] Signed **BAA/DPA** with Twilio (telephony transit)
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
