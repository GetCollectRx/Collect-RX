# CollectRx — Product name, target user, v1 (first release) & non-goals (P1-01)

**Product name (shipping):** **CollectRx** (as implemented in this repository, primarily the **Collect-RX-main** application).

**Engineering target:** A **first production-quality release**—**deployable** to staging and production, not a disposable proof-of-concept. “MVP / v1” here means the **smallest** feature set and integration depth that is still **safe to ship and operate**; detailed production hardening (DB migrations, CI, real payments, observability, compliance tasks) is tracked in [`OUTSTANDING-FIXES-PRODUCT-READY.md`](../../OUTSTANDING-FIXES-PRODUCT-READY.md) Phases 2+.

**One-line value:** Software that helps **dental practices** run **accounts receivable (A/R) workflows**—stages, reminders, and collection activity—on top of data that ultimately remains governed by the practice’s PMS (e.g. Dentrix) as system of record.

---

## Target user (v1 focus)

- **Primary:** Office manager, billing lead, or owner at a **single or small multi-location** dental practice who needs visibility into open balances, outreach, and basic analytics.
- **Secondary (later):** Platform operators supporting many practices (multi-tenant admin, reporting).

---

## Three must-have outcomes for v1 (first shippable release)

1. **See A/R in one place** — Dashboard and lists show open balances, aging, and stage so staff can act without only using the PMS.
2. **Run a rules-based workflow** — Balances move through defined stages; automated or semi-automated outreach is **trackable** (outbox, events, audit trail in app data).
3. **Collect with traceability** — Staff can drive **payment** flows and see **payment events** tied to balances (real processor integration is a follow-on; the app must support the *business* record of who paid what).

---

## Explicit non-goals for v1 (so v1 can still ship on time)

| Area | Non-goal (for this MVP scope) |
|------|------------------------------|
| **PMS** | Full two-way real-time **Dentrix (or other PMS) sync**; v1 may use import, export, or manual touchpoints as defined in engineering. |
| **Regulatory** | This document is **not** a compliance sign-off; HIPAA/PCI/PIPEDA work is tracked separately in the product backlog. |
| **Scale** | Multi-region, multi-tenant **at massive scale** (sharding, global load) is out of scope for MVP. |
| **Consumer app** | A **patient-native mobile app** is not required; patient touch may be **links, email, SMS** as product allows. |
| **Perfect analytics** | **Advanced BI**, custom report builder, and all charts backed by a warehouse are not required for MVP. |
| **Root prototype UI** | The **repository-root** `src/frontend` + in-memory `src/api` stack is **not** the named MVP deliverable; see [ADR 0001](../adr/0001-primary-application-stack.md). |

---

## How this ties to tickets

- **P1-01 (this doc)** — Product framing for roadmap and sales/engineering alignment.
- See also: [OUTSTANDING-FIXES-PRODUCT-READY.md](../../OUTSTANDING-FIXES-PRODUCT-READY.md) (full phased backlog).

*Last updated as part of Phase 1 (P1-01).*
