# Credential rotation (CollectRx)

**Project root:** `/Users/khalidegeh/Desktop/Dentist/collectrx-platform`  
The **Click** app (`Click-main/` or `collectrx-platform/Click` clone) implements API routes referenced below; keep this checklist with your deployment env.

Use this checklist when rotating secrets after exposure, a team change, or on a regular schedule.  
**Do not commit real values.** Store them in your host’s secret store, AWS Parameter Store, or your team’s secret manager.

## Verify repo is clean

- [ ] No `.env` or `*.db` with production data in git (see `.gitignore`).
- [ ] Grep the repo for accidental pastes: `sk_`, `whsec_`, `SG.`, long base64 tokens.

## Rotation order (minimize downtime)

1. **Create new secret** in the provider UI (or roll API key) while old key still works.
2. **Update deployment env** (your hosting platform) with the new value. Deploy or restart.
3. **Update local `.env`** for developers (share via 1Password / vault, not Slack).
4. **Revoke old secret** in the provider after confirming health checks pass.

## Per integration

### Stripe

| Variable | Where to rotate | After rotation |
|----------|-----------------|----------------|
| `STRIPE_SECRET_KEY` | [Dashboard → API keys](https://dashboard.stripe.com/apikeys) | Practice `/billing` Checkout in staging (SaaS Billing only) |
| `STRIPE_WEBHOOK_SECRET` | Webhook endpoint → "Signing secret" (per endpoint) | `POST /api/stripe/webhook` receives 200 on test event from Dashboard |

If you rotate the webhook secret, update it in **one place** (your host’s secret store) and in Stripe for the same endpoint URL.

### SendGrid

| Variable | Where | After |
|----------|--------|--------|
| `SENDGRID_API_KEY` | SendGrid → API Keys | Send a test reminder in staging |

### Twilio

| Variable | Where | After |
|----------|--------|--------|
| `TWILIO_ACCOUNT_SID` | Usually unchanged (account id) | — |
| `TWILIO_AUTH_TOKEN` | Twilio Console → Account → API keys / tokens | Test SMS in staging |
| `TWILIO_FROM_NUMBER` | If you use a new sender, update Messaging service / compliance | Test send |

### App / API

| Variable | Purpose | After |
|----------|---------|--------|
| `COLLECTRX_API_KEY` | Optional; protects mutating API routes | Regenerate a long random string; update any client (scripts, Postman) |
| `RAILWAY_API_TOKEN` | Desktop sync → backend (if used) | Regenerate on the server; update practice machine env |

### Database

| Context | Action |
|---------|--------|
| Local SQLite | `prisma/dev.db` is gitignored; no cloud password for default dev |
| Production Postgres (if used) | Rotate password in host; update `DATABASE_URL`; run health check |

### Desktop / Electron

| Variable | Notes |
|----------|--------|
| `COLLECTRX_DASHBOARD_URL` | Not a secret; point to your deployed app URL |
| `RAILWAY_API_URL` + token | Rotate token on server; update each installed practice env |

## Definition of done

- [ ] All listed env vars for your environment are set from the vault, not from chat or repo.
- [ ] Old keys revoked where the provider allows it.
- [ ] Smoke test: health, one read API, one protected action (if `COLLECTRX_API_KEY` is on), optional Stripe test webhook.

## Emergency: key committed to git

1. **Revoke** the key immediately in the provider.
2. **Remove** the commit from history if the repo is public or widely cloned (BFG or `git filter-repo`), or assume the secret is burned and rotate only.
3. **Rotate** and deploy as above.
