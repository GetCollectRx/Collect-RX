# ADR 0001: Primary application stack and disposition of the root prototype

**Status:** Accepted  
**Date:** 2026-04-22  
**Context:** P1-02

## Context

The `collectrx-platform` repository contains **two** full-stack code paths:

| Path | Stack | Data |
|------|--------|------|
| **`Collect-RX-main/`** | Vite + React, Express + **Prisma**, SQLite in dev; eligibility engine, rules engine, Electron entry | **Durable** (Prisma schema, migrations path to Postgres) |
| **Repository root** `src/api` + `src/frontend` | Vite + React, Express + **in-memory** maps (`src/api/db.ts`) | **Non-durable** (resets on restart unless extended) |

Both implement “CollectRx”-shaped ideas (practices, patients, auth patterns). Maintaining two divergent apps increases cost, confuses operators, and splits security reviews.

## Decision

1. **Primary shipping application:** **`Collect-RX-main/`**  
   - This is the **canonical** app for new features, production hardening, and customer-facing work unless explicitly superseded by a future ADR.

2. **Secondary / prototype stack:** **Root `src/api` and `src/frontend`**  
   - Treated as a **prototype** (experiments, alternate UI, early API shapes). **No new product features** should be added here without an ADR that either merges the feature into `Collect-RX-main/` or redefines the primary app.

3. **Legacy Node API in `Collect-RX-main/src/index.js` (Vapi, queue, claims):**  
   - Remains **in use** for voice/queue/claims flows where mounted separately from the Prisma server. Long-term, consolidate behind one gateway or document deployment as its own “worker/API” service (future ADR).

4. **Other folders** (e.g. `Click-main/` if present, `graphify` outputs):  
   - **Out of scope** for this ADR; document per-folder as needed.

## Consequences

- **Engineering:** Default PRs and CI focus on `Collect-RX-main/`.  
- **Product:** Demos and pilots should use **Collect-RX-main** builds.  
- **Root prototype:** See [../DEPRECATION.md](../DEPRECATION.md) and [../../src/README.md](../../src/README.md) for maintainer policy (P1-07).  
- **Reversal:** A future ADR may promote the root stack or a new monorepo if product strategy changes.

## Links

- [MVP-SCOPE.md](../product/MVP-SCOPE.md)  
- [OUTSTANDING-FIXES-PRODUCT-READY.md](../../OUTSTANDING-FIXES-PRODUCT-READY.md)
