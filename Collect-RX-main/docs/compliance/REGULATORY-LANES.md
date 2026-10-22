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
| Automated-call identification | Conservative product control. UTR Part IV s.4(d), if it applies: begin with the principal's identity, a brief purpose, an email or postal address and a local or toll-free number; repeat if the message exceeds 60 seconds. Automation disclosure is product policy |
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
| Sales voice calls | AI voice sales calls are likely telemarketing via an ADAD: express consent required (UTR Part IV s.2), no telemarketing to healthcare facilities (Part III s.28), telemarketing hours (Part III s.23), identification (Part III s.17), internal do-not-call list (Part III ss.8 to 12). A National DNCL scrub alone is not enough. See policy-research/CASL-AND-OWN-MARKETING.md (PR #127) |
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
> We follow a written policy built on the CRTC automated-call identification rules. These calls are
> **not telemarketing**, and we are **not calling patients** to sell anything."
