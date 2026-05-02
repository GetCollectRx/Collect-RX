---
type: moc
role: community-modules
---

# Map of content — `_COMMUNITY_*` modules

Use this note as a **thin hub**: navigate here, then follow **lateral** links inside each module (every `_COMMUNITY_* Module` has an `## Intentional links` section).

Product truth for the repo lives in `../OUTSTANDING-FIXES-PRODUCT-READY.md` and `../Collect-RX-main/`; this vault is **documentation + graph navigation**.

## Infra & backend services

- [[_COMMUNITY_Server Module]] — HTTP, jobs, auth middleware, patient/balance routes, desktop/electron touchpoints (largest cluster).
- [[_COMMUNITY_Schema Module]] — benefits `schema` / `calculator` domain.
- [[_COMMUNITY_Encryption Module]] — `encryption.ts` service.
- [[_COMMUNITY_Connect Module]] — Stripe Connect (`connect.ts`).
- [[_COMMUNITY_Seedcdtcodes Module]] — CDT seed job.
- [[_COMMUNITY_Preload Module]] — desktop `preload.js` / IPC surface.

## App pages (feature-level)

- [[_COMMUNITY_Login Module]]
- [[_COMMUNITY_Dashboard Module]]
- [[_COMMUNITY_Pretreatmentestimate Module]]
- [[_COMMUNITY_Users Module]] — Collect-RX `Dashboard.tsx` / `MetricCard` slice (distinct from Click `Dashboard`).

## UI primitives (design system)

- [[_COMMUNITY_Modal Module]] · [[_COMMUNITY_Bottomsheet Module]] · [[_COMMUNITY_Confirmmodal Module]]
- [[_COMMUNITY_Table Module]] · [[_COMMUNITY_Card Module]]
- [[_COMMUNITY_Badge Module]] · [[_COMMUNITY_Label Module]] · [[_COMMUNITY_Skeletonloader Module]]
- [[_COMMUNITY_Coveragebreakdown Module]]

## Cross-cutting triangles (high value in graph)

| Area | Link habit |
|------|------------|
| Estimates UI | [[_COMMUNITY_Pretreatmentestimate Module]] ↔ [[_COMMUNITY_Schema Module]] ↔ [[_COMMUNITY_Coveragebreakdown Module]] |
| Payments | [[_COMMUNITY_Server Module]] ↔ [[_COMMUNITY_Connect Module]] ↔ [[_COMMUNITY_Encryption Module]] |
| Shell | [[_COMMUNITY_Preload Module]] ↔ [[_COMMUNITY_Server Module]] (IPC → API) |
| Lists | [[_COMMUNITY_Table Module]] ↔ [[_COMMUNITY_Badge Module]] ↔ [[_COMMUNITY_Skeletonloader Module]] |

## Reports & handoff

- [[GRAPH_REPORT|Graph report (snapshot)]]
- [[CLAUDE|Vault / agent handoff]]
