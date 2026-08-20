# CollectRx — Fly.io Deployment Guide

Production runs on Fly.io: app `collect-rx`, primary region `yyz` (Toronto —
PHIPA/PIPEDA data residency). Railway is fully decommissioned; any Railway
URL or config you find is a stale leftover.

## Layout

| Piece | Where | Notes |
|---|---|---|
| Config | `fly.toml` | Source of truth; keep in sync with `fly config show -a collect-rx` |
| Web process | `app = 'npm run start'` | Express on internal port 3000, autostop/autostart, min 1 machine |
| Worker process | `worker = 'npm run worker'` | BullMQ jobs; always on |
| Migrations | `release_command = 'npx prisma migrate deploy'` | Runs before each release; nonzero exit blocks the deploy |
| Postgres | Fly Postgres, private network | Connection uses `.flycast`/`.internal` hosts (see `src/server/databaseTls.ts`) |
| Redis | Shared `REDIS_URL` | App and worker must point at the same instance (BullMQ producer/consumer) |
| Health check | `GET /api/health/ready` | Wired into `[[http_service.checks]]` (`fly.toml`); checks DB connectivity and, in production, the RLS role-safety gate — see `OUTSTANDING-FIXES-PRODUCT-READY.md` P11-02. `GET /api/health` is the separate, DB-independent liveness endpoint Fly's proxy checks for an open socket. |

## Deploy

```bash
fly deploy                    # build, run migrations, roll out
fly status -a collect-rx      # machine + release state
fly logs -a collect-rx        # tail production logs
```

The server caches `index.html` (asset manifest) at boot — a release restarts
the machines so this is handled, but if the UI ever looks stale after a
deploy, restart the app machines (`fly machine restart`) before debugging
further.

## Secrets / environment

```bash
fly secrets list -a collect-rx
fly secrets set KEY=value -a collect-rx   # triggers a restart
```

`npm run check:env` validates required variables; `.env.example` is the
reference list.

## Verify a release

```bash
curl -s https://<app-host>/api/health        # {"status":"ok",...}
npm run smoke:live                           # live smoke suite
```

## Rollback

```bash
fly releases -a collect-rx                   # find the last good image
fly deploy --image <registry-image-ref>      # redeploy it
```

Migrations are forward-only (`prisma migrate deploy`); rolling back code does
not roll back schema. Write down the release id before risky deploys.
