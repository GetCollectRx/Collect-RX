# CollectRx Regulatory Lanes

CollectRx touches three separate compliance domains. **Do not conflate them.**

---

## Lane 1 — Carrier claim calls (core product)

**What:** Automated **non-solicitation claim status inquiries** from a dental practice to
insurance carrier **provider/claims business lines** for work already performed.

**Regulation:** CRTC Unsolicited Telecommunications Rules (UTR) **Part IV Rule 4** —
Automated Dialing-Announcing Device (ADAD), **non-solicitation** calls.

**What applies:**

| Rule | Applies? |
|------|----------|
| Telemarketing (UTR Part III) | **No** — not solicitation |
| National DNCL (UTR Part II) | **No** — B2B to business lines |
| ADAD identification (Part IV Rule 4) | **Yes** — disclose automation, practice name, callback number within 10 seconds |
| CASL (voice) | **No** |

**Engineering controls:** Opening disclosure in `initiateCall()`, call hours Mon–Fri 8am–5pm ET,
caller ID displayed, `ADAD_DISCLOSURE_VERIFIED` audit trail.

**Watch:** [CRTC Notice 2026-132](https://www.crtc.gc.ca/eng/archive/2026/2026-132.htm) — AI voice may add requirements; monitor monthly.

---

## Lane 2 — Carrier authorization (BAAL)

**What:** Proof that CollectRx is an **authorized billing representative** of the dental
practice when calling carriers on their behalf.

**Regulation:** Carrier agreement practice + due diligence record (not CRTC telemarketing).

**What applies:**

- Signed **Billing Agent Authorization Letter (BAAL)** per practice per carrier
- Valid **provider number** registered with each carrier
- Hard gate in `validateDispatch()` — no call without BAAL + provider number on file

**Engineering controls:** `authorizationSubmitted` + `providerNumber` in Practice Settings;
`checkCarrierAuthorizationGate()` in `src/carriers/adapter.ts`.

**Template:** See `LEGAL-REVIEW-PROMPT.md` → Document 1 (BAAL).

---

## Lane 3 — Sales outreach to dental practices (GTM)

**What:** Cold email, LinkedIn, and optional **sales qualification calls** to prospective
dental practices (not carriers, not patients).

**Regulation:**

| Channel | Regulation |
|---------|------------|
| Email | **CASL** — conspicuous publication, unsubscribe, sender ID |
| Sales voice calls | **DNCL** scrub before calling residential/mobile numbers |
| Voice (if used) | CRTC rules for calls **to practices** — separate from carrier lane |

**Engineering controls:** `emailOptOutAt`, one-click unsubscribe, `DNCL_PHONE_LIST_PATH`,
`MARKETING_*` env vars, CASL cadence templates.

**Docs:** `docs/marketing/CASL-OUTREACH.md`, `docs/marketing/PARTNERSHIPS-DEPLOY.md`

---

## Lane 4 — PHI (PHIPA / PIPEDA)

**What:** Patient health information handled during claim follow-up.

**Regulation:** PHIPA (Ontario), PIPEDA (federal), provincial equivalents.

**Engineering controls:** PIIVault tokenization, ephemeral Vapi variables, encryption at rest,
audit log, breach protocol (incident IC-1).

**Doc:** `PHI-VAPI-BOUNDARY.md`

---

## Quick reference for sales and support

> "CollectRx places **non-solicitation claim status inquiries** on behalf of dental practices
> to insurance carrier provider lines — the same calls a billing coordinator makes today.
> We comply with CRTC **ADAD identification rules**. We are **not telemarketing**. We are
> **not calling patients** to sell anything."
