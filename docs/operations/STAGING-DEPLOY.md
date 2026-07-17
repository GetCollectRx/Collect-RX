# Deploy CollectRx staging (manual)

Deploys `collect-rx-staging` from `Collect-RX-main/fly.staging.toml`.

**Prerequisites:** Fly app `collect-rx-staging` created; secrets set separately (test Stripe, staging DB).

```bash
fly apps create collect-rx-staging  # once
fly secrets set -a collect-rx-staging DATABASE_URL=... JWT_SECRET=... REDIS_URL=...
```

## GitHub Actions

Workflow: **CollectRx staging deploy** (`collectrx-staging-deploy.yml`) — `workflow_dispatch` only.

## Local

```bash
cd Collect-RX-main
fly deploy -c fly.staging.toml -a collect-rx-staging
```

Use staging URL for Playwright/k6 before production releases.

**After deploy:** run the Group C smoke pack — [STAGING-SMOKE.md](STAGING-SMOKE.md):

```bash
export STAGING_API_BASE='https://YOUR_STAGING_HOST'
npm run smoke:staging -w dental-ar-system
```
