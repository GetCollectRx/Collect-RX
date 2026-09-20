# Engineering production complete

Last updated: 2026-07-09. Development checklist for **production-grade engineering** (excludes practice field proof and live ops credentials).

## Completed in this release

| Item | Deliverable |
|------|-------------|
| Connector HTTP integration tests | `tests/connector.routes.integration.test.ts` |
| Playwright E2E in CI | `.github/workflows/collectrx-ci.yml` → `e2e` job |
| Lint + Vite build on every PR | `collectrx-ci.yml` → `verify` job |
| k6 read-heavy smoke in CI | `collectrx-ci.yml` → `perf-smoke` job |
| Desktop auto-update metadata | `latest.yml` / blockmap attached on tagged Electron releases |
| Code signing | Documented — `docs/operations/DESKTOP-CODE-SIGNING.md` (unsigned pilot OK) |
| Integration failover UX | Redis ping + Stripe/Vapi/SendGrid session checks; amber banner for missing integrations |
| Second PMS connector | `src/server/pms/connectors/registry.ts` + Dentrix planned stub |
| Staging deploy | `fly.staging.toml` + `collectrx-staging-deploy.yml` + `STAGING-DEPLOY.md` |
| Download proxy + diagnostics | `desktopReleaseService.ts`, `/api/desktop/releases/diagnostics` |
| Client onboarding runbook | `docs/pilot/CLIENT-ONBOARDING.md` |

## CI matrix (main/dev PRs)

1. **verify** — prisma migrate, typecheck, lint, vite build, vitest (821+ tests)
2. **e2e** — Playwright (login, download, marketing)
3. **perf-smoke** — k6 against local API

## Tagged releases

- **Electron installers** — `collectrx-electron-installers.yml` on `v*` tags (includes auto-update yml)

## Intentionally out of scope (business / ops)

- AbelDent E2E on a real practice PC (field validation)
- Stripe/Vapi/SendGrid live credentials on Fly
- Purchased code signing certificates
- Full Dentrix connector implementation

## Verify locally

```bash
cd Collect-RX-main
npm run typecheck && npm run lint && npm test
npm run build
npm run e2e          # requires DATABASE_URL
```

## Verify production downloads

```bash
curl -sI "https://www.collectrx.ca/api/desktop/releases/assets/CollectRx.Setup.1.0.0.exe" | head -3
# Expect HTTP/2 200
```
