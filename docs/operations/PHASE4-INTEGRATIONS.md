# Phase 4 — Integrations (production) — runbook

**Primary go-live checklist:** [PHASE4-GO-LIVE.md](PHASE4-GO-LIVE.md) (operator sign-off). **Secrets:** [SECRETS-GO-LIVE.md](SECRETS-GO-LIVE.md). Code lives in `Collect-RX-main/` unless noted.

| ID | Task | In-repo / operator |
|----|------|----------------------|
| **P4-01** | SendGrid: API + domain + bounces | **Code:** `POST /api/webhooks/sendgrid` (raw body, Ed25519 verify when `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY` set). **Operator:** SPF/DKIM/DMARC; Event Webhook URL; verification key from SendGrid. Env: `SENDGRID_*` ([.env.example](../../Collect-RX-main/.env.example)). |
| **P4-02** | Unsubscribe + preferences | **Code:** `emailOptOutAt`, `GET /api/public/email-unsubscribe?…`, `List-Unsubscribe` + footers where email is sent. **Compliance:** counsel for your jurisdiction. |
| **P4-03** | Twilio | **Code:** inbound SMS handlers where used; STOP/START/HELP. **Operator:** inbound URL exact match to Twilio’s “A message comes in” URL. |
| **P4-04** | Stripe Billing (practice SaaS) | **In app today:** `GET /api/admin/integrations` + Admin show whether `STRIPE_SECRET_KEY` is set (test vs live); `/billing` Checkout + Customer Portal; `POST /api/stripe/webhook` for subscription events. **No** Stripe Connect / patient Payment Links. **Doc:** [README — Stripe](../../Collect-RX-main/README.md#stripe-test-mode-practice-saas-billing). |
| **P4-05** | Vapi | **Code:** `POST /api/vapi/webhook` + idempotency. **Operator:** [Vapi server authentication](https://docs.vapi.ai/server-url/server-authentication). |
| **P4-06** | Secrets | [SECRETS-GO-LIVE.md](SECRETS-GO-LIVE.md) — host secrets / SSM, rotation, break-glass. |
| **P4-07** | PMS | [PMS-INTEGRATION-PLAN.md](../product/PMS-INTEGRATION-PLAN.md) — what ship and when is a **program decision** (connector spike vs other intake). |
| **P4-08** | Degraded providers | **Code:** `sendEmailWithRetry` / `sendSMSWithRetry` (2 attempts per channel); **Admin** shows integration status. **Later:** queue (Phase 6/8). |

#### P4-08 — retry & failures

Outbound email/SMS helpers attempt **up to two times** (short backoff). If both attempts fail, the send is skipped for that run and can be retried on a later cycle after you fix provider config. Admin **Integrations** shows whether keys/env are present.

**Deploy:** `npx prisma migrate deploy` after pull.
