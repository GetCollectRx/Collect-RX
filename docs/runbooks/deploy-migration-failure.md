# Runbook: production deploy stops at the release step (migration failure)

**Symptom:** the deploy workflow fails at "Deploy to collect-rx (production)" with `release_command failed`. The old release keeps serving. Nothing is down.

**Origin:** on 2026-10-02 the migration `20260811180000_carrier_submission_channels` failed with `permission denied for schema public`. Prisma recorded it as failed and refused all later migrations (error P3009).

## What the release step now tells you

`scripts/release-migrate.mjs` runs before `prisma migrate deploy` and prints one of:

| Message | Meaning | Fix |
|---|---|---|
| `BLOCKED: N migration(s) are recorded as failed` | A past migration failed and was never resolved. | Section A |
| `BLOCKED: database role ... has no CREATE privilege on schema public` | Pending migrations would fail with permission denied. | Section B |
| `WARNING: ... no CREATE privilege` | Nothing pending now, but the next migration will fail. | Section B before the next migration ships |
| `could not run the check` | The diagnostic could not connect. It continues to `migrate deploy` anyway. | Read the next lines of the log |

The check never changes the database.

## A. Resolve a failed migration

1. Read the log of the run that first failed (the one that says `Applying migration`), not only the latest run.
2. Connect with an owner-level role (`flyctl proxy 15432:5432 -a collect-rx-db`, then `psql`).
3. Look for leftovers from the half-run migration (tables, enums, indexes it creates). Remove them, or confirm none exist.
4. `npx prisma migrate resolve --rolled-back <migration_name>` to re-run it cleanly, or `--applied <migration_name>` only if every object it creates exists.
5. Fix the cause first (Section B if it was a permission error), then re-run the deploy.

## B. Give the release role the privilege it needs

As the database owner: `GRANT USAGE, CREATE ON SCHEMA public TO "<role shown in the message>";`

If you want the app role to stay least-privilege, give the release command its own owner-role connection string instead, and keep the app on the restricted one. Either way, confirm Row Level Security still applies to the app role (`docs/operations/HUMAN-DECISIONS-PENDING.md`, item 3).

## Before dispatching any production deploy

1. Open the last five runs of `CollectRx production deploy`. If any failed, read that log first.
2. Confirm CI is green on the exact commit you are deploying.
3. Snapshot the database if the release adds migrations: `flyctl postgres` snapshot or `fly volumes snapshots create`.
4. Deploy to staging first (`collectrx-staging-deploy`) when migrations are included.
5. After deploy, `GET /api/health/ready` must return 200 and the post-deploy smoke step must pass.
