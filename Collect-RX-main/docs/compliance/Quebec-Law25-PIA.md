# Privacy Impact Assessment (PIA)
## CollectRx — Quebec Market Entry
### Pursuant to Quebec Law 25 (Act 64) — *Loi modernisant des dispositions législatives en matière de protection des renseignements personnels*

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
- Patient payment collection (Phase 4)
- CDCP reconsideration workflows (Phase 5)

---

## 2. Personal Information Collected and Processed

### 2.1 Patient Information (Protected Health Information — PHI)

| Category | Data Elements | Purpose | Retention |
|----------|--------------|---------|-----------|
| Identifiers | Patient name, date of birth, health card number | Tokenization only — never transmitted to voice agents | 7 years (per OAQ/CDCP requirements) |
| Insurance | Plan number, group number, member ID | Eligibility verification | 7 years |
| Clinical | CDT/CDA procedure codes, diagnosis codes, treatment dates | Estimate calculation, reconsideration | 7 years |
| Financial | Outstanding balance, payment history | Patient AR, Stripe payment links | 7 years |

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
Quebec Law 25 (Section 17) requires that any communication of personal information outside Quebec must be:
1. Subject to a **Privacy Impact Assessment** (this document)
2. Governed by a written agreement ensuring equivalent protection
3. Approved by the enterprise's **Privacy Officer**

### 3.3 Compliance Actions Required

**Action 1 — Data Residency Declaration: RESOLVED (2026-07-05).**
CollectRx's Postgres instance is hosted on Fly.io in `yyz` (Toronto, Canada) — confirmed via `fly postgres list` / `fly status`. All practice and patient data, including Quebec practices, resides in this single Canadian instance. No separate Quebec-specific instance is required.

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

Dental practices must obtain this consent from patients as part of their intake process. CollectRx will provide a **model consent clause** for practices to integrate into their patient intake forms.

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
- Notify the Commission d'accès à l'information (CAI) of any privacy incident within **72 hours** if the incident presents a risk of serious injury

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| PHI transmitted to voice agent without tokenization | Low | Critical | PIIVault tokenization enforced in all code paths; unit tested |
| Data hosted outside Canada without consent | Low | High | Resolved — Postgres confirmed hosted in `yyz` (Toronto, Canada) as of 2026-07-05 |
| Patient consent not obtained for AI processing | Medium | High | Model consent clause provided to practices |
| Privacy incident not reported within 72 hours | Low | High | Implement automated incident detection and CAI notification workflow |
| Vapi.ai retains call transcripts containing PHI tokens | Low | Medium | All Vapi transmissions use UUID tokens only; Vapi DPA reviewed |
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
