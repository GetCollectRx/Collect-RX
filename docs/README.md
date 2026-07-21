# CollectRx platform docs

**Canonical project folder:** `/Users/khalidegeh/Desktop/Dentist/collectrx-platform`

| File | Purpose |
|------|---------|
| [product/MVP-SCOPE.md](./product/MVP-SCOPE.md) | Product name, target user, MVP and non-goals (P1-01) |
| [adr/0001-primary-application-stack.md](./adr/0001-primary-application-stack.md) | ADR: canonical app vs root prototype (P1-02) |
| [product/SCREENS-API-DATA-MAP.md](./product/SCREENS-API-DATA-MAP.md) | Screens, APIs, and data stores (P1-03) |
| [ENVIRONMENT-MATRIX.md](./ENVIRONMENT-MATRIX.md) | local / staging / prod matrix (P1-04) |
| [operations/BREAKAGE-DIAGNOSIS.md](./operations/BREAKAGE-DIAGNOSIS.md) | `npm run diagnose` — what broke (typecheck, env, DB, tests, live smoke) |
| [operations/OPS-ALERTS.md](./operations/OPS-ALERTS.md) | Ops alerts with impact + suggested fixes (SMS, email, Slack, monitor) |
| [DATABASE.md](./DATABASE.md) | PostgreSQL, Prisma migrate, local Docker (P2-05, P2-06, P2-08) |
| [RELEASING.md](./RELEASING.md) | Version tags and changelog process (P2-10) |
| [NPM-AUDIT.md](./NPM-AUDIT.md) | `npm audit` triage notes (P2-11) |
| [DEPRECATION.md](./DEPRECATION.md) | Policy for non-canonical `src/` (P1-07) |
| [../CHANGELOG.md](../CHANGELOG.md) | User-visible / release changes |
| [CREDENTIAL_ROTATION.md](./CREDENTIAL_ROTATION.md) | How to rotate Stripe, SendGrid, Twilio, API keys, etc. |
| [operations/CREDENTIAL-ROTATION-PILOT.md](./operations/CREDENTIAL-ROTATION-PILOT.md) | Vapi + Fly Postgres rotation before pilot |
| [PILOT_SCOPE.md](./PILOT_SCOPE.md) | Single-practice pilot until Day-90 decision |
| [PHI_DATA_CLASSIFICATION.md](./PHI_DATA_CLASSIFICATION.md) | PHI handling and third-party boundaries |
| [compliance/PHASE5-COMPLIANCE.md](./compliance/PHASE5-COMPLIANCE.md) | Phase 5 security/privacy — index + P5-01…P5-12 |
| [../Collect-RX-main/DEPLOY.md](../Collect-RX-main/DEPLOY.md) | **Production (Fly.io)** — app `collect-rx`, Postgres, deploy/rollback/secrets |
| [operations/ALWAYS-ON.md](./operations/ALWAYS-ON.md) | Local PM2 only (not for client-facing hosting) |
| [operations/PHASE6-LEARNING-LOOP.md](./operations/PHASE6-LEARNING-LOOP.md) | Phase 6: Notion learning loop (research → rank → implement → SMS) |
| [operations/PHASE6-OPS.md](./operations/PHASE6-OPS.md) | Platform ops: logging, Sentry, health, metrics, deploy, webhooks, smoke |

Phased requirements live in **`../Product Requirement Document/`**.

The shipping **Click** application may live in `Click-main/`, a separate git clone, or `collectrx-platform/Click`—keep these docs in this tree as the program reference.
