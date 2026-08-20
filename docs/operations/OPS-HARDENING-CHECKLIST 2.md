# Ops hardening checklist — Group F

Detail: [PHASE6-OPS.md](PHASE6-OPS.md). Launch path: [PATH-TO-DELIVERY.md](PATH-TO-DELIVERY.md).

## Monitoring

| Item | Env var / action | Done |
|------|------------------|------|
| Sentry server | `SENTRY_DSN` on host | [ ] |
| Sentry browser | `VITE_SENTRY_DSN` in build | [ ] |
| Sample rate | `SENTRY_TRACES_SAMPLE_RATE` tuned | [ ] |
| Uptime check | Poll `GET /api/health/ready` every 1–5 min; alert if down > N min | [ ] |
| Alert destination | Pager/Slack/email documented | [ ] |

## Data protection

| Item | Action | Done |
|------|--------|------|
| Automated DB backups | Enabled on host Postgres | [ ] |
| Restore drill | Restore to staging once; record time | [ ] |
| RPO / RTO | Written (hours) | [ ] |

## Deploy

| Item | Action | Done |
|------|--------|------|
| Deploy runbook | Practice once on staging | [ ] |
| Rollback | Redeploy previous image/commit once | [ ] |
| Post-deploy smoke | `STAGING_API_BASE=… npm run smoke:staging` (or prod URL) | [ ] |
| Staging ≈ prod | Same env shape; test keys staging / live prod | [ ] |

## Support stance

| Item | Action | Done |
|------|--------|------|
| On-call rotation | Named schedule **or** | [ ] |
| Explicit “no 24/7” | Stated in Terms / support page | [ ] |
| Status / incident comms | Status page URL or email template | [ ] |

## Sign-off

| Check | Owner | Date |
|-------|--------|------|
| Monitoring live | | |
| Backup restore proven | | |
| Deploy/rollback practiced | | |
| Support stance documented | | |
