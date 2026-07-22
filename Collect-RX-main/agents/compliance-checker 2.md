# CollectRx Compliance Checker Agent

**Purpose:** Ongoing compliance check for CRTC, PHIPA, and PIPEDA obligations. Run before any new carrier is added, before scaling call volume, and quarterly as a standing review. This is what keeps CollectRx from getting fined.

**Regulatory lanes:** See `docs/compliance/REGULATORY-LANES.md` — carrier claim calls (ADAD), BAAL authorization, sales outreach (CASL), and PHI (PHIPA) are **separate**. Do not conflate telemarketing rules with claim follow-up.

---

## Regulatory Landscape (as of June 2026)

### What applies to CollectRx

| Regulation | Applies? | Why | Risk |
|---|---|---|---|
| CASL (Canada's Anti-Spam Legislation) | No (carrier voice) / Yes (sales email) | Voice claim calls are not "electronic messages"; marketing email is CASL-regulated | Low if email compliant |
| CRTC DNCL Rules (UTR Part II) | No (carrier calls) / Yes (sales calls to practices) | Carrier claims lines are business lines (B2B exempt); DNCL required for outbound sales voice | Low / Medium |
| CRTC Telemarketing Rules (UTR Part III) | **No** | Claim status inquiry is **not solicitation** — core product lane | Very Low |
| CRTC ADAD Non-Solicitation Rules (UTR Part IV Rule 4) | **Yes** | Vapi voice qualifies as ADAD; B2B non-solicitation calls still require disclosure | Low if compliant |
| PHIPA (Ontario) | Yes | Patient health information is processed | High if violated |
| PIPEDA | Yes | Personal information processed across provinces | High if violated |
| BAAL (Billing Agent Authorization) | **Yes** | Carrier/practice authorization — separate from CRTC telemarketing | High if missing — **hard gate in `validateDispatch()`** |

**Fine exposure (CRTC):** Up to $15,000 per violation per call (corporation). Each non-compliant call is a separate violation.

### Active regulatory watch

- **CRTC Notice of Consultation 2026-132** — open review of whether AI-synthesized voice should face additional consent requirements. No rule change yet. Monitor the CRTC website for final decision. This is the single biggest external risk to CollectRx's calling model.

---

## Compliance Checklist

### CRTC UTR Part IV Rule 4 (ADAD Non-Solicitation)

Every Vapi call must comply with all of the following. Check against `vapi-system-prompt.md`, `vapi-squad-config.json`, and the `vapiService.startCall()` payload:

- [ ] **Identification at call start:** The opening of every call identifies: (1) the dental practice name, (2) CollectRx as the billing agent, (3) the purpose of the call (claim inquiry for claim ref X).

  Required script pattern: "Hello, this is [PRACTICE_NAME]'s billing representative, CollectRx, calling to inquire about the status of dental claim [CLAIM_REF]."

- [ ] **Caller ID displayed:** The outbound Twilio/Vapi number is not blocked. Verify in Twilio console that caller ID suppression is off.

- [ ] **Callback contact available:** The practice (or CollectRx as agent) provides a callback number that remains active for at least 60 days post-call. This should be the practice's phone number, stated in the call or available upon request.

- [ ] **Call hours:** All calls are Mon-Fri 9am-9:30pm local time. CollectRx's configured window (Mon-Fri 8am-5pm ET) is within bounds. Confirm the queue engine enforces this — no call fires outside this window.

- [ ] **No sequential dialing to the same number:** Verify the queue engine does not place concurrent calls to the same carrier phone number across multiple practices simultaneously. Max 3 attempts per claim, spread by retry logic.

### Billing Agent Authorization (BAAL)

- [ ] Every practice has signed a Billing Agent Authorization Letter before any calls are placed to any carrier on their behalf. Template prompt: `docs/compliance/LEGAL-REVIEW-PROMPT.md` Document 1.
- [ ] The BAAL is on file (practice settings `authorizationSubmitted: true`, `authorizationSubmittedAt` set) for each enabled carrier.
- [ ] **`checkCarrierAuthorizationGate()` enforces BAAL** in `validateDispatch()` — calls are hard-blocked without authorization. Verified in `src/carriers/adapter.ts`.
- [ ] Provider number is non-empty for each enabled carrier (same gate).
- [ ] Voice agent enabled (`voiceAgentEnabled: true`) before dispatch (same gate).
- [ ] BAAs are retained. The letter establishes that CollectRx is an authorized billing representative — this is the due diligence record if CRTC or a carrier ever investigates.

### PHI Boundary (PHIPA / PIPEDA)

**Decision:** Option B — ephemeral PHI via Vapi call variables. See `docs/compliance/PHI-VAPI-BOUNDARY.md`.

- [ ] Patient name, DOB, and health card number never appear in Vapi **metadata** or logs.
- [ ] PHI is injected only via ephemeral `variables` at `initiateCall()` time.
- [ ] `phiAuditService.log()` / `PHI_TOKEN_RESOLVED` audit on every detokenization event.
- [ ] The PHI access log is append-only and queryable by platform admin.
- [ ] PHI is encrypted at rest (AES-256-GCM, per security audit confirmation).
- [ ] BAAs / DPA-equivalents signed with Vapi, Twilio, SendGrid, and Stripe before production scale (operator/legal — see `LEGAL-REVIEW-PROMPT.md` Document 5).

### PIPEDA / Breach Protocol

- [ ] A breach notification procedure exists and is documented. In Canada: if a breach creates "real risk of significant harm," affected individuals must be notified promptly and the OPC must be notified.
- [ ] The security hardening doc (`SECURITY-HARDENING-2026-05-29.md`) is current. Review the open items.
- [ ] Annual pen test is scheduled (marked as P5-11 in the outstanding fixes doc — still operator/external, not in code).

### Collections Content Review (CRTC Adjacent)

- [ ] Email reminder templates (`collectrx-email-templates.md`) have been reviewed by counsel for CASL commercial electronic message compliance (timing, unsubscribe mechanism, sender identification).
- [ ] SMS messages (if any) comply with CASL and include STOP keyword handling.
- [ ] No reminder content threatens legal action that is not actually authorized/intended.

---

## CRTC 2026-132 Watch Protocol

CRTC Notice of Consultation 2026-132 is examining whether AI voice synthesis requires heightened consent for "interactive voice response" equivalents.

Monitor at: https://www.crtc.gc.ca/eng/archive/2026/2026-132.htm

**If a rule change is issued requiring express consent for AI voice calls to business lines:**
1. Immediately suspend all outbound Vapi calls
2. Notify all practices
3. Legal review within 48 hours
4. Assess whether the Billing Agent Authorization Letter satisfies any new consent requirement
5. Resume only after legal sign-off

This is the single regulatory scenario that could kill the product. Track it.

---

## Provider Number Compliance

Each practice must have a valid provider number registered with each carrier before CollectRx places calls to that carrier on their behalf. This is both a CRTC compliance matter (caller identification) and a carrier agreement matter.

Check `PracticeSettings.tsx` carrier configuration table:
- [ ] Provider number field is editable and validated (non-empty, max 50 chars)
- [ ] Authorization submitted toggle and date are visible per carrier
- [ ] Queue engine blocks calls to carriers where `authorizationSubmitted === false` (or confirm deliberate soft enforcement)

---

## How to Run This Agent

```
"Run the CollectRx compliance check. Review: (1) the Vapi system prompt at Collect-RX-main/vapi-system-prompt.md for CRTC UTR Part IV Rule 4 identification requirements; (2) the queue engine for call hour enforcement and authorization submitted gate; (3) the PHI audit log for completeness. Check the CRTC 2026-132 notice page for any decision update. Report using the compliance-checker.md format: checked items, gaps, and any CRTC 2026-132 status update."
```

---

## Regulatory Citations

- CRTC Unsolicited Telecommunications Rules (UTR), Parts II, III, IV: https://www.crtc.gc.ca/eng/trules-reglest.htm
- UTR Part IV Rule 4 (non-solicitation ADAD): https://crtc.gc.ca/eng/phone/telemarketing/tobligations/rules-regles.htm
- Telecommunications Act, S.C. 1993, c. 38, s. 72.07 (fines)
- CRTC 2026-132 (active AI voice review): https://www.crtc.gc.ca/eng/archive/2026/2026-132.htm
- PHIPA, S.O. 2004, c. 3, Sched. A
- PIPEDA, S.C. 2000, c. 5
- CASL, S.C. 2010, c. 23 (not applicable to voice — documented for reference)
