# Phase 5 — Security, privacy, compliance (CollectRx)

**Not legal advice.** Your counsel and DPO own sign-off. This file satisfies **documentation deliverables** in [OUTSTANDING-FIXES-PRODUCT-READY.md](../OUTSTANDING-FIXES-PRODUCT-READY.md) Phase 5 where the work is in-repo; operator/legal items are checklists.

---

## P5-01 — Data classification

| Class | Examples in Collect-RX (canonical app: `Collect-RX-main`) | Where stored | Default retention (program policy) |
|-------|-----------------------------------------------------------|--------------|------------------------------------|
| **PHI / PII** | Patient name, email, phone, treatment/procedure, balances, benefits estimates | PostgreSQL via Prisma (`PatientBalance`, `Patient`, `Balance`, …) | Until practice delete / legal hold; not auto-deleted in v1 |
| **PHI-minimal outbound** | First name + amount in SendGrid/SMS (by design) | Third-party in transit only | Per vendor retention |
| **Secrets** | API keys, `JWT_SECRET`, webhook secrets | Host env (Railway, etc.) | Rotate per [SECRETS-GO-LIVE.md](../operations/SECRETS-GO-LIVE.md) |
| **Non-PHI ops** | Stripe account ids, event ids, rule JSON | Same DB | Same as above |

Program-level notes: [PHI_DATA_CLASSIFICATION.md](../PHI_DATA_CLASSIFICATION.md) (may reference Click; align naming with this app for audits).

---

## P5-02 — Encryption at rest

- **PostgreSQL:** Rely on **hosting provider** disk/DB encryption (e.g. Railway/managed Postgres). Document in your **Data Processing Agreement** with the host.
- **Application:** TLS for HTTPS in front of the API; secrets not on disk in prod images except env injection.
- **Optional app-layer PHI:** AES-256-GCM helpers + PHIPA-style crypto audit lines — `Collect-RX-main/src/server/crypto/` and [DATA-ENCRYPTION.md](../../Collect-RX-main/docs/operations/DATA-ENCRYPTION.md). Enable per field with migrations + KMS-backed `PHI_ENCRYPTION_KEY` when a customer or regulator requires it.

**Operator:** enable encryption-at-rest for the prod database in the host console; capture evidence for audits.

---

## P5-03 — Field-level encryption (if required)

- **Default product path:** access control = login + `practiceId` scoping; most columns remain plaintext at the ORM layer unless you opt in.
- **When required:** use `phiAtRest` (`encryptPhiAtRest` / `decryptPhiAtRest`) + `PHI_ENCRYPTION_KEY` from KMS / secret manager; turn on `PHI_ENCRYPTION_AT_REST=1` in production only when the key is managed. Do not enable without key management and a migration plan for read/write paths.

---

## P5-04 — Audit log

- **Implementation:** `AuditLog` table (append-only in product code), `GET /api/admin/audit-log`, **Admin** UI, writes on: admin settings, synthetic balances, CSV import, rule update, patient A/R send reminder / write-off, public one-click email unsubscribe.
- **Not in scope for v1:** per-row “who read this patient” logging (would need policy + performance model).

---

## P5-05 — BAA / DPA with vendors

Checklist: SendGrid, Twilio, Stripe, Vapi, hosting/DB, backup vendor.  
Orientation: [PCI-BAA-STRIPE.md](PCI-BAA-STRIPE.md), [ENVIRONMENT-MATRIX.md](../ENVIRONMENT-MATRIX.md). **Signed** agreements are on you / legal, not in git.

---

## P5-06 — HIPAA gap review [L]

Use an internal or external **HIPAA Security/ Privacy Rule** checklist; track gaps in the issue tracker. The size of “open issues” is normal after first pass. See [HIPAA-GAP-REVIEW-TEMPLATE.md](HIPAA-GAP-REVIEW-TEMPLATE.md).

---

## P5-07 — Canada: PIPEDA / provincial

If Canadian patients: document **jurisdiction** (federal PIPEDA vs provincial private-sector laws), **breach notification** process, and contact for privacy requests. [PIPEDA-PROVINCIAL.md](PIPEDA-PROVINCIAL.md) is a short starter. For a **Canada + US launch** scrutiny map (technical vs legal artifacts), see [LAUNCH-DATA-PROTECTION-CA-US.md](LAUNCH-DATA-PROTECTION-CA-US.md).

---

## P5-08 — Collections law: message content

- **Code:** [Collect-RX-main/src/server/patients/messaging.ts](../../Collect-RX-main/src/server/patients/messaging.ts) (email/SMS copy), eligibility voice elsewhere.
- **You:** have counsel sign off on **frequency**, **hours**, **disclosures**, and **unsubscribe** for the jurisdictions you serve. [COLLECTIONS-MESSAGING-REVIEW.md](COLLECTIONS-MESSAGING-REVIEW.md).

---

## P5-09 — PCI scope

- **Model:** Stripe-hosted **Payment Links**; CollectRx does **not** process or store PAN/CVC.  
- **Doc:** [PCI-SCOPE-COLLECTRX.md](PCI-SCOPE-COLLECTRX.md) and [PCI-BAA-STRIPE.md](PCI-BAA-STRIPE.md). Formal SAQ/ROC is for your org with your acquirer.

---

## P5-10 — SAST in CI

- **CI:** Semgrep `p/ci` in [.github/workflows/ci-collectrx.yml](../../.github/workflows/ci-collectrx.yml) (with Typecheck, Lint, Tests, build).
- **Ongoing:** [NPM-AUDIT.md](../NPM-AUDIT.md); optional CodeQL for deeper analysis.

---

## P5-11 — Annual pen test (PHI)

- **In repo:** [PEN-TEST-TRACKER.md](PEN-TEST-TRACKER.md) to record report date, scope, and “must fix” follow-ups.  
- **Not in repo:** the pen test report itself (keep confidential).

---

## P5-12 — CSRF policy (cookie session)

- **Session:** `httpOnly` cookie `crx_access`, `SameSite=Lax`, `Secure` in production ([authToken.ts](../../Collect-RX-main/src/server/authToken.ts)).
- **API:** JSON bodies + CORS `ALLOWED_ORIGINS`; not cookie-across-sites in typical deployment → **CSRF risk is reduced** for cross-site `POST` from a browser (third-party site cannot read the cookie; same-site navigations are where `Lax` sends the cookie on top-level GET, not on cross-site POST in most cases).
- **If** you add a form-based POST to the API from a different origin, add `SameSite=Strict` or a CSRF token. Full write-up: [CSRF-COOKIE-POLICY.md](CSRF-COOKIE-POLICY.md).
- **Tests:** not automated for CSRF in v1; policy + architecture above.

---

*Last update: Phase 5 documentation pass; link from OUTSTANDING Phase 5.*
