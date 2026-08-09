# Credential rotation — pilot checklist (Vapi + Postgres)

Secrets are not rotatable from git: operators perform these steps in each provider, then update the host’s variables and restart services.

## 0. Fastest path for `VAPI_WEBHOOK_SECRET` and `TWILIO_AUTH_TOKEN`: new scripts (added 2026-08-09, not yet run against live infra)

`Collect-RX-main/scripts/ops/` has two scripts that automate the Fly-side half of rotating these two secrets:

- [`rotate-vapi-webhook-secret.sh`](../../Collect-RX-main/scripts/ops/rotate-vapi-webhook-secret.sh) — generates a new secret with `openssl rand -hex 32`, runs `fly secrets set VAPI_WEBHOOK_SECRET=... -a <app>` (app name read from `fly.toml`, not hardcoded), then prints the new value once (stdout only, never written to a file) plus the manual Vapi-dashboard steps that still have to be done by hand.
- [`rotate-twilio-auth-token.sh`](../../Collect-RX-main/scripts/ops/rotate-twilio-auth-token.sh) — Twilio issues the token value, so this script cannot generate one. It prints the exact Twilio Console steps, takes the new token as an argument (or `$TWILIO_AUTH_TOKEN`), and runs `fly secrets set TWILIO_AUTH_TOKEN=... -a <app>` the same way.

Both replace steps 2–4 of section 2 below (for the webhook secret) and the Twilio token rotation in [`docs/CREDENTIAL_ROTATION.md`](../CREDENTIAL_ROTATION.md) with one command each — still followed by the same manual dashboard/console step and the same test-call verification, which no script can do for you.

**Status as of this writing: these two scripts are new, untested-against-real-infrastructure tooling.** They have been syntax-checked (`bash -n`) and run once each in a sandbox with no `flyctl` installed and no network access to Fly/Vapi/Twilio, to confirm they fail cleanly (print "flyctl not found..." and exit 1) instead of crashing. **Neither `VAPI_WEBHOOK_SECRET` nor `TWILIO_AUTH_TOKEN` has actually been rotated by running them.** The first real run against the live `collect-rx` Fly app is still pending an operator with real Vapi/Twilio/Fly access — do not read this section as a record that rotation happened.

## 1. Vapi API key (`VAPI_API_KEY`)

1. Log in to [Vapi dashboard](https://dashboard.vapi.ai).
2. Create a **new** API key; copy it once.
3. In your host’s **Variables**, set `VAPI_API_KEY` to the new value.
4. **Deploy / restart** the service so all instances load the new key.
5. In the Vapi dashboard, **revoke** the old API key after confirming calls still work.

## 2. Vapi webhook secret (`VAPI_WEBHOOK_SECRET`)

This must match the “custom credential” / webhook secret configured in Vapi for `POST /api/vapi/webhook`.

Steps 1–2 below can be done in one command with `scripts/ops/rotate-vapi-webhook-secret.sh` (see section 0 above) — it still leaves you to do steps 3–4 by hand.

1. Generate a new random secret, for example: `openssl rand -hex 32`.
2. Set `VAPI_WEBHOOK_SECRET` in host secrets to that value; redeploy.
3. In Vapi, update the webhook / server URL secret to the **same** value (see [PHASE4-GO-LIVE.md](PHASE4-GO-LIVE.md) P4-05).
4. Send a test webhook or place a test call and confirm **200** and no signature errors in logs.

## 3. PostgreSQL password (`DATABASE_URL`)

1. In your managed **Postgres** console, use **Reset password** / rotate credentials per the host’s current UI.
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
