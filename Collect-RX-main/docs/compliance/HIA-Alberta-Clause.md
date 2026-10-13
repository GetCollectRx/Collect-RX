# HIA-Alberta Compliance Clause
## CollectRx Legal Compliance Framework — v1.1
### Alberta Health Information Act (HIA) — AI Scribe Technology and Custodianship

> Reviewed against research 2026-10-13; not legal advice; see policy-research/SYNTHESIS.md.

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

Under **HIA s. 60.1(1)**, an affiliate must notify the custodian as soon as practicable of any loss of, or unauthorized access to or disclosure of, health information. Under **HIA s. 66(2)**, a custodian that engages an information manager needs a written agreement with it. The affiliate definition in s. 1(1)(a) includes an information manager and persons acting under a contract or agency relationship (VERIFIED in `policy-research/health-privacy.md`, row 19).

The duties summarized below are the intended design. Counsel must confirm the wording against the statute (PENDING_COUNSEL).

**CollectRx's position:** CollectRx is an **affiliate** and information manager of Alberta dental practices (custodians). CollectRx processes health information (patient claim data, procedure codes, eligibility information) on behalf of practices.

### 2.2 Information Manager Agreement Requirement

Before processing any Alberta patient health information, CollectRx must have a written information manager agreement under HIA s. 66(2) with each Alberta dental practice. Earlier drafts called this an "HIA Affiliate Agreement"; that name is not a statutory instrument. The agreement must specify:
- The health information CollectRx may access
- The purposes for which it may be used
- Security safeguards in place
- Breach notification obligations
- The custodian's right to audit CollectRx's compliance

**Template:** an information manager schedule for Alberta customers is to be added to CollectRx's standard Service Agreement. It is not yet drafted (PENDING_COUNSEL).

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
- Patient name, DOB and policy numbers reach the voice agents only as ephemeral call variables at dispatch. They are not tokenized away before reaching the voice agent (see `PHI-VAPI-BOUNDARY.md`)

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

Only HIA ss. 1(1)(a), 1(1)(p.1), 60.1, 66 and 107 were read for this document. Every other section number in the table below is unverified and is PENDING_COUNSEL. The "CollectRx's Role" column describes intended product behaviour, not a statutory conclusion.

| Obligation | HIA Section | CollectRx's Role |
|-----------|------------|-----------------|
| Safeguard health information | s. 60 (not read) | CollectRx provides AES-256 encryption, tokenization, audit logs |
| Notify patients of collection | s. 19 (not read) | Practice responsible for patient disclosure |
| Limit collection to what is necessary | s. 13 (not read) | CollectRx collects only claim-relevant data |
| Retain for minimum required period | s. 35 (not read) | Retention period not set; "10 years" figure is unverified (PENDING_COUNSEL) |
| Notify custodian of a privacy breach | s. 60.1(1) (affiliate duty) | CollectRx notifies practice; practice's own duty to notify the OIPC is not read (PENDING_COUNSEL) |
| Respond to access requests | s. 7-12 (not read) | Practice handles; CollectRx's extract turnaround is a proposed SLA (PENDING_COUNSEL) |

---

## 5. Data Residency — Alberta

Alberta HIA does not prohibit storage of health information outside Alberta, but requires:
- Written agreements with out-of-province custodians/affiliates
- Equivalent protection to HIA standards
- Disclosure in the privacy notice that information may be stored outside Alberta

CollectRx's PostgreSQL deployment is hosted on Fly.io in `yyz` (Toronto, Canada), confirmed via `fly postgres list` / `fly status` on 2026-07-05. CollectRx previously ran on Railway; that deployment has been fully decommissioned. Alberta patient records stored in the database reside in this Canadian instance.

This statement covers the database only. Voice, telephony and model sub-processors in the call chain process data outside this instance. Their residency is not established by any vendor contract in the repository (PENDING_COUNSEL; see `policy-research/SYNTHESIS.md`, section 9).

---

## 6. Breach Notification Protocol (HIA s. 60.1)

If a privacy breach occurs involving Alberta patient health information:

1. CollectRx notifies the Alberta dental practice (custodian) as soon as practicable, as HIA s. 60.1(1) requires. The **24 hour** target is a proposed contract SLA, not a statutory period (PENDING_COUNSEL)
2. Practice assesses whether the breach creates a **real risk of significant harm** to patients. The threshold and the practice's notice duties are not read in this document (PENDING_COUNSEL)
3. If yes: Practice notifies affected patients and the Alberta OIPC, per the custodian duties counsel confirms
4. CollectRx provides a full incident report within **72 hours** of detection. This is a proposed contract SLA, not a statutory period (PENDING_COUNSEL)

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
- OIPC Order H-2023-001 (AI in Healthcare guidance). Not read for this document (PENDING_COUNSEL)
- CDCP Provider Agreement, Sun Life Financial
