# Screens → API → data map (P1-03)

**Canonical app:** `Collect-RX-main/` (see [ADR 0001](../adr/0001-primary-application-stack.md)).  
**Base URL (dev):** Vite proxy `/api` → backend (default port **3000** in `npm run dev:backend`).

Legend: **Prisma** = PostgreSQL/SQLite via Prisma. **N/A** = not implemented on this server. **Mock** = UI or comment indicates placeholder / fake slice.

---

## A. Collect-RX-main — main SPA (`src/App.tsx` routes)

| UI route | Screen | Primary API (authenticated unless noted) | Data store / notes |
|----------|--------|-----------------------------------------|--------------------|
| `/` | Dashboard | `GET /api/dashboard/stats` | Prisma `Balance`, states |
| `/balances` | Balances | `GET /api/balances?…` | Prisma |
| `/balances/:id` | Balance detail | `GET /api/balances/:id` | Prisma |
| `/patient-ar` | Patient AR | `GET /api/patients/balances?…` (and related) | **N/A / missing** on Prisma server — calls may 404 until implemented |
| `/estimate` | Pre-treatment estimate | `GET/POST /api/benefits/…` | **N/A** on same server — not wired to Prisma API in this repo |
| `/analytics` | Analytics | `GET /api/analytics/*` (5 endpoints) | Prisma; **mock** portions in UI (e.g. carrier block per code comments) |
| `/outbox` | Outbox | `GET /api/outreach`, `POST /api/outreach/:id/respond` | Prisma |
| `/admin` | Admin | `POST /api/admin/generate-balances` | Prisma (synthetic data) |
| `/pay/:balanceId` | Payment (test) | `GET /api/balances/:id`, `POST /api/pay/:id` | Prisma; **staff session** (not public pay-by-link) |

**Auth:** `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/logout` — **httpOnly cookie** (or Bearer). **Prisma `Practice.passwordHash`**.

**Eligibility:** `POST/GET /api/eligibility/…` — **Prisma** not used for all eligibility persistence; see TODOs in `src/routes/eligibility.ts` (DB wiring incomplete).

**Queue / carriers:** `GET/POST /api/queue/*` — Prisma `QueuePriority`, `CarrierOrder`.

---

## B. Repository root app (`src/frontend/` + `src/api/`)

| UI (single-page sections) | API prefix | Data |
|----------------------------|------------|------|
| Dashboard, Balances, Patient AR, Estimates, Analytics, Report, Admin | `GET/POST /api/practices/…`, `/api/patients/…`, `/api/auth/…` | **In-memory** `src/api/db.ts` — not the same DB as Prisma |

**Status:** Prototype; **not** the canonical product database. See ADR 0001.

---

## C. Collect-RX legacy Express API (`Collect-RX-main/src/index.js` + `routes.js`)

| Area | Notes |
|------|--------|
| Vapi webhooks, queue run, claims | Separate process from **Prisma** `src/server/index.ts` unless unified in deployment. |

Document **which process** is bound to which port in your runbook (e.g. 3000 Prisma app vs. legacy API).

---

## Summary

| Item | Count / note |
|------|----------------|
| Routes fully backed by **Collect-RX Prisma** server | Dashboard, balances, analytics (mostly), outbox, admin generate, pay (staff), auth, queue, rules (on server), eligibility **routes exist** (persistence TBD) |
| **Gaps** | `/api/benefits/*`, `/api/patients/balances/*` as used by SPA — **not** on Prisma index; must be added or UI gated |
| **Mock in UI** | Some dashboard/analytics slices |

*Use this table to drive Phase 3 tickets (wire or remove).*
