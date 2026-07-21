# Environment matrix (P1-04)

**Purpose:** Single place to see what differs between **local**, **staging**, and **production**. Replace hostnames and flags with your org’s real values.

| Dimension | **Local (dev)** | **Staging** | **Production** |
|-----------|------------------|-------------|------------------|
| **Canonical app** | Repo root: `npm run dev` → workspace **Collect-RX-main** (Vite 5173 + API 3000); or `cd Collect-RX-main && npm run dev` | Staging app URL (HTTPS) | Production app URL(s) (HTTPS) |
| **Root prototype** | `npm run dev:all` (UI + API 3001) or `npm run dev:prototype` | Optional; usually **off** | **Off** unless needed for internal tools |
| **Database** | `docker compose up -d` + `DATABASE_URL` in `.env` (see [DATABASE.md](./DATABASE.md)) | **Hosted Postgres**; `DATABASE_URL` in secrets; **synthetic/anon** data only | **Hosted Postgres**; `DATABASE_URL` in secrets; backups enabled |
| **Staging DB host** | N/A | e.g. Neon / RDS / Supabase — **separate** instance from prod | e.g. same family as chosen for staging, prod-scaled |
| **TLS** | HTTP localhost | HTTPS | HTTPS |
| **`NODE_ENV`** | `development` | `staging` or `production` | `production` |
| **`JWT_SECRET`** | Dev fallback allowed in code paths — **set explicit value for team** | **Required** | **Required** |
| **Auth: practice password** | Seed: `SEED_PRACTICE_PASSWORD` or `changeme` (dev only) | Unique secrets per env | Strong secrets; no defaults |
| **CORS / `ALLOWED_ORIGINS`** | Localhost origins | Staging app origin | Prod app origin(s) |
| **SendGrid (email)** | Mock if no `SENDGRID_API_KEY` (root API) / configure per app | **Live test** or sandbox | Live |
| **Twilio (SMS)** | Not wired everywhere | Test numbers | Live numbers + opt-out |
| **Stripe (practice SaaS Billing)** | Test keys + webhooks (Stripe CLI locally); `/billing` | Test keys + Billing webhooks | Live Billing keys + webhooks — **no** Connect / patient pay |
| **Vapi / voice** | Dev keys; webhook to tunnel (ngrok) or local; `POST /api/vapi/webhook` | Staging project | Production project + **SSM/rotate keys**; see [PHASE4-INTEGRATIONS.md](operations/PHASE4-INTEGRATIONS.md) |
| **AWS SSM (secrets)** | Optional; often `.env` only | Recommended | **Required** for `NODE_ENV=production` patterns in `secrets.js` |
| **Feature flags** | All experimental **on** by default | Gated; mirror prod as much as possible | **Explicit**; kill-switch for risky features |
| **Backups** | N/A (dev) | Nightly; test restore monthly | RPO/RTO per policy |
| **Logging / Sentry** | Console | Staging DSN | Prod DSN; PII rules |

**Integrations: “live” vs “mock”**

| Integration | Local default | Staging | Prod |
|-------------|--------------|---------|------|
| Email (SendGrid) | mock without keys | live/sandbox | live |
| SMS | mock / off | test | live |
| Stripe Billing | mock without keys; test keys for `/billing` | test | live (practice subscription only) |
| PMS | CSV-first default; AbelDent optional | CSV or pilot connector | per contract |

*Update this table when you add environments or feature flags.*
