# CollectRx access control matrix

## Roles

| Role | JWT `role` | `phiAccess` | Scope |
|------|------------|-------------|--------|
| Practice staff / owner | `practice` | `true` | Single practice (`practiceId` in JWT) |
| Platform developer | `platform_dev` | `false` (fixed) | All practices; **no PHI** |

## Platform developer (implemented)

**Login:** `POST /api/auth/login/platform-dev` with `{ "password": "…" }`  
**Env:** `PLATFORM_DEV_PASSWORD` or `PLATFORM_DEV_PASSWORD_HASH` (bcrypt)

**Allowed**

- Dashboard (aggregates; recent payments show redacted labels)
- Insurance AR (claim numbers masked, `patientToken` omitted)
- Work queue (titles/notes redacted)
- Analytics — insurance section only
- Admin (settings, integrations, audit) with `?practiceId=` context
- PMS sync, carriers, queue priority, calls metadata

**Blocked (403)**

- `/api/patients/*`, `/api/balances*`, `/api/benefits/*`, `/api/eligibility/*`
- `/api/cdcp/*`, `/api/canadian/*`
- Analytics except `/api/analytics/insurance`
- Admin demo patient generation and patient CSV import

**UI**

- Sidebar shows **Dev** badge and practice selector
- Routes `/patient-ar`, `/balances`, `/outbox`, `/estimate`, `/cdcp` redirect to dashboard

## Practice context for platform_dev

Every scoped API call must include practice context:

- Query: `?practiceId=<uuid>`
- Header: `X-Practice-Id: <uuid>`
- Body: `{ "practiceId": "…" }` on POST/PATCH

The browser client adds these automatically via `practiceScopedApi.ts` when a practice is selected.

## Future roles (not implemented)

See product personas: Front Desk, Practice Owner, Billing Ops, Auditor — `platform_dev` covers technical stewardship only.
