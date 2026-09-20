# Staging smoke — Group C operator pack

**Purpose:** Prove staging is ready before live integrations (Group D).  
**Product boundary:** Practice → Insurance only. No patient/client payment checks.

Related: [STAGING-DEPLOY.md](STAGING-DEPLOY.md), [PATH-TO-DELIVERY.md](PATH-TO-DELIVERY.md), [ENVIRONMENT-MATRIX.md](../ENVIRONMENT-MATRIX.md), [csv-ar-rollout.md](../../Collect-RX-main/docs/csv-ar-rollout.md).

---

## Prerequisites

- [ ] Staging app deployed (`collect-rx-staging` or your host)
- [ ] Staging `DATABASE_URL` (Postgres) — **synthetic data only**
- [ ] `JWT_SECRET` set (not a shared prod secret)
- [ ] Stripe **test** keys only on staging

---

## 1. Migrate + seed

```bash
cd Collect-RX-main
# Point at staging DB (do not use prod URL)
export DATABASE_URL='postgresql://…staging…'
npx prisma migrate deploy
npm run db:seed          # or: npm run demo:seed
```

CSV-AR migration must apply: `20260712213000_csv_ar_expansion`.

---

## 2. Health smoke (script)

```bash
export STAGING_API_BASE='https://YOUR_STAGING_API_HOST'   # no trailing slash
./scripts/staging-smoke.sh
```

Or manual:

```bash
curl -sf "$STAGING_API_BASE/api/health" | jq .
curl -sf "$STAGING_API_BASE/api/health/ready" | jq .
curl -sf "$STAGING_API_BASE/api/health/metrics" | jq .
```

**Pass:** liveness `200`, ready `200` (DB up), metrics `200`.

Optional Redis:

```bash
curl -sf "$STAGING_API_BASE/api/health/queue" | jq .
```

---

## 3. Product path smoke (browser)

- [ ] Login with seeded practice credentials  
- [ ] Dashboard loads (no fake KPIs / honest empty states)  
- [ ] CSV import or demo claims visible  
- [ ] Claims / work queue opens  
- [ ] Admin → Integrations shows env presence (SendGrid/Twilio/Stripe/Vapi flags)  
- [ ] `/billing` loads (Stripe **test** Checkout optional)  
- [ ] Confirm **no** Patient A/R / pay-link UI  

---

## 4. Worker (optional but recommended)

If `REDIS_URL` is set on staging:

- [ ] Worker process running (`npm run worker` or host process)
- [ ] `/api/health/queue` reports depth without error

Without Redis, in-process schedulers are OK for low traffic.

---

## 5. CSV-AR / RLS before prod enable

On staging Postgres:

```bash
cd Collect-RX-main
DATABASE_URL='postgresql://…staging…' npx vitest run tests/rls.test.ts tests/csv-ar-expansion.test.ts
```

- [ ] RLS suites pass (or documented skip with risk acceptance)  
- [ ] Feature flags for CSV-AR reviewed ([csv-ar-rollout.md](../../Collect-RX-main/docs/csv-ar-rollout.md))  

---

## 6. Sign-off

| Check | Owner | Date |
|-------|--------|------|
| Migrate + seed | | |
| Health smoke | | |
| Browser product path | | |
| RLS / CSV-AR | | |
| Redis/worker (if used) | | |

**Group C done when** this table is filled and PATH-TO-DELIVERY §C checkboxes are ticked.
