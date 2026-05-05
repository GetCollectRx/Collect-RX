# Secrets — production runbook (P4-06)

1. **Where they live** — Railway, AWS Parameter Store, or your host’s “Variables” UI. Never in `.env` committed to git, screenshots in Slack, or public tickets.

2. **Which secrets** (non-exhaustive) — `DATABASE_URL`, `JWT_SECRET`, `EMAIL_UNSUBSCRIBE_SECRET` (optional if `JWT_SECRET` is used for the same HMAC), `SENDGRID_API_KEY`, `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN`, `VAPI_WEBHOOK_SECRET`, etc. See [Collect-RX-main/.env.example](Collect-RX-main/.env.example).

3. **Rotation** — Generate new value in provider → set new var in host → **deploy** or restart so all instances read the new value → revoke the old value in the provider. For Stripe/SendGrid, prefer creating a **new** key, switching traffic, then deleting the old one. For Vapi + Postgres before pilot, follow [CREDENTIAL-ROTATION-PILOT.md](CREDENTIAL-ROTATION-PILOT.md).

4. **Break-glass** — A second admin path to the host (e.g. Railway team login with MFA) for when primary operators are locked out. Document who has access; audit when used.

5. **Emergency revoke** — If a key is leaked: revoke in the provider first, then remove from the host, then rotate any dependent webhooks (Stripe signing secret, SendGrid event key, Vapi custom credential, Twilio token).

6. **Separation** — `sk_test_` vs `sk_live_` Stripe keys; never use live for staging.
