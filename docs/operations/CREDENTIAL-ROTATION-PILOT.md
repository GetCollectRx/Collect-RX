# Credential rotation — pilot checklist (Vapi + Railway Postgres)

Secrets are not rotatable from git: operators perform these steps in each provider, then update Railway (or your host) variables and restart services.

## 1. Vapi API key (`VAPI_API_KEY`)

1. Log in to [Vapi dashboard](https://dashboard.vapi.ai).
2. Create a **new** API key; copy it once.
3. In **Railway** → your CollectRx service → **Variables**, set `VAPI_API_KEY` to the new value.
4. **Deploy / restart** the service so all instances load the new key.
5. In the Vapi dashboard, **revoke** the old API key after confirming calls still work.

## 2. Vapi webhook secret (`VAPI_WEBHOOK_SECRET`)

This must match the “custom credential” / webhook secret configured in Vapi for `POST /api/vapi/webhook`.

1. Generate a new random secret, for example: `openssl rand -hex 32`.
2. Set `VAPI_WEBHOOK_SECRET` in Railway to that value; redeploy.
3. In Vapi, update the webhook / server URL secret to the **same** value (see [PHASE4-GO-LIVE.md](PHASE4-GO-LIVE.md) P4-05).
4. Send a test webhook or place a test call and confirm **200** and no signature errors in logs.

## 3. Railway PostgreSQL password (`DATABASE_URL`)

1. In **Railway** → your **Postgres** plugin → **Variables** (or **Connect**), use **Reset password** / rotate credentials per Railway’s current UI.
2. Copy the new connection URL (or update only the password segment in `DATABASE_URL`).
3. Update `DATABASE_URL` on **every** service that connects to that database (API, workers, Prisma migrate jobs).
4. **Redeploy** all dependent services.
5. Run migrations if needed: `npx prisma migrate deploy` from `Collect-RX-main` with the new URL.
6. Confirm health: app login, a read query, and worker connectivity.

## 4. After rotation

- [ ] No old keys remain in Slack, tickets, or screenshots.
- [ ] `.env` on laptops uses **local** dev values only; production secrets only in the host.
- [ ] Document who performed the rotation and when (internal ops log).

For general secret handling, see [SECRETS-GO-LIVE.md](SECRETS-GO-LIVE.md).
