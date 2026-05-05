# Phase 4 — go-live (production integrations)

**Goal:** Close Phase 4 for a real launch, not a “code slice” demo. The app will **read** this checklist; operators **execute** DNS, SendGrid, Twilio, Stripe, and secrets in the **hosting platform** (e.g. Railway), not in git.

| ID | System | In repo | You do before launch |
|----|--------|--------|----------------------|
| **P4-01** | SendGrid | API from env, bounces & spam via Event Webhook | [ ] Verify **SPF, DKIM, DMARC** on the from-domain. [ ] Bounce/complaint **Event Webhook** → `https://<API_HOST>/api/webhooks/sendgrid`. [ ] Paste **Event Webhook verification key** into `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY` (SendGrid → Webhooks). [ ] Point **Engagement** or similar monitoring at bounces. |
| **P4-02** | Email compliance | HMAC one-click `GET /api/public/email-unsubscribe?…`, `emailOptOutAt`, `List-Unsubscribe` headers, footers on reminders | [ ] Jurisdiction: have **counsel** sign off on CASL/TCPA/ADA as applicable. [ ] Set `PUBLIC_API_BASE_URL` to your **public API** origin if it differs from `PUBLIC_APP_URL` (email links). [ ] Set `EMAIL_UNSUBSCRIBE_SECRET` (or rely on `JWT_SECRET`) in prod. |
| **P4-03** | Twilio | Inbound `POST /api/twilio/sms`, STOP/START/HELP, signature when `TWILIO_SMS_INBOUND_URL` set | [ ] **Prod** number(s). [ ] Inbound **URL** in Twilio **matches exactly** the value in `TWILIO_SMS_INBOUND_URL` (no trailing slash mismatch). [ ] Do not log full message bodies in prod. |
| **P4-04** | Stripe Connect | Connect + webhooks; Admin shows keys + connect status | [ ] **Separate** test vs **live** keys. [ ] Complete Connect; **charges enabled** in Admin. [ ] Live webhook secret for prod URL. [ ] Disclose platform fees in practice onboarding. |
| **P4-05** | Vapi | `POST /api/vapi/webhook` with secret + idempotency | [ ] Vapi custom credential matches `VAPI_WEBHOOK_SECRET`. [ ] Rotate: update both sides; see [SECRETS-GO-LIVE.md](SECRETS-GO-LIVE.md) and [CREDENTIAL-ROTATION-PILOT.md](CREDENTIAL-ROTATION-PILOT.md). |
| **P4-06** | Secrets | [SECRETS-GO-LIVE.md](SECRETS-GO-LIVE.md), [CREDENTIAL-ROTATION-PILOT.md](CREDENTIAL-ROTATION-PILOT.md) | [ ] All secrets in **host** vars. [ ] **Break-glass** and rotation documented. [ ] No secrets in repo. |
| **P4-07** | PMS (AbelDent / Dentrix) | Per [PMS-INTEGRATION-PLAN.md](../product/PMS-INTEGRATION-PLAN.md) | [ ] Program decision: whether a connector spike is in scope for your release and what “done” means (time-box, read path vs file drop, etc.). |
| **P4-08** | Degraded third parties | 2-attempt send retry (email/SMS), Admin **Integrations** status | [ ] Deeper **queue** + idempotent send pipeline when scale requires (Phase 6/8). [ ] Watch provider status pages. |

**Admin:** open **Admin → Integrations (go-live)**. Green configuration does not replace legal or DNS; it is a preflight of env and Connect for the logged-in practice.

**Deploy:** run `npx prisma migrate deploy` after pull (includes `emailOptOutAt` and related).
