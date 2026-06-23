# CollectRx access control matrix

Authoritative RBAC for CollectRx personas. Enforcement lives in `src/server/accessControl/permissions.ts` and route middleware; the UI mirrors rules via `ProtectedRoute` and `App.tsx` nav.

## Roles

| Role | Login | Scope |
|------|--------|--------|
| `front_desk` | Practice email (`User` table) | Single practice |
| `practice_owner` | Practice email | Single practice |
| `billing_ops_manager` | Platform user (`PlatformUser`) | All practices (read/write claims; no practice config) |
| `platform_admin` | Platform user or platform-dev password | All practices; **claims only with owner grant** |
| `auditor` | Platform user | Granted practices only; reports read-only |

Technical **platform developer** login (`POST /api/auth/login/platform-dev`) maps to `platform_admin` in the UI but uses a PHI-free, redacted session — not the same as a granted `platform_admin` platform user.

## Resource matrix (summary)

| Action | front_desk | practice_owner | billing_ops | platform_admin | auditor |
|--------|:----------:|:--------------:|:-----------:|:--------------:|:-------:|
| Claims (read/write) | Own | Own | All | Grant | — |
| Escalations | Own | Own | All | Grant | — |
| Reports (aging, carriers) | — | Own | All | All | Granted |
| Queue stats | — | Own | All | All | Granted |
| Update practice | — | Own | — | All | — |
| build_queue / run_queue | — | — | — | Break-glass | — |

Legend: **Own** = session practice only · **All** = any practice (with `?practiceId=` for cross-practice sessions) · **Grant** = `platform_admin_practice_grants` row required · **Break-glass** = `POST /api/admin/queue/build|run` with reason → `break_glass_audit_logs`

## Data model

- `platform_admin_practice_grants` — owner-approved claim access for platform admins
- `auditor_grants` — practice scope for auditors (`practice_id` null = all practices)
- `break_glass_audit_logs` — queue override audit trail

## Middleware

| Middleware | Purpose |
|------------|---------|
| `requireClaimScope` | Blocks auditors from claim APIs; enforces platform-admin grants |
| `blockFrontDeskReports` | Blocks aging/carrier report routes for front desk |
| `blockAuditorWrites` | Blocks mutating routes for auditors |
| `requirePlatformAdmin` | Admin console + break-glass |
| `assertPhiRouteAllowed` | Blocks PHI routes for platform-dev sessions |

## Phase rollout

1. **Current:** `front_desk`, `practice_owner`, `auditor`; grants tables + break-glass logging in place.
2. **Expansion:** Activate billing ops and platform-admin grant flows across all practices.
3. **Compliance:** Write audit trails, residency tags, PIPEDA access workflow.

Full product spec: `docs/security/access-control-handoff.md`
