# Phase 4 — Integrations (production) — runbook

**Primary go-live checklist:** [PHASE4-GO-LIVE.md](PHASE4-GO-LIVE.md) (operator sign-off). **Secrets:** [SECRETS-GO-LIVE.md](SECRETS-GO-LIVE.md). Code lives in `Collect-RX-main/` unless noted.

| ID | Task | In-repo / operator |
|----|------|----------------------|
| **P4-01** | SendGrid: API + domain + bounces | **Code:** `POST /api/webhooks/sendgrid` (raw body, Ed25519 verify when `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY` set). **Operator:** SPF/DKIM/DMARC; Event Webhook URL; verification key from SendGrid. Env: `SENDGRID_*` ([.env.example](../../Collect-RX-main/.env.example)). |
| **P4-02** | Unsubscribe + preferences | **Code:** `emailOptOutAt`, `GET /api/public/email-unsubscribe?b=&e=&s=`, `List-Unsubscribe` + footers on balance reminders; `customArgs.balance_id` for Event Webhook correlation. **Compliance:** counsel for your jurisdiction. |
| **P4-03** | Twilio | **Code:** `POST /api/twilio/sms`; STOP/START/HELP; `smsOptOutAt`. **Operator:** `TWILIO_SMS_INBOUND_URL` exact match to Twilio’s “A message comes in” URL. |
| **P4-04** | Stripe Connect | **In app today:** `GET /api/admin/integrations` and Admin show whether `STRIPE_SECRET_KEY` is set, test vs live, and `StripeConnectAccount` (onboarding / charges) for the **current** practice. **Roadmap table still expects (product/ops, not only this screen):** fee disclosure in onboarding, links to Stripe Dashboard, and a deliberate Connect go-live *review* — track those to the [Phase 4 table](../../OUTSTANDING-FIXES-PRODUCT-READY.md#phase-4--integrations-production-configurations). **Doc:** [README — Stripe](../../Collect-RX-main/README.md#stripe-test-mode-p3-20-webhooks). |
| **P4-05** | Vapi | **Code:** `POST /api/vapi/webhook` + idempotency. **Operator:** [Vapi server authentication](https://docs.vapi.ai/server-url/server-authentication). |
| **P4-06** | Secrets | [SECRETS-GO-LIVE.md](SECRETS-GO-LIVE.md) — Railway / SSM, rotation, break-glass. |
| **P4-07** | PMS | [PMS-INTEGRATION-PLAN.md](../product/PMS-INTEGRATION-PLAN.md) — what ship and when is a **program decision** (connector spike vs other intake). |
| **P4-08** | Degraded providers | **Code:** `sendEmailWithRetry` / `sendSMSWithRetry` (2 attempts per channel); **Admin** shows integration status. **Later:** queue (Phase 6/8). |

#### P4-08 — retry & failures (what happens if both attempts fail?)

In the **daily reminder cycle** and **manual “Send reminder”** (Patient A/R), each channel calls the send helper **up to two times** (1s backoff between). If, after that, **email and SMS both** still report failure (or are skipped: no address, opt-out, etc.):

- **`recordReminderSent` is not called** for that run — `reminderStatus` does **not** advance, and `lastReminderEmailAt` / `lastReminderSmsAt` are **unchanged**.
- The cycle logs `Reminder skipped (no contact info or send failed)` and increments the internal **skipped** counter.
- On a **later** run, the same balance can be a **candidate again** (the engine does not “poison” the row on failure). That means **transient** outages can be retried on the next eligible day; it also means persistent misconfiguration will keep trying until you fix env or the patient is no longer in the candidate window.

**Manual send:** the API still returns `{ emailSent, smsSent }` — if both are `false`, the UI should already surface that; no `recordReminderSent` in that case either.

**Deploy:** `npx prisma migrate deploy` (includes `emailOptOutAt` and prior P4 columns).
