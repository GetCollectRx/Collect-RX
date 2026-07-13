# Database: PostgreSQL & Prisma

The canonical app **Collect-RX-main** uses **PostgreSQL** in **staging and production** via Prisma. **SQLite is no longer the production target.**

## Local development

**You only need a running PostgreSQL instance** (local install, Homebrew, Postgres.app, a cloud free tier, etc.). **Docker is optional**—it is one way to get Postgres without installing the server yourself; you do *not* need Docker if you already use Postgres.

1. **Point Prisma at your database** in `Collect-RX-main/.env` (see `.env.example`):

   ```env
   DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE_NAME
   ```

   Create an empty database (e.g. `createdb collectrx` or via `psql` / your GUI) if needed, or use an existing one.

2. Apply migrations and seed:

   ```bash
   npm run db:generate:collectrx
   npm run db:migrate:dev:collectrx
   npm run db:seed:collectrx
   ```

   For a non-interactive CI-like apply (no new migrations), use `db:migrate:collectrx` (`prisma migrate deploy`).

**Do not** use `prisma db push` in production deploy pipelines; use `prisma migrate deploy` after `DATABASE_URL` is set.

### Optional: Postgres via Docker (no local install)

If you **prefer** a container and have [Docker Desktop](https://www.docker.com/products/docker-desktop/) running, from the **repository root** (`collectrx-platform/`):

```bash
docker compose up -d
```

Then set `DATABASE_URL` to the compose defaults, e.g. `postgresql://collectrx:collectrx_local_dev_only@localhost:5433/collectrx` (host **5433** maps into the container’s 5432; see [docker-compose.yml](../docker-compose.yml)). The file lives at the repo root, not inside `Collect-RX-main/`.

## Railway PostgreSQL

If Postgres runs on **[Railway](https://railway.app/)**, you do not run Docker or a local server for that database.

1. In the Railway project, open the **Postgres** service (or the service that has the database plugin).
2. Open the **Connect** (or **Variables**) tab. For **running Prisma on your laptop**, copy a connection string whose host is **public** (e.g. `*.rlwy.net`, a proxy host, or `*.railway.app` — exact shape varies by project). **Do not** use a host ending in **`.railway.internal`** for local tools: that hostname only resolves **inside** Railway’s private network (e.g. from your deployed app), not from your Mac.
3. If **Variables** only show `DATABASE_URL` with an internal host, use the **public** / **external** / **TCP** URL from the **Connect** instructions, or temporarily add a public database URL from Railway’s docs.
4. Put that value in **`Collect-RX-main/.env`** (only on your machine; never commit it). Include **`?sslmode=require`** if Railway’s URL includes it (Prisma accepts it as part of the URL string).
5. From the monorepo root (`collectrx-platform/`), run migrations against that database:
   - `npm run db:generate:collectrx`
   - `npm run db:migrate:dev:collectrx` (when you are creating new migrations), or `npm run db:migrate:collectrx` to apply existing migrations only (e.g. deploy / CI style).

**Practical note:** Pointing a **local** dev app at a **shared** Railway DB means seeds and tests affect that same database. For safer iteration, use a **separate** Railway Postgres (or a separate database on the same instance) for dev vs production, and keep production credentials only in Railway’s environment for the deployed service.

## Backups, RPO / RTO (P6-05)

Use your **Postgres host’s** automated backups (e.g. Railway, RDS, Neon). **Test a restore** to a non-prod database on a schedule. Document **RPO** (max acceptable data loss, usually backup interval) and **RTO** (time to be back online) in your internal ops doc. See [PHASE6-OPS.md](operations/PHASE6-OPS.md#database-backups-p6-05).

## Migrations

- SQL lives in `Collect-RX-main/prisma/migrations/`.
- New schema changes: edit `schema.prisma`, then from `Collect-RX-main`:

  `npx prisma migrate dev --name describe_change`

- Baseline: `20260422120000_init` (initial create).
- `20260712020000_insurance_claim_soft_delete` adds `insurance_claims.deleted_at`.
  Deploy it with `prisma migrate deploy`; application reads and call dispatch
  exclude deleted claims, while call and recovery history remains retained.

## Staging / production

- Use a **hosted Postgres** (RDS, Cloud SQL, Neon, Supabase, Railway Postgres, etc.).
- Set `DATABASE_URL` in the host’s secret store (not committed).
- Staging should use **synthetic or anonymized** data only; see [ENVIRONMENT-MATRIX.md](./ENVIRONMENT-MATRIX.md).
- After deploying RLS migrations, confirm the application database role does
  not have PostgreSQL `BYPASSRLS`. The CI `rls-strict` job verifies tenant
  isolation without that privilege.
