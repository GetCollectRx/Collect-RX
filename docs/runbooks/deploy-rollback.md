# Runbook: Production deploy rollback

**Target time: rollback initiated within 5 minutes of the decision to roll back, complete (traffic fully on the previous release) within 10.** This is not an SLA promise to customers — it's the internal bar for how long "we know we need to roll back" should take to turn into "we have rolled back," so a bad deploy doesn't sit live while someone hunts for the right command under pressure.

This is a Fly.io Machines app (`fly.toml`, app `collect-rx`) — there is no bespoke blue-green pipeline here, and building one is explicitly out of scope (see `docs/operations/PRODUCTION-SAFETY-BACKLOG.md`'s P2.2 entry). Rollback means redeploying a previous image.

## What already protects you before you ever need this

- `fly.toml`'s `[[http_service.checks]]` — every new machine must pass `GET /api/health/ready` (15s interval, 30s grace period) before Fly considers it healthy.
- `fly.toml`'s `[deploy].release_command = 'npx prisma migrate deploy'` — runs as a one-off machine before the new release rolls out; a nonzero exit blocks the deploy from proceeding at all. A bad migration never reaches a running instance.
- The post-deploy smoke step wired into `.github/workflows/collectrx-prod-deploy.yml` (P2.2) — catches issues Fly's own health check can't see (the process is up and the DB is reachable, but a specific route or behavior regressed).

**No explicit `[deploy.strategy]` is set in `fly.toml`**, so this app uses Fly's platform default rollout behavior. Confirm the exact current guarantees (does a failed health check during rollout automatically keep the previous machine serving traffic, or does it require manual intervention?) against `fly deploy --help` and Fly's current Machines-app rollout docs before assuming — flyctl's rollout mechanics have changed across versions, and this repo doesn't pin one down explicitly. Treat the manual rollback procedure below as the reliable path regardless of what the automatic behavior turns out to guarantee.

## Detection — when to roll back

- The post-deploy smoke step (`npm run smoke:live` in CI, or run manually) fails after a deploy.
- `high_5xx_rate` or `liveness` fires shortly after a release (see `api-errors-or-down.md` — check whether the timing correlates with the deploy before assuming rollback is the right move).
- A practice or internal user reports a clear regression immediately following a release.

## Assessment

1. Confirm the regression is actually deploy-correlated: `fly releases -a collect-rx` — check the timestamp of the most recent release against when the symptom started.
2. Decide fix-forward vs. roll back: if the fix is small, well-understood, and faster to ship than a rollback+re-fix+re-deploy cycle, fix forward instead. Roll back when the fix is unclear, risky, or will take more than a few minutes to prepare safely.
3. **Check whether the release included a new migration.** If `prisma/migrations/` gained a new migration in the release you're rolling back from, rolling back the *application code* while the *database schema* stays on the new migration can itself break the old code (columns it doesn't expect, or columns the old code needs that are now gone). Read the migration before rolling back — a purely additive migration (new nullable column, new table) is safe to roll back code against; a destructive one (dropped/renamed column) is not, and needs a data-safe path decided before you redeploy old code.

## Escalation

Any production rollback is visible to whoever's watching deploys — post in your team's incident channel before starting, not after, so a second deploy doesn't race yours.

## Mitigation — the rollback

1. Find the previous good release:
   ```
   fly releases -a collect-rx
   ```
   Note the image reference (or version number) of the last known-good release — i.e. the one *before* the one you're rolling back.
2. Redeploy that image:
   ```
   fly deploy --image <previous-image-ref> -a collect-rx --remote-only
   ```
   (Exact flag names — `--image` vs. an equivalent — should be confirmed against your installed `flyctl` version's `--help` output; this is the documented pattern as of when this runbook was written, not something rehearsed against a live `flyctl` in this exact repo yet — see "keep runbooks honest" in `README.md`.)
3. This goes through the same `[[http_service.checks]]` gate as any other deploy — the rollback itself isn't exempt from health checks. If the previous image also fails to come up healthy, something else changed underneath it (infra, secrets, a since-rotated credential) — don't keep retrying the same rollback blindly.
4. **If the release being rolled back from included a destructive migration** (per the assessment step above): do not roll back code alone. You need either a compensating migration that makes the schema compatible with the old code again, or to accept the outage continues until a forward fix ships — decide this explicitly, don't default to "just redeploy old code" without checking.

## Verification

1. `GET /api/health/ready` returns 200 on the rolled-back release.
2. Run the post-deploy smoke check manually against production: `SMOKE_BASE_URL=https://collect-rx.fly.dev npm run smoke:live` (from `Collect-RX-main/`).
3. Confirm the originally-reported symptom is actually gone, not just that health checks pass — a rollback that "succeeds" per Fly but doesn't fix the reported problem means the regression wasn't deploy-correlated after all, and you're now debugging the wrong thing.
4. `fly releases -a collect-rx` — confirm the current release is the one you intended to roll back to.

## Postmortem

Required for every rollback. Include: what the regression actually was, why the deploy pipeline's existing gates (CI's `verify` job, Fly's health check, the post-deploy smoke step) didn't catch it before it reached production, and whether the rollback exposed any gap in this runbook itself (an unrehearsed `flyctl` flag, an unclear migration-compatibility decision) — fix the runbook in the same PR as the postmortem, per `README.md`.
