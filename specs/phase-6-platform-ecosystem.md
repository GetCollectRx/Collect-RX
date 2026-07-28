# PRD: Phase 6 — Platform & Ecosystem
**Status**: Draft
**Author**: Alex (Product)
**Last Updated**: 2026-07-27
**Version**: 0.1
**Stakeholders**: Eng Lead, Backend/Platform, Design (API docs/portal), Support/CS, Sales (DSO segment)

---

## 1. Problem Statement

Phases 1–5 built CollectRx as a single-practice-first product that now also supports multi-location DSOs (Organization / OrganizationPractice / OrganizationMember, org-level Stripe billing, pooled COGS, self-serve org creation, self-serve invites, batch PMS import). Every one of those capabilities assumes a DSO is interacting with CollectRx through our own web dashboard and our own onboarding flow, and that a DSO's footprint only grows by *creating new practices inside CollectRx*.

Neither assumption holds once we have real platform-scale traction across many DSO customers rather than one pilot:

- **DSOs run their own back-office/accounting stack** (revenue cycle, GL, BI). Today the only way to get claim/AR/billing data out of CollectRx is a human clicking around `group_admin` dashboard screens. A DSO controller reconciling org-level AR against CollectRx's recovered-dollar figures today does it by hand or not at all.
- **DSOs grow by acquisition, not just by opening new chairs.** A DSO that already has 3 independent CollectRx practices (each self-serve-onboarded, each with its own claim history, users, and PMS import runs) has no path to fold those into an Organization once they're acquired or consolidated under one ownership group. `POST /api/admin/organizations` (grep confirms this is admin-assisted org *creation* only) creates a **new** org with **new** practices — there is no "attach existing practice X to org Y" flow.
- **PMS connector coverage is a fixed, code-owned list.** `pmsRegistry.ts` hardcodes six named vendors plus `other`. Every real vendor except AbelDent already collapses to the `generic` import family (CSV), meaning most of what actually differs between "Dentrix support" and "Eaglesoft support" today is *column mapping*, not import logic — yet adding a named vendor still means a PR, a code review, and a deploy. At scale this becomes an engineering bottleneck on sales cycles.

**Evidence**: This phase is written ahead of demand signal — see Section 5, Confidence & Validation Needed. The problem statement above is inferred from the shape of the existing schema/pipeline (Organization model already exists; PMS import is already vendor-abstracted at the data layer) plus standard DSO-market behavior (accounting integrations, roll-up acquisitions, PMS diversity), not from CollectRx customer interviews, because CollectRx currently has zero active practices (see pilot status).

---

## 2. Goals & Success Metrics

| Goal | Metric | Baseline | Target | Measurement Window |
|------|--------|----------|--------|---------------------|
| DSOs can integrate CollectRx data into their own systems | # orgs with an active API key making ≥1 call/week | 0 | 5 orgs | 90 days post-launch |
| Reduce manual dashboard pulls for AR reconciliation | Support tickets requesting data export | n/a (untracked) | Establish baseline, then −50% | 2 quarters after baseline |
| DSOs can grow by acquisition without re-onboarding | Time to attach an acquired practice to an org | N/A (no path exists) | < 1 business day, self-serve or admin-assisted | 60 days post-launch |
| Reduce engineering cost per new PMS vendor | Eng-days to add a CSV-based vendor | ~2–5 days (code + PR + deploy) | < 1 day, no code deploy for CSV-family vendors | 90 days post-launch |

---

## 3. Non-Goals

- **Write access via the public API in v1.** Read-only only. Carriers, call scheduling, and CARRIER_BLOCK state are too safety-critical to expose to third-party write access before we have audit tooling and a partner support process in place.
- **A true self-serve third-party developer marketplace with listing/review/revenue-share.** This phase builds the *framework* (config-driven connector definitions) that would make a marketplace possible later — it does not build a public submission portal, vendor certification program, or revenue share.
- **Live desktop-connector-class integrations (real-time DB sync, à la AbelDent) as a "marketplace."** Those require an on-prem agent, schema discovery, and a signed Windows build per vendor — this is inherently an engineering-led integration, not a config the vendor community can self-serve. Section 6.3 scopes the marketplace framing to CSV/export-based connectors only.
- **Automated/self-serve org merge with zero human review.** Merging an existing practice's history, users, and billing into an org touches Stripe subscriptions and audit continuity — v1 requires an admin (CollectRx ops) to execute the merge, with the existing practice owner's explicit consent captured first. Full self-serve merge is a later iteration once the guardrails are proven.
- **OAuth2 authorization-code / third-party app installs in v1.** API key auth only for v1 (see 6.1); OAuth is flagged as a v2 option once we have external developers building against us, not before.

---

## 4. Target User

- **Primary**: DSO controller / RCM (revenue cycle management) analyst at a 10–50+ practice DSO who needs claim/AR/billing data inside their own BI or accounting tool, and doesn't want to log into a third-party dashboard to get it.
- **Secondary**: DSO operations lead executing an acquisition, who needs newly acquired practices' AR automation live under the parent org's billing and reporting within days, not weeks.
- **Secondary**: CollectRx implementation/sales engineering, who currently owns the cost of every new PMS vendor and wants that cost to approach zero for CSV-based vendors.

---

## 5. Confidence & Validation Needed

This PRD is written against an assumption of **platform-scale success — many DSO customers, not one** — which is not yet true (zero active practices as of this writing; the org/multi-location model shipped ahead of a signed DSO customer). Before committing engineering time beyond a spike:

- Validate the API integration need with at least 2–3 prospective or actual DSO customers — does their back office actually want a pull API, or is a scheduled CSV/webhook export sufficient for v1?
- Validate that acquisition-driven growth (vs. organic new-practice growth) is a real pattern in our pipeline before building merge tooling — if our first 10 DSO customers all grow by opening new locations, Section 6.2 should be deferred.
- Validate PMS vendor demand by named vendor (which vendors are actually blocking deals) before investing in the generalized connector-config framework — if 90% of the pipeline is AbelDent or generic CSV, the marketplace framework has low near-term payoff.

None of this blocks writing the requirements below — it blocks scheduling more than a design spike. Confidence on "this phase matters" is currently **medium-low**; confidence on "the shape of the solution is right, if it's needed" is **medium-high**, because it follows the schema's own abstractions (Organization already exists; PMS import is already family-abstracted).

---

## 6. Functional Requirements

### 6.1 Partner/Public API (read-only)

**FR-1.1** Provide a versioned REST API (`/api/v1/partner/...`) exposing read-only endpoints for: claims list/detail, AR aging summary, call outcome history, org-level billing/invoice summary, and PMS import run history — mirroring the data already surfaced in the `group_admin` dashboard, not new data.

**FR-1.2** Auth is by API key, not session cookie. Keys are minted per-Organization (not per-practice) by an `org_admin` from the dashboard, following the existing `mintConnectorAgent`/`revokeConnectorAgent` pattern in `connectorAdminRoutes.ts` (secret shown once at creation, hashed at rest, revocable, audit-logged via `appendAuditLog`).

**FR-1.3** A key's authorization boundary is the org's practice set as of request time — i.e., the same practices an `org_admin` can see in the dashboard, no more. This requires resolving how RLS enforces multi-practice scope: `rlsContext.ts` today only supports a single `practiceId` or a full cross-tenant `bypass`, with no "this session may read practices [A, B, C]" mode. That gap must be closed (new org-scoped RLS mode, or an application-layer `practiceId IN (...)` filter reviewed with the same rigor as RLS) before this ships — see Dependencies.

**FR-1.4** Rate limits are enforced per key: a documented default (e.g., 60 req/min, 5,000 req/day) with 429 responses and `Retry-After` headers. Limits are configurable per key for enterprise cases without a code change.

**FR-1.5** All partner API requests are audit-logged (key id, org id, endpoint, timestamp, result) using the existing `appendAuditLog` mechanism — a partner API is a new PHI-adjacent surface and gets the same audit posture as admin actions.

**FR-1.6** No PHI (patient name, DOB, health card number) is ever returned by the partner API — same UUID-token boundary as Vapi metadata. Only claim/financial fields already exposed to `group_admin` today are eligible.

**FR-1.7** OpenAPI spec published and versioned; breaking changes require a new version path, not an in-place change to `v1`.

### 6.2 Bulk-Onboarding / Org-Merge Tooling

**FR-2.1** New admin-only endpoint (e.g., `POST /api/admin/organizations/:orgId/practices/attach`) that reassigns one or more existing, already-onboarded practices to an Organization — distinct from the existing `POST /api/admin/organizations`, which only creates new orgs with new practices.

**FR-2.2** Attaching a practice preserves all existing history: claims, call attempts, PMS import runs, audit logs, and existing practice-level users remain intact and queryable exactly as before — only `practiceId → organizationId` (and downstream org-level billing/reporting rollups) changes.

**FR-2.3** Before attach, require explicit consent from the target practice's current owner/admin (in-app confirmation or signed invite-style token), not just action by a CollectRx admin or the acquiring DSO's admin — the practice is giving up billing independence and gaining a new org-level admin with visibility into its data.

**FR-2.4** Attach flow surfaces and requires resolution of collisions before committing: duplicate practice display names within the org, conflicting PMS vendor/schema-map assignments, and any active `CarrierBlockEvent` state (block status must remain scoped to the practice, not silently merged/cleared).

**FR-2.5** Billing reconciliation: the practice's existing standalone Stripe subscription is prorated/cancelled and the practice is folded into the org's pooled COGS billing as of the attach date, with the transition summarized to both the org admin and the (former) standalone practice admin before it's final — no silent billing changes.

**FR-2.6** Attach is reversible within a defined window (e.g., 30 days) via a `detach` operation that restores standalone billing and does not delete any historical data, in case of an acquisition falling through or admin error.

**FR-2.7** Every attach/detach is written to the audit log with before/after org membership state, initiating admin, and consent record reference.

### 6.3 PMS Connector Framework (CSV/export-based connectors only)

**FR-3.1** Replace the hardcoded `PMS_VENDOR_PROFILES` record in `pmsRegistry.ts` with a database-backed connector definition (vendor id, display name, import family, column-alias map, date format, status-code mapping) — following the same "rules are data, not code" pattern already used for `carrier-configs.json` in the eligibility engine.

**FR-3.2** A connector definition for any vendor whose export reduces to the existing `generic` import family can be created and edited via an internal (initially CollectRx-ops-only, not public) admin UI — no PR, code review, or deploy required to add a new named CSV vendor or fix a column mapping.

**FR-3.3** New connector definitions are validated against a fixed schema (required fields, allowed status values, date format enum) before activation, with a dry-run mode: upload a sample export and preview mapped output before saving the definition as usable.

**FR-3.4** `runPmsImportPipeline` continues to resolve vendor → import family exactly as today (`resolvePmsImport`, `PMS_VENDOR_PROFILES`) — this phase changes where the profile data lives, not the import pipeline's behavior or its validation/reconciliation logic (`validateImportTotals`, `syncWorkItemsForPractice`).

**FR-3.5** Explicitly out of scope for this config-driven framework: AbelDent and any future live desktop-sync connector. Those keep their own EDI-guard/schema-discovery code path (`abeldentEdiVersionGuard.ts`, `schema-map.json`) because they require an on-prem agent and a signed Windows build, not just a column map.

**FR-3.6** A public-facing "connector request" form (no code access) lets a DSO or PMS vendor request/submit an export sample; internal team turns that into a connector definition via 6.3's admin UI. This is the only "third-party" surface in v1 — a true self-serve submission portal is explicitly out of scope (Section 3).

---

## 7. Dependencies on Existing Schema/Pipeline

- **RLS multi-practice scope gap (blocking FR-1.3)**: `src/server/db/rlsContext.ts` currently supports only a single `practiceId` or a cross-tenant `bypass` — there is no first-class "N practices for this org" context. This must be designed and reviewed with the same care as the original RLS work before the partner API ships, or every API request risks either over-scoping (bypass) or N+1 per-practice context switching.
- **`Organization` / `OrganizationPractice` / `OrganizationMember` models** (from the completed multi-location work) are the foundation for both 6.1 (auth scope) and 6.2 (attach target). No new top-level entities are proposed; FR-2.1 is additive to the existing org model.
- **`pmsImportPipeline.ts` / `pmsRegistry.ts` / `practicePmsContext.ts`**: FR-3.1–3.4 change the *source* of `PMS_VENDOR_PROFILES` from a code constant to a DB table; every call site (`resolvePmsImport`, `ensurePracticePmsVendor`, `getPmsImportFamily`) needs to tolerate a dynamic vendor list instead of the current fixed enum-like `PmsVendorId` type — this is a real typing change (`PmsVendorId` is currently a closed union), not just a data migration.
- **`groupPmsImportBodySchema` / batch import**: 6.2's attach flow should reuse the existing batch-import validation path rather than inventing a second one, since an attached practice's historical import runs must remain valid against whatever schema batch import already enforces.
- **`connectorAdminRoutes.ts` mint/revoke token pattern**: reused directly as the implementation precedent for API key issuance in 6.1 — same hashed-at-rest, shown-once, revocable, audit-logged shape, scoped to org instead of practice.

---

## 8. Open Questions

- [ ] Does the partner API need webhooks (push) in addition to pull, given DSO back-office systems often prefer event-driven sync? — Owner: Eng Lead — Deadline: before FR-1 design freeze.
- [ ] Who approves an org-merge consent request when the practice being acquired is itself unresponsive (dormant account, acquired practice's admin has left)? — Owner: Support/CS — Deadline: before FR-2.3 build.
- [ ] Should PMS connector definitions be practice-visible/editable by an `org_admin` for their own DSO's less-common export format, or CollectRx-ops-only in v1? — Owner: Product — Deadline: before FR-3.2 build.
- [ ] What's the pricing/packaging for API access — included in all org plans, or a paid add-on tier? — Owner: Product + Finance — Deadline: before GTM.

---

## 9. Rough Sequencing

1. **Spike (1–2 weeks)**: RLS multi-practice scope design (blocks all of 6.1) + validate DSO API demand per Section 5.
2. **6.2 Org-merge tooling first** if acquisition-driven growth is validated — smallest schema surface, highest immediate DSO-sales unblock, no new external-facing auth model required.
3. **6.1 Partner API second** — depends on the RLS spike resolving cleanly; ship read-only claims + AR aging first, billing/PMS-run endpoints in a fast-follow.
4. **6.3 PMS connector framework last** — lowest urgency unless a specific named-vendor deal is blocked; the `PmsVendorId` type change is the highest-risk piece of this whole phase and deserves its own design review before touching `pmsImportPipeline.ts`.
