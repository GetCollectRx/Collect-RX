# Carrier Terms of Service Research — AI Call Policy

**Date:** 2026-06-23  
**Purpose:** Determine whether any of the six in-scope Canadian dental insurance carriers explicitly prohibit AI-initiated calls from dental providers before Kill Test 1  
**Methodology:** Public web search of provider documentation, portals, and CDA resources

---

## Summary Table

| Carrier | Explicit Prohibition | Portal Available | Kill Test 1 Posture |
|---|---|---|---|
| Sun Life Financial (incl. CDCP) | UNKNOWN | YES | GO |
| Canada Life | UNKNOWN | YES | GO |
| Manulife | UNKNOWN | YES | CAUTION |
| Green Shield Canada | UNKNOWN | YES | GO |
| RBC Insurance | UNKNOWN | YES | GO |
| TELUS AdjudiCare | UNKNOWN | YES | CAUTION |

**No carrier returned a DO NOT CALL finding.** No public provider documentation from any of the six carriers was found that explicitly prohibits automated or AI-initiated inbound calls to provider/claims lines.

**All six carrier provider agreements are behind authenticated portals.** Explicit prohibition cannot be confirmed from public sources. Full agreement review requires carrier relations outreach (see Pre-Kill Test Actions below).

---

## CRTC Baseline

CollectRx's use case — dental practice calling insurer provider line to follow up on a submitted claim — is a B2B non-solicitation interaction. The National DNCL Rules (UTR Part II) do not apply. The ADAD Rules (UTR Part IV) do apply: caller must disclose automated nature, practice name, and callback number within 10 seconds of live rep answering.

Source: [CRTC UTR](https://www.crtc.gc.ca/eng/trules-reglest.htm) | [CRTC B2B obligations](https://crtc.gc.ca/eng/phone/telemarketing/tobligations.htm)

---

## Carrier Detail

---

### Sun Life Financial (including CDCP)

**Explicit prohibition:** UNKNOWN — No public provider agreement language found prohibiting automated calls. CDCP Billing Agreement is publicly available but does not address inbound call modality.

**Portal available:** YES  
- General provider hub: https://www.sunlife.ca/sl/provider/en/  
- Sun Life Direct (authenticated): https://login.sunlifeconnect.com/commonlogin/  
- CDCP provider portal: https://www.sunlife.ca/sl/cdcp/en/provider/

**CRTC-related language in public docs:** Not found

**Phone confirmation:** 1-888-700-0955 (general provider) | CDCP Contact Centre: 1-888-888-8110

**Kill Test 1 posture: GO**

**Recommendation:** Sun Life Direct portal handles eligibility and claim status self-serve. AI calls are appropriate for complex escalation or denial disputes where portal resolution is insufficient. CDCP contact number in `cdcp_sunlife.json` (`1-866-509-1444`) differs from CDCP Contact Centre listed in public docs (`1-888-888-8110`) — verify before Kill Test 1.

**Source:** [Sun Life Provider Hub](https://www.sunlife.ca/sl/provider/en/) | [CDCP Provider Page](https://www.sunlife.ca/sl/cdcp/en/provider/) | Full provider agreement: UNCONFIRMED — behind auth wall

---

### Canada Life

**Explicit prohibition:** UNKNOWN — No public language found. Provider documentation focuses on EDI and portal usage.

**Portal available:** YES  
- providerConnect: https://providerconnect.ca/  
- Dental provider site: https://www.welcome.canadalife.com/dental-provider  
- Supports: claim status, predetermination status, 12-month statement history

**CRTC-related language in public docs:** Not found

**Phone confirmation:** 1-800-957-9777 confirmed (Mon–Fri 8am–8pm ET)

**Kill Test 1 posture: GO**

**Recommendation:** providerConnect covers claim status and eligibility self-serve. AI calls viable for claim follow-up where portal escalation is needed. Note: Canada Life minimum claim wait is day 32 — no call before this date.

**Source:** [Canada Life Dental Provider FAQ](https://www.welcome.canadalife.com/dental-provider/faq.html) | [providerConnect](https://providerconnect.ca/) | Full provider agreement: UNCONFIRMED — behind auth wall

---

### Manulife

**Explicit prohibition:** UNKNOWN — No public language found. Provider-facing documentation is largely member/plan-focused.

**Portal available:** YES  
- providerConnect: https://providerconnect.ca/ (dental claims route through providerConnect for EDI providers)  
- SecureServe (member-facing): https://portal.manulife.ca/secureserve

**CRTC-related language in public docs:** Not found

**Phone confirmation:** CAUTION — public docs cite 1-800-268-3763 (general claims); prior config has 1-800-268-6195. Discrepancy must be verified directly before calling.

**Kill Test 1 posture: CAUTION** — phone number must be confirmed before calling

**Recommendation:** Confirm correct provider claims follow-up number. providerConnect path is available and preferred. Use AI calls only when portal resolution fails.

**Source:** [Manulife Group Benefits Support](https://www.manulife.ca/personal/support/group-plans/group-benefits.html) | [TELUS Health Manulife eClaims FAQ](http://plus.telushealth.co/page/eclaims/help/FAQ/Manulife.htm) | Full provider agreement: UNCONFIRMED — behind auth wall

---

### Green Shield Canada

**Explicit prohibition:** UNKNOWN — No public language found. Documentation focuses on EDI submission via CDAnet and providerConnect.

**Portal available:** YES  
- providerConnect: https://providerconnect.ca/  
- GSC Online Services: https://onlineservices.greenshield.ca/  
- GSC providerConnect page: https://mobile.greenshield.ca/en-ca/providerconnect  
- X-ray submission available via portal

**CRTC-related language in public docs:** Not found

**Phone confirmation:** 1-888-711-1119 confirmed in public claim submission guidelines

**Kill Test 1 posture: GO**

**Recommendation:** Strong portal coverage via providerConnect and GSC Online Services. AI calls are low-risk for escalation follow-up; portal should be primary channel.

**Source:** [GSC Claim Submission Guidelines](https://mobile.greenshield.ca/en-ca/plan-members/how-to-submit-a-claim/claim-submission-guidelines) | [GSC providerConnect](https://mobile.greenshield.ca/en-ca/providerconnect) | Full provider agreement: UNCONFIRMED — behind auth wall

---

### RBC Insurance

**Explicit prohibition:** UNKNOWN — No public language found. All provider documentation points to providerConnect for self-serve.

**Portal available:** YES  
- providerConnect: https://providerconnect.ca/  
- RBC providerConnect page: https://www.rbcinsurance.com/en-ca/group-benefits/providerconnect/  
- Supports: eligibility checks, claim submission, instant adjudication, direct deposit setup

**CRTC-related language in public docs:** Not found

**Phone confirmation:** 1-855-264-2174 confirmed (Mon–Fri 8:30am–8:30pm EST)

**Kill Test 1 posture: GO**

**Recommendation:** providerConnect is fully featured for claim status and eligibility. AI calls appropriate as fallback for complex predetermination or dispute resolution. RBC is a cost outlier at ~20-min average hold — deprioritize in queue scoring (see P2-5 cost rules).

**Source:** [RBC Insurance providerConnect](https://www.rbcinsurance.com/en-ca/group-benefits/providerconnect/) | [RBC Group Benefits Claims](https://www.rbcinsurance.com/en-ca/group-benefits/claims-service/) | Full provider agreement: UNCONFIRMED — behind auth wall

---

### TELUS AdjudiCare

**Explicit prohibition:** UNKNOWN — TELUS AdjudiCare is a TPA aggregator (Carrier ID 000034), not a direct insurer. The provider relationship is with the underlying TPA, not TELUS directly.

**Portal available:** YES  
- TELUS Health Provider Portal: https://providereservices.telushealth.com/  
- eClaims portal: https://plus.telushealth.co/  
- TELUS Health Registration Portal: https://registry.telushealth.co/  
- Real-time adjudication via portal

**CRTC-related language in public docs:** Not found

**Phone confirmation:** CAUTION — 1-800-667-3853 is listed in config; public sources cite 1-877-944-7100 (24/7 claims) and 1-866-272-2204 (general support). The correct number depends on the underlying TPA. TELUS minimum claim wait is day 21 (vs. day 32 for all other carriers).

**Kill Test 1 posture: CAUTION** — AI calls must target the correct underlying TPA, not the AdjudiCare aggregator line directly. Run `identifyTelusPlan()` from the group number prefix before any TELUS call.

**Recommendation:** Verify correct TPA contact per practice before deploying call campaigns. Portal path preferred. The TPA identification logic already exists in the codebase (`identifyTelusPlan()` in `src/services/eligibility/rules/`).

**Source:** [TELUS AdjudiCare FAQ](https://plus.telushealth.co/page/eclaims/help/FAQ/AdjudiCare.htm) | [TELUS Health Dental Claims](https://www.telus.com/en/health/organizations/group-health-benefits/insurers/dental-claims) | Full provider agreement: UNCONFIRMED — behind auth wall

---

## Pre-Kill Test 1 Actions Required

Before any live call is made, complete the following:

1. **Confirm Manulife provider claims phone number** — 1-800-268-6195 vs. 1-800-268-3763. Call directly or contact Manulife provider relations to confirm.

2. **Confirm CDCP Contact Centre number** — `cdcp_sunlife.json` has 1-866-509-1444; public docs show 1-888-888-8110. These may serve different functions — verify with Sun Life provider relations.

3. **Confirm TELUS underlying TPA number per practice** — Do not call the generic AdjudiCare line. Ensure `identifyTelusPlan()` is wired into the call dispatch for TELUS claims.

4. **Request full provider agreements from each carrier** — Only way to confirm no contractual prohibition. Contact provider relations at each carrier. Use the BAAL (Billing Agent Authorization Letter) outreach as the vehicle — providers expect this from billing agents.

5. **Run IVR validation test calls (Kill Test 1)** — Manual test call to each GO carrier before deploying automated calls. Document IVR tree changes since carrier configs were last verified.

---

## What Was Not Found

The following items are behind authenticated portals and cannot be confirmed from public sources:

- Full provider agreements with AI/automated-call clauses
- Carrier-specific incident response procedures for automated callers
- Internal fraud detection or bot-detection policies

These require direct carrier relations contact. This document records the extent of publicly available research as of 2026-06-23.
