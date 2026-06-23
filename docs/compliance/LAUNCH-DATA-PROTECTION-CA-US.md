# Launch readiness — data protection (Canada & US)

**This is not legal advice.** Privacy and health-information law depends on your **role** (controller vs processor), **who your customers are** (covered entity vs not), **what data you process**, and **which provinces/states** apply. **Counsel and a qualified DPO/privacy lead** should sign off before you represent compliance to customers or regulators.

This document helps **engineering and GTM** prepare for **scrutiny** (customer security reviews, diligence, regulator-style questions) by mapping **what the codebase and ops already support** vs **what you must prove outside git**.

---

## 1. Laws people will name (high level)

| Region | Frameworks customers/regulators often cite | Typical “scrutiny” focus |
|--------|---------------------------------------------|---------------------------|
| **Canada** | **PIPEDA** (federal private sector); **provincial** private-sector laws (AB/BC/QC etc.); **health** — **PHIPA** (Ontario example) or other provincial health statutes for PHI held by health info custodians | Accountability, **safeguards** (encryption, access control), **breach notification**, openness/transparency, individual **access/correction**, vendor **contracts**, **retention** |
| **United States** | **HIPAA** Security & Privacy Rules (if you or your customer is a **covered entity** or you are a **business associate** handling PHI); **FTC** Act / **Safeguards Rule** (financial institutions — scope depends on activities); **state** laws (e.g. **CPRA/CCPA** in California for certain personal information) | **BAA** / DPAs, **minimum necessary**, **audit** capability, encryption in transit, **risk analysis**, incident response, consumer rights where applicable |

**No single “checkbox” in code equals “compliant.”** Auditors look at **people + process + vendors + evidence** as well as product.

---

## 2. Technical controls already aligned (Collect-RX-main)

Use these as your **evidence anchors** in questionnaires:

| Topic | Where it lives |
|-------|----------------|
| **Encryption in transit** | TLS to Postgres enforced in prod (`databaseTls.ts`); HTTPS/HSTS/Helmet on API (`src/server/index.ts`); optional strict Node HTTPS (`tls/nodeHttpsSettings.ts`). Doc: `Collect-RX-main/docs/operations/DATA-ENCRYPTION.md`. |
| **Encryption at rest (host)** | Your **Postgres host** (e.g. Railway) volume / TDE settings — **enable and screenshot** in vendor console; reference in DPA. |
| **Secrets / key separation** | Env + optional AWS SSM `SecureString` (`src/config/secrets.js`); never commit `.env`. PHI field key: `PHI_ENCRYPTION_KEY` from KMS when using `phiAtRest`. |
| **Application-layer PHI encryption (optional)** | AES-256-GCM + audit (`src/server/crypto/phiAesGcm.ts`, `phiAtRest.ts`, `phiCryptoAudit.ts`). |
| **PHI minimization for voice** | PII vault tokenization (`src/services/pii-vault.ts`); security audit Phase 0 (`Collect-RX-main/docs/audit/security-audit.md`). |
| **Access control** | Practice-scoped JWT/session (`authToken`, routes); admin audit log model (`AuditLog` / Phase 5 compliance doc). |
| **Abuse / integrity** | Rate limits, webhook HMAC, CORS allowlist (see security audit). |
| **SAST / CI** | Semgrep + tests (see `PHASE5-COMPLIANCE.md`). |

**Gap to plan explicitly:** **Per-field encryption** is **opt-in** until you migrate columns and wire `phiAtRest` on read/write. Plaintext-at-ORM is still the default for many tables — be honest in DPIAs and customer data maps.

---

## 3. Non-code artifacts scrutiny will ask for

Have these **named owners** and **locations** (wiki / drive), even if drafts:

1. **Record of processing / data map** — categories of data, purposes, retention, subprocessors (SendGrid, Twilio, Stripe, Vapi, host, etc.).
2. **Privacy policy + internal data retention schedule** — aligned with `LegalPrivacy.tsx` and actual DB behaviour.
3. **DPAs / BAAs** — signed with each **subprocessor** that touches personal or health information (see `PHASE5-COMPLIANCE.md` P5-05).
4. **Incident / breach playbooks** — who decides notification, timelines for Canada vs US, logging preservation. Cross-link `PIPEDA-PROVINCIAL.md`.
5. **Risk assessment / DPIA** — especially for AI voice, transcripts, cross-border transfer (if US data in Canada-hosted DB or vice versa — **document** residency and transfers).
6. **Pen test / vuln management** — `PEN-TEST-TRACKER.md`; dependency audit cadence (`NPM-AUDIT.md`).
7. **HIPAA gap review** — `HIPAA-GAP-REVIEW-TEMPLATE.md` filled with owners and dates.

---

## 4. “Pass scrutiny” — practical test prep

| Question you will get | Strong answer pattern |
|------------------------|------------------------|
| Is data encrypted in transit? | Yes — HTTPS to app; TLS to Postgres (`sslmode=require` enforced in prod); Redis TLS if `rediss://`. |
| Is data encrypted at rest? | **Host/DB** encryption per provider + optional **field-level** AES-GCM for selected attributes with KMS key. |
| Who can access PHI? | Role/practice scoping, JWT sessions, audit log for admin actions; list operational access (support) in policy. |
| What happens on breach? | Written procedure + contacts; not only a tech runbook. |
| Do you have BAAs/DPAs? | **Executed copies** — legal holds originals. |
| Is the product “HIPAA compliant”? | Only counsel should claim that; engineering provides **Safeguards Rule–style** evidence (access, audit, integrity, transmission). |

---

## 5. Related docs (read in order)

1. [PHASE5-COMPLIANCE.md](PHASE5-COMPLIANCE.md) — program checklist tied to product.
2. [Collect-RX-main/docs/operations/DATA-ENCRYPTION.md](../../Collect-RX-main/docs/operations/DATA-ENCRYPTION.md) — crypto implementation detail.
3. [Collect-RX-main/docs/audit/security-audit.md](../../Collect-RX-main/docs/audit/security-audit.md) — resolved security findings.
4. [PIPEDA-PROVINCIAL.md](PIPEDA-PROVINCIAL.md) — Canada jurisdictional starter.
5. [HIPAA-GAP-REVIEW-TEMPLATE.md](HIPAA-GAP-REVIEW-TEMPLATE.md) — US HIPAA-style gap table.

---

*Engineering maintains controls; legal/compliance owns regulatory interpretation and customer-facing commitments.*
