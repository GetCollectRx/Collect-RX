# CollectRx — Product name, target user, v1 (first release) & non-goals (P1-01)

**Product name (shipping):** **CollectRx** (as implemented in this repository, primarily the **Collect-RX-main** application).

**Engineering target:** A **first production-quality release**—**deployable** to staging and production, not a disposable proof-of-concept. “MVP / v1” here means the **smallest** feature set and integration depth that is still **safe to ship and operate**; detailed production hardening (DB migrations, CI, real payments, observability, compliance tasks) is tracked in [`OUTSTANDING-FIXES-PRODUCT-READY.md`](../../OUTSTANDING-FIXES-PRODUCT-READY.md) Phases 2+.

**One-line value:** Software that helps **Canadian dental practices** recover **insurance accounts receivable**—AI voice agents follow up with carriers on outstanding claims for work patients had done—so staff spend less time on hold and more claims get paid.

**Product boundary:** CollectRx is **Practice → Insurance**. Patients are the **subjects of claims** (identity required for carrier calls via tokenized PHI). CollectRx does **not** collect money from patients (no patient pay links, Stripe Connect, or patient-balance outreach).

---

## Target user (v1 focus)

- **Primary:** Office manager, billing lead, or owner at a **single or small multi-location** dental practice who needs visibility into open **insurance** claims, carrier follow-up, and recovery outcomes.
- **Secondary (later):** Platform operators supporting many practices (multi-tenant admin, reporting).

---

## Three must-have outcomes for v1 (first shippable release)

1. **See insurance A/R in one place** — Dashboard and Claims show open carrier balances, aging, and status so staff can act without living in the PMS phone queue.
2. **Run a rules-based carrier workflow** — Claims enter a call queue with aging/priority rules; AI or staff follow-up is **trackable** (call attempts, outcomes, gates, audit trail).
3. **Recover with traceability** — Practices can see resolution outcomes, dollars recovered (or still at risk), and an audit trail tied to claims—not patient self-pay events.

---

## Explicit non-goals for v1 (so v1 can still ship on time)

| Area | Non-goal (for this MVP scope) |
|------|------------------------------|
| **Patient billing** | Collecting balances **from patients** (pay links, Stripe Connect, patient reminder outbox). Permanently out of product scope. |
| **PMS** | Full two-way real-time **Dentrix (or other PMS) sync**; v1 may use CSV import, export, or optional AbelDent desktop connector. |
| **Regulatory** | This document is **not** a compliance sign-off; HIPAA/PCI/PIPEDA work is tracked separately in the product backlog. |
| **Scale** | Multi-region, multi-tenant **at massive scale** (sharding, global load) is out of scope for MVP. |
| **Consumer app** | A **patient-native mobile app** is not required. |
| **Perfect analytics** | **Advanced BI**, custom report builder, and all charts backed by a warehouse are not required for MVP. |
| **Root prototype UI** | The **repository-root** `src/frontend` + in-memory `src/api` stack is **not** the named MVP deliverable; see [ADR 0001](../adr/0001-primary-application-stack.md). |

---

## How this ties to tickets

- **P1-01 (this doc)** — Product framing for roadmap and sales/engineering alignment.
- See also: [OUTSTANDING-FIXES-PRODUCT-READY.md](../../OUTSTANDING-FIXES-PRODUCT-READY.md) (full phased backlog).

*Last updated: 2026-07-14 — insurance AR only; patient billing retired.*
