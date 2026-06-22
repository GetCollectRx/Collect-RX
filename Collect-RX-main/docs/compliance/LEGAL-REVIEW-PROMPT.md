# Legal Review Package — Prompt for Counsel

Use the prompt below with a Canadian healthcare/telecom lawyer (Ontario bar preferred for
PHIPA). Paste it into your AI assistant to **draft first versions**, then send all outputs
to counsel for review, redlines, and execution.

**CollectRx context docs to attach:**
- `docs/compliance/REGULATORY-LANES.md`
- `docs/compliance/PHI-VAPI-BOUNDARY.md`
- `src/server/canadianExpansion/complianceDisclosures.ts` (ADAD disclosure script)
- `src/pages/LegalTerms.tsx` and `LegalPrivacy.tsx` (existing app templates)

---

## Master prompt (copy everything below this line)

```
You are a Canadian lawyer specializing in healthcare privacy (PHIPA, PIPEDA), dental
practice regulation, and CRTC telecommunications rules. Draft a complete legal document
package for CollectRx Inc., a Canadian SaaS company that provides automated insurance
accounts-receivable follow-up for dental practices.

## What CollectRx does

CollectRx is software used by dental practices in Canada. On behalf of a dental practice,
CollectRx places outbound phone calls to insurance carrier **provider/claims business lines**
(not consumers) to inquire about the status of **existing dental insurance claims** for
**treatment already performed**. Calls use an automated voice system (Vapi.ai + Twilio).
Patient identifiers (name, DOB, policy number) are transmitted ephemerally during the call
only — not stored by the voice vendor long-term. The practice remains the data controller;
CollectRx acts as a service provider / authorized billing agent.

CollectRx is NOT telemarketing. Calls are non-solicitation claim status inquiries under
CRTC UTR Part IV Rule 4 (ADAD non-solicitation). CollectRx does not sell insurance, does
not call patients to collect money by phone, and does not market to carrier representatives.

Supported carriers: Sun Life, Canada Life, Manulife, Green Shield, RBC Insurance, TELUS
AdjudiCare (Canadian private dental insurance market).

Pricing: SaaS subscription $599–$1,499/month per practice (minutes-based tiers).

## Documents to draft

Produce each document as a separate section with a clear title. Use Canadian English.
Mark placeholders as [BRACKETS]. Flag any clause requiring province-specific customization.

---

### Document 1: Billing Agent Authorization Letter (BAAL)

**Purpose:** Signed by the dental practice (authorized signatory) and retained by CollectRx
before any carrier calls are placed. Establishes CollectRx as an authorized billing
representative for insurance follow-up calls.

**Must include:**
1. Practice legal name, address, phone, provider number(s) per carrier
2. Authorization of CollectRx Inc. to contact insurance carriers on the practice's behalf
   regarding claim status, denials, and payment inquiries
3. Scope: claim status follow-up only — not benefit sales, not patient collections by phone
4. List of carriers covered (checkbox table: Sun Life, Canada Life, Manulife, Green Shield,
   RBC Insurance, TELUS AdjudiCare)
5. Acknowledgment that calls may use automated voice technology with required CRTC disclosure
6. Practice responsibility to maintain accurate provider registration with each carrier
7. Term and termination (30 days written notice; immediate termination for compliance breach)
8. Indemnification (reasonable, mutual where appropriate)
9. Signature block: practice owner / authorized officer, date, printed name, title
10. CollectRx acknowledgment counter-signature block (optional)

**Tone:** One page preferred, two pages maximum. Plain language suitable for a dental office
manager to understand.

---

### Document 2: CollectRx Platform Agreement (Practice Terms of Service)

**Purpose:** Master agreement between CollectRx and each subscribing dental practice.

**Must include:**
1. Service description (insurance AR follow-up automation, dashboard, CSV import, optional PMS connector)
2. Practice obligations: accurate data, BAAL execution, provider numbers, authorized users,
   compliance with carrier rules, no misuse
3. CollectRx obligations: PHIPA/PIPEDA-aligned handling, ADAD disclosure on calls, uptime
   targets (best efforts), support
4. Fees, billing, trial terms (30-day trial, 500 minutes, no card required)
5. Data ownership: practice owns patient/practice data; CollectRx owns software and anonymized analytics
6. PHI handling: tokenization, subprocessors (Vapi, Twilio, SendGrid, Stripe, Railway/hosting),
   breach notification timeline
7. Limitation of liability (cap at fees paid in prior 12 months — propose reasonable cap)
8. No guarantee of claim outcomes or recovery amounts
9. Termination, data export, deletion timeline
10. Governing law: [Ontario / user's province — flag for counsel]
11. Dispute resolution

---

### Document 3: Privacy Policy (Public — collectrx.ca and in-app)

**Purpose:** Public-facing privacy policy for practices and their patients (PIPEDA + PHIPA).

**Must include:**
1. Who we are (CollectRx Inc., contact, privacy officer email)
2. What personal information and PHI we collect and why
3. Lawful basis / consent framework under PIPEDA and PHIPA
4. How PHI is protected (encryption, tokenization, access controls, audit logs)
5. Subprocessors and cross-border transfer (flag if any US hosting — Railway, Vapi, Twilio)
6. Retention periods (calls, transcripts, audit logs, account data)
7. Individual rights (access, correction, withdrawal of consent where applicable)
8. Breach notification commitment
9. Quebec Law 25 note (if scaling to Quebec)
10. Contact for privacy inquiries and complaints (IPC Ontario pathway)

---

### Document 4: Business Associate / Personal Information Processing Agreement

**Purpose:** PHIPA-aligned agreement where CollectRx processes personal health information
on behalf of the dental practice (health information custodian).

**Must include:**
1. Roles: practice = custodian, CollectRx = agent/service provider
2. Permitted uses and disclosures (insurance claim follow-up only)
3. Safeguards (technical and organizational measures — reference PHI-VAPI-BOUNDARY controls)
4. Subprocessor list and notification
5. Audit rights (reasonable)
6. Return/destruction of PHI on termination
7. Breach reporting (as soon as reasonably possible; within 72 hours as operational target)
8. Prohibition on further disclosure without authorization
9. Term aligned with Platform Agreement

---

### Document 5: Subprocessor BAA Checklist (Internal — for CollectRx operator)

**Purpose:** Checklist for CollectRx to execute DPAs/BAAs with vendors before production PHI.

List each vendor and the clauses to confirm in writing:
- Vapi.ai (voice AI — ephemeral PHI in call variables)
- Twilio (telephony transit)
- SendGrid (email — patient reminders, no PHI in subject lines)
- Stripe (payments — PCI scope)
- Railway or hosting provider (database hosting, region)
- Sentry (if enabled — no PHI in error payloads)

For each: data processed, retention, encryption, breach notification, Canadian data residency options.

---

### Document 6: Patient-facing collections messaging review (Email/SMS templates)

**Purpose:** Confirm patient AR reminder emails/SMS comply with CASL and provincial
collections practice standards.

Review principles (draft a short compliance memo, not full templates):
- Identification of sender (practice name + CollectRx as service provider)
- Unsubscribe mechanism (one-click)
- No false legal threats
- Reasonable frequency (max 5 reminders per cycle)
- No PHI in email subject lines

---

## Regulatory citations to reference in footnotes

- CRTC UTR Part IV Rule 4 (ADAD non-solicitation): https://crtc.gc.ca/eng/phone/telemarketing/tobligations/rules-regles.htm
- CRTC 2026-132 (AI voice consultation — note as active watch): https://www.crtc.gc.ca/eng/archive/2026/2026-132.htm
- PHIPA, S.O. 2004, c. 3, Sched. A
- PIPEDA, S.C. 2000, c. 5
- CASL, S.C. 2010, c. 23 (email only — note voice exempt)

## Output format

For each document:
1. Full draft text
2. [PLACEHOLDERS] clearly marked
3. "Counsel review notes" — bullet list of decisions needing lawyer judgment
4. Priority: Document 1 (BAAL) and Document 4 (PHIPA agent agreement) are **blocking for production calls**

Do not include US HIPAA boilerplate unless noting it does not apply to Canadian-only operations.
Do not over-promise claim recovery outcomes. Keep language accessible for dental office managers.
```

---

## After counsel returns signed documents

1. Store executed BAALs per practice per carrier (secure file store — not git)
2. Set `authorizationSubmitted: true` in Practice Settings only after BAAL is on file
3. Publish reviewed Terms and Privacy to `/legal/terms` and `/legal/privacy`
4. Execute vendor BAAs from Document 5 checklist
5. Update `docs/compliance/PHASE5-COMPLIANCE.md` tracker with execution dates

---

## Single-document shortcut

If counsel time is limited, prioritize **Document 1 (BAAL)** first. Without it, the hard gate
in `validateDispatch()` will block all carrier calls — which is correct behavior until
authorization is documented.
