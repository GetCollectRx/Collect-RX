# Authorized Narrow RLS Iteration

**Status:** Living document (engineering standard)
**Last updated:** 2026-07-27
**Audience:** Engineers writing any endpoint or job that legitimately touches more than one practice
**Scope:** The standard pattern for crossing practice (tenant) boundaries safely under Postgres row-level security.

Related: [RLS context](../../src/server/db/rlsContext.ts) · [Group/DSO admin API](../../src/server/routes/groupAdminRoutes.ts)

---

## 1. The problem

Every tenant-scoped table (`insurance_claims`, `usage_periods`, `phi_access_events`, …) is protected by a Postgres RLS policy keyed on `app.practice_id`. A normal request sets that session variable once, via `runWithPracticeRls(practiceId, fn)` (`src/server/db/rlsContext.ts`), and every query inside `fn` is transparently scoped to that one practice. That's correct for 95% of the codebase: one request, one practice.

It breaks down for the DSO/multi-location surfaces — a `group_admin` dashboard, a consolidated billing view, or a batch import — where **one authorized caller legitimately needs to read or write across N practices in their organization**. Two wrong ways to solve that:

- **Reach for `runWithRlsBypass`.** This turns off tenant isolation entirely for the wrapped code. It exists for platform-internal jobs (the rules tick, the learning cycle) that never take caller input. Using it in a route reachable by an authenticated non-platform user means a bug in the *authorization* check silently becomes cross-tenant data exposure, with no RLS backstop.
- **Widen the RLS policy itself** (e.g. "allow any row where the caller has *some* org membership"). This couples the database policy to the org-membership model and makes every future access-control change a migration.

## 2. The pattern

Two steps, always in this order:

1. **Validate the caller's authorized practice set in application code, before touching any of them.** For a `group_admin`, that means: look up their `OrganizationMember` rows → the `organizationId`s they belong to → the `OrganizationPractice` rows for those orgs → the resulting `practiceId` set. Reject (403) if the request references any `practiceId` outside that set.
2. **Loop each practice through its own narrow RLS scope**, never a bypass:

```ts
const results = await Promise.all(
  authorizedPracticeIds.map((practiceId) =>
    runWithPracticeRls(practiceId, () => /* one practice's queries */),
  ),
);
```

Each iteration still goes through the real RLS policy — `app.practice_id` is set to exactly that one practice for the duration of the callback. If the application-level authorization check in step 1 has a bug, RLS is still the backstop: the query can only ever see the one practice it was explicitly scoped to, never an arbitrary one.

## 3. Canonical call sites

- `GET /api/group/practices-summary` (`src/server/routes/groupAdminRoutes.ts`) — per-practice claim counts for the group dashboard.
- `GET /api/group/billing` — pooled usage across an org's practices.
- `GET /api/group/compliance/export` — per-practice PHI-access/gate counts.
- `POST /api/group/pms-import` — batch PMS import; validates every requested `practiceId` against the caller's org membership up front, then imports each practice independently under its own `runWithPracticeRls` scope, with per-practice error isolation so one malformed CSV doesn't fail the batch.

All four follow the same shape: resolve `OrganizationMember` → `OrganizationPractice` → authorized `practiceId` set, then iterate with `runWithPracticeRls`.

## 4. Invariant

> Any code path reachable by an authenticated non-platform_dev actor that touches more than one practice's data **must** validate that actor's authorized practice set first, then scope each practice individually via `runWithPracticeRls`. `runWithRlsBypass` is reserved for platform-internal jobs that take no caller-supplied practice/org input.

When adding a new cross-practice endpoint, mirror one of the call sites in §3 rather than inventing a new authorization shape.
