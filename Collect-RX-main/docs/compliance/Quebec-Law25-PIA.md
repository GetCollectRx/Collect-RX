# Privacy Impact Assessment (PIA)
## CollectRx — Quebec Market Entry
### Pursuant to Quebec Law 25 (Act 64) — *Loi modernisant des dispositions législatives en matière de protection des renseignements personnels*

> Reviewed against research 2026-10-13; not legal advice; see policy-research/SYNTHESIS.md.

**Document Version:** 1.0  
**Prepared By:** CollectRx Compliance Team  
**Date:** May 2026  
**Status:** Draft — Pending Privacy Officer Sign-Off  
**Applicable Legislation:** Law 25 (Quebec), LPRPDE (Federal), PHIPA (Ontario, for cross-provincial reference)

---

## 1. Purpose and Scope

This Privacy Impact Assessment (PIA) is prepared pursuant to **Section 3.3 of Quebec Law 25**, which requires any enterprise collecting, using, or communicating personal information ("renseignements personnels") to conduct a formal PIA before deploying any new technology involving such information.

**Scope:** This PIA covers the deployment of CollectRx's AI-powered dental insurance accounts-receivable automation platform within Quebec dental practices, including:
- Voice agent interactions with insurance carriers (CDCP, Sun Life, Canada Life, Manulife, Green Shield, RBC, TELUS)
- Patient record tokenization and PHI vault operations
- Eligibility and estimate calculations
- CDCP reconsideration workflows (Phase 5)

Patient-facing payments are outside the product scope (see the repo `CLAUDE.md`, product boundary) and outside this PIA.

---

## 2. Personal Information Collected and Processed

### 2.1 Patient Information (Protected Health Information — PHI)

| Category | Data Elements | Purpose | Retention |
|----------|--------------|---------|-----------|
| Identifiers | Patient name, date of birth, health card number | Stored tokenized in the PHI vault. Name and date of birth are sent to voice agents only as ephemeral call variables at dispatch, never in metadata and never in stored call records (see `PHI-VAPI-BOUNDARY.md`) | PENDING_COUNSEL (a 7 year period was cited without a verified source) |
| Insurance | Plan number, group number, member ID | Eligibility verification; policy and group numbers are sent to voice agents as ephemeral call variables | PENDING_COUNSEL |
| Clinical | CDT/CDA procedure codes, diagnosis codes, treatment dates | Estimate calculation, reconsideration | PENDING_COUNSEL |
| Financial | Insurance claim balances and adjudication history | Insurance AR follow-up | PENDING_COUNSEL |

### 2.2 Practice Information

| Category | Data Elements | Purpose |
|----------|--------------|---------|
| Provider | Dentist name, provider number, practice address | Carrier authentication, CDCP provider registration |
| Operational | Queue configuration, carrier priority settings | Platform configuration |

### 2.3 Data NOT Collected
- Patient social insurance numbers (SIN)
- Patient photographs
- Full clinical notes (only structured codes processed)
- Banking credentials

---

## 3. Data Residency (Quebec Law 25 — Key Requirement)

### 3.1 Current Architecture
All CollectRx data is hosted on **Fly.io PostgreSQL**, in the **`yyz` (Toronto, Canada)** region — confirmed via `fly status` on 2026-07-05. CollectRx previously ran on Railway; that deployment has been fully decommissioned.

### 3.2 Quebec Law 25 Requirement
Quebec Law 25 (Section 17, as enacted) requires that any communication of personal information outside Quebec must be:
1. Subject to a **Privacy Impact Assessment** (this document)
2. Governed by a written agreement ensuring equivalent protection

Approval of the transfer by the **Privacy Officer** is not in the enacted text read for this document. Whether it is required is a counsel question (PENDING_COUNSEL).

### 3.3 Compliance Actions Required

**Action 1: Database residency (partial, 2026-07-05).**
CollectRx's Postgres instance is hosted on Fly.io in `yyz` (Toronto, Canada), confirmed via `fly postgres list` / `fly status`. Stored records, including Quebec practices, reside in this Canadian instance. This does not establish residency for data processed by sub-processors in the call chain (see Action 2). No separate Quebec-specific instance is required for the database.

**Action 2 — Data Transfer Agreement:**
If any Quebec PHI transits to US infrastructure (e.g., Vapi.ai voice processing, OpenAI/Anthropic inference), a written **Cross-Border Data Transfer Agreement** must be executed with each vendor, confirming:
- Data is processed only for the stated purpose
- Data is not retained beyond the call duration by third-party AI providers
- Equivalent protection to Quebec Law 25 is maintained

**Action 3 — Consent Framework:**
Quebec Law 25 requires **clear, specific consent** (not bundled consent) for:
- Collection of personal information for AI processing
- Communication of information to voice agents
- Use of information for purposes other than the original stated purpose

Dental practices must obtain this consent from patients as part of their intake process. CollectRx intends to provide a **model consent clause** for practices to integrate into their patient intake forms. No template exists in the repository yet (PENDING_COUNSEL for the wording).

---

## 4. Privacy Officer Designation

### 4.1 Requirement
Quebec Law 25 (Section 3.1) requires every enterprise to designate a **Privacy Officer** ("responsable de la protection des renseignements personnels") who is responsible for:
- Ensuring compliance with Law 25
- Handling access requests and complaints
- Publishing the privacy policy
- Overseeing PIAs

### 4.2 CollectRx Privacy Officer

**Designated Role:** Chief Privacy Officer (CPO)  
**Contact:** [privacy@collectrx.ca — to be established before Quebec market entry]  
**Published Policy URL:** [https://collectrx.ca/privacy — to be published before Quebec market entry]  

**Responsibilities under this PIA:**
- Review and sign off on this PIA
- Approve any cross-border data transfers
- Maintain the PIA register
- Respond to patient access requests within **30 days** (Law 25 requirement)
- Notify the Commission d'accès à l'information (CAI) of any privacy incident **promptly** if the incident presents a risk of serious injury. The enacted s. 3.5 text reads "promptly" and states no fixed number of hours (`policy-research/private-sector-privacy.md`, row 13)

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Identifiers sent to voice agents beyond what a call needs | Medium | High | Ephemeral call variables only; metadata is UUID-only (boundary test). Per-call-type variable allowlist is planned, not built |
| Data processed outside Canada by sub-processors without a PIA reference | Medium | High | Database is in `yyz` (Toronto, Canada) as of 2026-07-05. Sub-processor residency and transfer agreements are not established (Action 2, PENDING_COUNSEL) |
| Patient consent not obtained for AI processing | Medium | High | Model consent clause not yet drafted (PENDING_COUNSEL) |
| Privacy incident not reported promptly to CAI | Low | High | Implement automated incident detection and CAI notification workflow |
| Vapi.ai retains call transcripts containing identifiers | Unknown | Medium | Recording disabled. Name, DOB and policy numbers are sent as ephemeral variables. Vapi transcript retention and the Vapi DPA are not yet confirmed (see `PHI-VAPI-BOUNDARY.md`) |
| Patient access request not fulfilled within 30 days | Low | Medium | Implement access request portal |

---

## 6. Mandatory Disclosures (Law 25, Section 8)

Before collecting personal information from Quebec residents, CollectRx (and the dental practices using CollectRx) must disclose:
1. The name and contact information of the Privacy Officer
2. The purposes for which the information is collected
3. The rights of the person (access, rectification, withdrawal of consent)
4. Whether the information will be communicated outside Quebec
5. Whether automated decision-making will be used (yes — AI estimate calculation)

---

## 7. Sign-Off and Review Schedule

| Milestone | Date | Signatory |
|-----------|------|-----------|
| PIA Draft Completed | May 2026 | Compliance Team |
| Privacy Officer Review | Before Quebec pilot | CPO |
| CAI Submission (if required) | Before Quebec launch | CPO |
| Annual PIA Review | May 2027 | CPO |

---

## 8. References

- *Loi 25, Loi modernisant des dispositions législatives en matière de protection des renseignements personnels* (Quebec, 2021)
- Commission d'accès à l'information (CAI): https://www.cai.gouv.qc.ca
- LPRPDE / PIPEDA (Federal)
- CDCP Provider Agreement, Sun Life Financial
