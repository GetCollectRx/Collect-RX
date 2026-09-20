# AGENTS.md

## Cursor Cloud specific instructions

These notes cover non-obvious setup/run caveats for this repo in the Cursor Cloud VM.
Standard commands live in the root `README.md`, `Collect-RX-main/README.md`, `CLAUDE.md`,
and the `scripts` blocks of `package.json` / `Collect-RX-main/package.json` — prefer those.

### Which app is "the product"
- Canonical app: `Collect-RX-main/` (npm workspace `dental-ar-system`) — Vite + React SPA,
  Express + Prisma backend, PostgreSQL. This is what you run/test.
- The repo-root `src/` (`collectrx-platform`) is a deprecated in-memory **prototype** — ignore it
  unless explicitly asked. It is also the npm-workspaces root that links `Collect-RX-main`.

### Required service: PostgreSQL (not auto-started)
- Installed natively (apt `postgresql-16`). It does **not** start automatically on a fresh VM boot.
  Start it before running the app/tests/migrations:
  `sudo pg_ctlcluster 16 main start`
- Local dev DB created during setup: database `collectrx`, role `collectrx`,
  password `collectrx_local_dev_only`, on port **5432** (native default — note `.env.example`
  and `docker-compose.yml` reference 5433 for the Docker option, which we do not use here).
- `Collect-RX-main/.env` is gitignored and already created (persists in the VM snapshot) with
  `DATABASE_URL`, `JWT_SECRET`, and `SEED_PRACTICE_PASSWORD`. If it is ever missing, recreate it
  from `Collect-RX-main/.env.example` and point `DATABASE_URL` at the local DB above.

### Migrations / seed (run from `Collect-RX-main/`)
- Use `npx prisma migrate deploy` (non-interactive). Do **not** use `prisma migrate dev`
  (`npm run db:migrate:dev`) in this headless VM — it can hang waiting on an interactive
  prompt and hold a Postgres advisory lock.
- `npm run db:seed` writes the baseline practice (needs `SEED_PRACTICE_PASSWORD`).
- `npm run demo:seed` writes rich demo data and prints a login: email defaults to
  `demo@collectrx-test.local` (override with `SEED_PRACTICE_EMAIL`), password is whatever
  `SEED_PRACTICE_PASSWORD` was set to — there is no default password, the script requires one.

### Running (from `Collect-RX-main/`, or `npm run dev` at repo root)
- `npm run dev` starts API on **:3000** and Vite on **:5173** in one process (no Redis needed —
  background jobs run in-process). Vite binds to `localhost`; use `http://localhost:5173`
  (curling `127.0.0.1:5173` may fail).
- Redis is optional. Only set `REDIS_URL` + run `npm run worker` if testing distributed jobs.

### UI permissions gotcha (affects manual testing of write actions)
- The seeded demo user has role `practice_owner`, which the UI treats as **read-only** (see
  `src/lib/useRoleAccess.ts`) — write buttons (e.g. "Mark complete, ready to re-call" to clear a
  gate) are hidden. To exercise write actions, give the user a write role, e.g.
  `UPDATE "User" SET role='office_manager' WHERE email='demo@collectrx-test.local';`
  (or your `SEED_PRACTICE_EMAIL` override) then log out and log back in so the new role is in
  the session.

### Lint / test status on `main`
- `npm run lint` and `npm test` toolchains work, but `main` has pre-existing failures unrelated to
  environment setup: ~6 ESLint errors and 3 failing Vitest cases. Don't treat these as setup breakage.
