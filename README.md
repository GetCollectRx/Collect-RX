# CollectRx platform

Monorepo-style workspace for **CollectRx** — dental practice accounts receivable (A/R) workflows, messaging, and payment-related flows.

**Goal:** A **deployment-ready** product (staging + production), not a throwaway demo. The phased engineering backlog is [OUTSTANDING-FIXES-PRODUCT-READY.md](OUTSTANDING-FIXES-PRODUCT-READY.md).

## Monorepo commands (canonical app)

From the **repository root** (after `npm install` at the root — **do not** run `npm ci` inside `Collect-RX-main/`; the workspace uses the root `package-lock.json`):

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
npm install                       # at repo root — links the Collect-RX-main workspace
cp Collect-RX-main/.env.example Collect-RX-main/.env
# Set DATABASE_URL to your existing PostgreSQL (e.g. postgresql://user:pass@localhost:5432/collectrx)
# and JWT_SECRET. Only use `docker compose up -d` at repo root if you want Docker Postgres instead.
npm run db:generate:collectrx
npm run db:migrate:dev:collectrx  # apply prisma/migrations to your database
npm run db:seed:collectrx
npm run dev
```

- **Frontend:** http://localhost:5173 (log in at `/login` with `SEED_USER_EMAIL` + `SEED_PRACTICE_PASSWORD` — see [Collect-RX-main/README](Collect-RX-main/README.md))
- **API:** http://localhost:3000

Database and migrations: [docs/DATABASE.md](docs/DATABASE.md). Details: [Collect-RX-main/README.md](Collect-RX-main/README.md).

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
