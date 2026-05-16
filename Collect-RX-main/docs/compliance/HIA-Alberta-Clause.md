# HIA-Alberta Compliance Clause
## CollectRx Legal Compliance Framework — v1.1
### Alberta Health Information Act (HIA) — AI Scribe Technology and Custodianship

**Document Version:** 1.1  
**Supersedes:** v1.0 (PHIPA/PIPEDA only)  
**Jurisdiction:** Alberta  
**Prepared By:** CollectRx Compliance Team  
**Date:** May 2026  
**Applicable Legislation:** Alberta *Health Information Act* (RSA 2000, c H-5), Alberta OIPC Orders, CDCP Provider Agreement

---

## 1. Overview

Alberta's *Health Information Act* (HIA) governs the collection, use, and disclosure of "health information" by "custodians" (health professionals, including dentists) and "affiliates" (organizations acting on behalf of custodians — including CollectRx).

This clause updates the CollectRx Legal Compliance Framework to address:
1. **CollectRx's status as an "affiliate"** under the HIA
2. **AI Scribe designation** — whether CollectRx's AI voice agents qualify as AI scribes under OIPC guidance
3. **HIA custodianship obligations** — what Alberta dentists (custodians) must do when using CollectRx
4. **Compliance requirements specific to Alberta OIPC**

---

## 2. CollectRx as an HIA "Affiliate"

### 2.1 Legal Classification

Under **HIA Section 66**, a custodian may not use an affiliate to collect, use, or disclose health information unless:
- The affiliate uses the health information only as authorized by the custodian
- The affiliate protects health information in a manner consistent with the HIA
- The affiliate reports unauthorized disclosures to the custodian

**CollectRx's position:** CollectRx is an **affiliate** of Alberta dental practices (custodians). CollectRx processes health information (patient claim data, procedure codes, eligibility information) on behalf of practices.

### 2.2 Affiliate Agreement Requirement

Before processing any Alberta patient health information, CollectRx must execute a written **HIA Affiliate Agreement** with each Alberta dental practice. This agreement must specify:
- The health information CollectRx may access
- The purposes for which it may be used
- Security safeguards in place
- Breach notification obligations
- The custodian's right to audit CollectRx's compliance

**Template:** CollectRx's standard Service Agreement is updated in v1.1 to include an HIA Affiliate Schedule for Alberta customers.

---

## 3. AI Scribe Technology — OIPC Classification

### 3.1 Alberta OIPC Guidance

The Alberta **Office of the Information and Privacy Commissioner (OIPC)** has issued guidance indicating that AI tools that:
- Listen to or transcribe patient interactions
- Process clinical content in real time
- Generate clinical documentation

...may qualify as **"AI Scribes"** subject to enhanced disclosure requirements.

### 3.2 CollectRx AI Agent Classification

CollectRx's Vapi voice agents **do not qualify as AI scribes** under the OIPC definition because:
- They call **insurance carriers** — not patients
- They do not transcribe patient-provider clinical interactions
- They do not generate clinical documentation
- Patient PHI is tokenized before reaching any AI component

**However:** The CDCP Reconsideration Agent (Phase 5) references clinical evidence summaries during calls to Sun Life. CollectRx takes the position that this does not constitute AI scribe activity because:
- Clinical notes are summarized by the practice's staff, not transcribed by the AI
- The AI reads a pre-prepared summary — it does not generate clinical content
- No patient is present on the call

**Documentation Requirement:** Alberta practices must maintain a record confirming that CollectRx is used for **insurance AR automation**, not clinical documentation. This record must be available to the OIPC upon request.

### 3.3 If Future Features Qualify as AI Scribe

If CollectRx introduces any feature that listens to patient-provider interactions, transcribes clinical content, or generates clinical notes, a **separate HIA Scribe Addendum** must be executed before enabling that feature for Alberta practices, addressing:
- Patient consent for AI transcription (HIA Section 20)
- Retention and deletion of transcripts
- OIPC notification if the feature constitutes a new purpose for health information

---

## 4. HIA Custodianship Obligations for Alberta Dental Practices

Alberta dentists using CollectRx remain the **custodians** of patient health information and retain full custodianship obligations under HIA, including:

| Obligation | HIA Section | CollectRx's Role |
|-----------|------------|-----------------|
| Safeguard health information | s. 60 | CollectRx provides AES-256 encryption, tokenization, audit logs |
| Notify patients of collection | s. 19 | Practice responsible for patient disclosure |
| Limit collection to what is necessary | s. 13 | CollectRx collects only claim-relevant data |
| Retain for minimum required period | s. 35 | 10 years for health information (HIA Regulation) |
| Notify OIPC of privacy breach | s. 60.1 | CollectRx notifies practice within 24 hours; practice notifies OIPC |
| Respond to access requests | s. 7-12 | Practice handles; CollectRx provides data extract within 48 hours |

---

## 5. Data Residency — Alberta

Alberta HIA does not prohibit storage of health information outside Alberta, but requires:
- Written agreements with out-of-province custodians/affiliates
- Equivalent protection to HIA standards
- Disclosure in the privacy notice that information may be stored outside Alberta

CollectRx's current Railway PostgreSQL deployment may be in a US region. For Alberta customers, the same Canadian data residency recommendation as Quebec applies: deploy on `ca-central-1` (AWS Montreal). This is the recommended path before Alberta pilot launch.

---

## 6. Breach Notification Protocol (HIA s. 60.1)

If a privacy breach occurs involving Alberta patient health information:

1. CollectRx notifies the Alberta dental practice (custodian) within **24 hours**
2. Practice assesses whether the breach creates a **real risk of significant harm** to patients
3. If yes: Practice notifies:
   - Affected patients (without delay)
   - Alberta OIPC (without delay)
4. CollectRx provides a full incident report within **72 hours** of detection

---

## 7. Amendment History

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2024 | Initial framework (PHIPA, PIPEDA) |
| v1.1 | May 2026 | Added Alberta HIA affiliate clause, OIPC AI Scribe guidance, custodianship obligations, breach protocol |

---

## 8. References

- *Health Information Act*, RSA 2000, c H-5 (Alberta)
- Alberta OIPC: https://www.oipc.ab.ca
- OIPC Order H-2023-001 (AI in Healthcare — guidance)
- CDCP Provider Agreement, Sun Life Financial
