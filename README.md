# CollectRx platform

Monorepo-style workspace for **CollectRx** — dental **insurance** accounts receivable (A/R) recovery (Practice → Insurance). Practice SaaS Billing is supported; patient/client payment collection is out of scope.

**Goal:** A **deployment-ready** product (staging + production), not a throwaway demo. Launch path: [docs/operations/PATH-TO-DELIVERY.md](docs/operations/PATH-TO-DELIVERY.md). Phased backlog: [OUTSTANDING-FIXES-PRODUCT-READY.md](OUTSTANDING-FIXES-PRODUCT-READY.md).

## Monorepo commands (canonical app)

From the **repository root** (after `npm install` — installs the **Collect-RX-main** workspace):

| Command | What it does |
|--------|----------------|
| `npm run dev` | API + Vite (+ worker + Redis when `REDIS_URL` is in `.env`) |
| `npm run ci:collectrx` | Typecheck, lint, test, production build (run before PRs) |
| `npm run diagnose -w dental-ar-system` | **What broke?** — one report: typecheck, env, DB, tests, optional live smoke |
| `npm run db:migrate:collectrx` | `prisma migrate deploy` in Collect-RX-main (needs `DATABASE_URL`) |
| `docker compose up -d` | **Optional** — local Postgres 16 in Docker ([docs/DATABASE.md](docs/DATABASE.md)); skip if you already have Postgres |
| `npm run dev:prototype` | Legacy: root `server.js` |
| `npm run dev:all` | Prototype: root in-memory `src/api` + `src/frontend` |

## Which app is “the product”?

**Canonical application:** **`Collect-RX-main/`** (Vite + React, Express + Prisma, **PostgreSQL** via `DATABASE_URL` locally and in production).

The **repository root** `src/api` + `src/frontend` stack is a **prototype** with an **in-memory** API database. Do not assume it is what ships. See:

- [ADR 0001 — Primary application stack](docs/adr/0001-primary-application-stack.md)
- [Non-canonical code policy](docs/DEPRECATION.md)

## Quick start (canonical: Collect-RX-main)

```bash
npm install              # at repo root — links the Collect-RX-main workspace
npm run setup:collectrx  # .env, Postgres (Docker if available, else native), migrate, seed, prints login
npm run dev
```

`npm run setup:collectrx` is one command end to end: creates `.env` from the example if missing,
brings up Postgres (and Redis if available) without you picking a port by hand, generates
`JWT_SECRET`/`PHI_ENCRYPTION_KEY`/a seed password if they're not already set, runs migrations, seeds
the demo practice, and prints the login it just created. Safe to re-run after a `git pull` — it never
overwrites a value already in `.env`. Flags: `-- --minimal` for an empty baseline practice instead of
the rich demo data, `-- --reset` to wipe and reseed the demo practice.

- **Frontend:** http://localhost:5173 (login printed by `npm run setup:collectrx`, or see `SEED_PRACTICE_PASSWORD` in `Collect-RX-main/.env`)
- **API:** http://localhost:3000

Prefer to do it by hand, or need details on what the script automates? [Collect-RX-main/README.md](Collect-RX-main/README.md) has the manual steps. Database and migrations: [docs/DATABASE.md](docs/DATABASE.md).

## Quick start (root prototype — not canonical)

For experiments only:

```bash
npm install
cp .env.example .env   # if present; set secrets for your machine
npm run dev:all        # API + Vite (see package.json)
```

## Documentation index

| Doc | Purpose |
|-----|---------|
| [MVP scope & non-goals](docs/product/MVP-SCOPE.md) | Product name, user, v1 in/out of scope (P1-01) |
| [Screens → API → data](docs/product/SCREENS-API-DATA-MAP.md) | Route and integration map (P1-03) |
| [Environment matrix](docs/ENVIRONMENT-MATRIX.md) | local / staging / prod (P1-04) |
| [ADR 0001](docs/adr/0001-primary-application-stack.md) | Stack decision (P1-02) |
| [Deprecation / non-canonical](docs/DEPRECATION.md) | Root `src` policy (P1-07) |
| [Database & migrations](docs/DATABASE.md) | PostgreSQL, Prisma, Docker (Phase 2) |
| [Releasing & CHANGELOG](docs/RELEASING.md) | Tags and [CHANGELOG.md](CHANGELOG.md) |
| [npm audit triage](docs/NPM-AUDIT.md) | Dependency CVE notes (Phase 2) |
| [Outstanding product-ready backlog](OUTSTANDING-FIXES-PRODUCT-READY.md) | Phased P1–P9 tickets |
| [docs/README.md](docs/README.md) | Credential rotation, pilot scope, etc. |

## License

Per-package licenses apply (e.g. Collect-RX-main may differ); see subfolder `LICENSE` or `package.json` where present.
