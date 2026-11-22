# CollectRx (canonical app)

Web application and API for recovering insurance accounts receivable for Canadian dental practices. The v1 product is **Hold Sentinel with staff handoff**: a Vapi squad dials the carrier, navigates the IVR, waits on hold, and transfers the live rep to practice staff ([ADR 0003](../docs/adr/0003-v1-hold-sentinel-wedge.md)). Patient and client payment collection is out of scope ([CLAUDE.md](../CLAUDE.md)).

This directory is the canonical app. The repository-root `src/api` and `src/frontend` stack is a deprecated prototype ([ADR 0001](../docs/adr/0001-primary-application-stack.md), [DEPRECATION](../docs/DEPRECATION.md)).

## What runs today

| Area | Where it lives | Notes |
|---|---|---|
| API server | `src/server/index.ts` (`npm start` runs it with `tsx`) | Express, port 3000 |
| Frontend | `src/` (Vite and React) | Port 5173 in development |
| Database | `prisma/schema.prisma` | PostgreSQL 16 through Prisma. There is no SQLite. |
| Voice squad | `src/server/vapi/`, `src/webhooks/vapi.ts` | Five squad agents named in code: IVR_Navigator, Hold_Sentinel, Claims_Agent, Escalation_Closer, Resolution_Closer. Claims_Scribe logs outcomes in human-assisted mode. |
| Carrier rules | `src/services/eligibility/rules/carrier-configs.json` | Data, not code. Six carriers. |
| Practice intake | `src/server/pms/pmsImportPipeline.ts`, `src/server/pms/pmsRegistry.ts` | CSV import is the supported path. |
| AbelDent connector | `desktop/services/abeldent-sync.cjs` | Active only when `ABELDENT_SCHEMA_MAP` is set. Unverified against a real export (PRD v2 R-050). |
| Practice billing | `src/billing/`, Stripe (see below) | Practice subscription only |
| Background jobs | BullMQ worker, used when `REDIS_URL` is set | Without Redis, work runs in-process |

Hosting: `fly.toml` sets the Fly.io app `collect-rx` with `primary_region = 'yyz'`. That is the compute region. Backups and object storage may sit outside Canada. See `docs/compliance/Vendor_DPA_Review_Checklist.md`. Do not read the region as a data residency claim.

## Quick start

From the repository root:

```bash
npm ci                   # installs the locked workspace
npm run setup:collectrx  # .env, Postgres, migrations, seed, prints the login
npm run dev              # API and Vite
```

By hand, from this directory:

```bash
cp .env.example .env     # set DATABASE_URL, JWT_SECRET, SEED_PRACTICE_PASSWORD
npm run db:generate
npm run db:migrate:dev
npm run db:seed          # empty baseline practice; no default password
npm run dev
```

`npm run setup` is the same flow from this directory. `npm run demo:seed` creates a demo practice with claims across statuses. It requires `SEED_PRACTICE_PASSWORD` (at least 8 characters) and has no default.

- Frontend: http://localhost:5173
- API: http://localhost:3000

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | API, Vite, and the worker when `REDIS_URL` is set |
| `npm test` | Vitest suite |
| `npm run lint` and `npm run typecheck` | Lint and TypeScript checks |
| `npm run diagnose` | Subsystem report: typecheck, env, DB, tests |
| `npm run db:migrate:dev` | Development migrations. Production uses `migrate deploy`. |
| `npm run e2e` | Playwright, after `npm run build` and `npm start` |
| `npm run abeldent:discover` | AbelDent schema discovery (needs SQL Server access) |

The full CI sequence is in [docs/operations/CI-GATES.md](../docs/operations/CI-GATES.md).

## Safety rules that the code enforces or must enforce

- **PHI boundary.** Vapi `metadata` carries UUID tokens only. Identifiers needed for carrier lookup go in ephemeral call variables at dispatch. Detokenization happens server-side. See [PHI-VAPI-BOUNDARY](docs/compliance/PHI-VAPI-BOUNDARY.md).
- **CARRIER_BLOCK.** A carrier block suspends all calls to that carrier. Scheduling and webhook code must check it first.
- **Call window and limits.** The documented rules (CLAUDE.md) are: calls Monday to Friday, 8am to 5pm Eastern; up to three attempts per claim; claims over 90 days go to a human. The claim age floor the code enforces today is a flat 30 days (`validateDispatch` in `src/carriers/adapter.ts`), not the per carrier figures. `validateDispatch` enforces the Monday to Friday, 08:00 to 17:00 Eastern window as a hard rule. It does not check a holiday calendar, and a practice-set window does not change dispatch (PRD v2 R-018). Open decisions are in [DECISION-LOG](../docs/operations/DECISION-LOG.md) (D5, D6). R-010 (no dial without staff capacity) is waived under decision B.
- **CRTC disclosure.** Automated calls must disclose their nature within 10 seconds of a live rep answering. See [crtc-disclosure-decision](docs/compliance/crtc-disclosure-decision.md).

## Security controls

Which controls the running app loads is recorded in [docs/SECURITY-MITIGATIONS.md](docs/SECURITY-MITIGATIONS.md), with a reachability table. The check is a static import scan from `src/server/index.ts`. Immutable audit logging, the standalone PHI redactor, the Vapi security controls module and the centralized webhook validator are imported only by tests today. They are tracked under R-100 (wire or delete). Log redaction in use is `src/server/observability/logger.ts`.

## Billing (Stripe test mode)

Stripe Billing covers the practice subscription only.

1. Set `STRIPE_SECRET_KEY` (a `sk_test_` key) and `STRIPE_WEBHOOK_SECRET`.
2. Forward webhooks with `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
3. Open `/billing` and complete Checkout with a test card.
4. Replaying the same event must not change subscription state twice.

## Known gaps

- Production pool sizing (`connection_limit`, `pool_timeout`) is not set. The DSO load test in `tests/dsoHttpLoadCapacity.test.ts` fails with a 503 under concurrency. See [DECISION-LOG](../docs/operations/DECISION-LOG.md).
- Real carrier behaviour is unproven. Stage 1 is an offline simulation. See [docs/simulation](../docs/simulation).
- Launch readiness and open decisions: [docs/operations/PATH-TO-DELIVERY.md](../docs/operations/PATH-TO-DELIVERY.md). The PRD v2 document is not in this repository.

## Documentation

- [CLAUDE.md](CLAUDE.md) and the root [CLAUDE.md](../CLAUDE.md): standing rules and the order of authority
- [docs/operations/PATH-TO-DELIVERY.md](../docs/operations/PATH-TO-DELIVERY.md): launch tracker
- [docs/operations/CI-GATES.md](../docs/operations/CI-GATES.md): required checks
- [docs/DATABASE.md](../docs/DATABASE.md): Postgres and migrations
- [docs/operations/PHASE8-BACKGROUND.md](../docs/operations/PHASE8-BACKGROUND.md): worker and Redis
- [docs/architecture/call-to-resolution.md](docs/architecture/call-to-resolution.md): call flow
