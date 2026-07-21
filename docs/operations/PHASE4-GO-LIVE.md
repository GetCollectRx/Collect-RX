# Phase 4 — go-live (production integrations)

**Goal:** Close Phase 4 for a real launch, not a “code slice” demo. The app will **read** this checklist; operators **execute** DNS, SendGrid, Twilio, Stripe Billing, and secrets in the **hosting platform**, not in git.

**Product boundary:** Practice → Insurance recovery only. No patient/client payment collection (Stripe Connect / Payment Links retired).

| ID | System | In repo | You do before launch |
|----|--------|--------|----------------------|
| **P4-01** | SendGrid | API from env, bounces & spam via Event Webhook | [ ] Verify **SPF, DKIM, DMARC** on the from-domain. [ ] Bounce/complaint **Event Webhook** → `https://<API_HOST>/api/webhooks/sendgrid`. [ ] Paste **Event Webhook verification key** into `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY` (SendGrid → Webhooks). [ ] Point **Engagement** or similar monitoring at bounces. |
| **P4-02** | Email compliance | HMAC one-click `GET /api/public/email-unsubscribe?…`, `emailOptOutAt`, `List-Unsubscribe` headers, footers where email is sent | [ ] Jurisdiction: have **counsel** sign off on CASL/TCPA as applicable. [ ] Set `PUBLIC_API_BASE_URL` to your **public API** origin if it differs from `PUBLIC_APP_URL` (email links). [ ] Set `EMAIL_UNSUBSCRIBE_SECRET` (or rely on `JWT_SECRET`) in prod. |
| **P4-03** | Twilio | Inbound webhooks / STOP-HELP where SMS is used; signature when inbound URL set | [ ] **Prod** number(s). [ ] Inbound **URL** in Twilio **matches exactly** the value in env (no trailing slash mismatch). [ ] Do not log full message bodies in prod. |
| **P4-04** | Stripe Billing (practice SaaS) | Practice Checkout / Portal + `POST /api/stripe/webhook`; Admin shows keys present | [ ] **Separate** test vs **live** keys. [ ] Live webhook secret for prod URL (Billing events). [ ] Confirm `/billing` Checkout + Portal on staging with test keys, then cut over. [ ] Disclose platform subscription fees in practice onboarding. |
| **P4-05** | Vapi | `POST /api/vapi/webhook` with secret + idempotency | [ ] Vapi custom credential matches `VAPI_WEBHOOK_SECRET`. [ ] Rotate: update both sides; see [SECRETS-GO-LIVE.md](SECRETS-GO-LIVE.md) and [CREDENTIAL-ROTATION-PILOT.md](CREDENTIAL-ROTATION-PILOT.md). |
| **P4-06** | Secrets | [SECRETS-GO-LIVE.md](SECRETS-GO-LIVE.md), [CREDENTIAL-ROTATION-PILOT.md](CREDENTIAL-ROTATION-PILOT.md) | [ ] All secrets in **host** vars. [ ] **Break-glass** and rotation documented. [ ] No secrets in repo. |
| **P4-07** | PMS (AbelDent / Dentrix) | Per [PMS-INTEGRATION-PLAN.md](../product/PMS-INTEGRATION-PLAN.md) | [ ] Program decision: whether a connector spike is in scope for your release and what “done” means (time-box, read path vs file drop, etc.). CSV-first is the default onboarding path. |
| **P4-08** | Degraded third parties | 2-attempt send retry where applicable, Admin **Integrations** status | [ ] Deeper **queue** + idempotent send pipeline when scale requires (Phase 6/8). [ ] Watch provider status pages. |

**Admin:** open **Admin → Integrations (go-live)**. Green configuration does not replace legal or DNS; it is a preflight of env for the logged-in practice.

**Deploy:** run `npx prisma migrate deploy` after pull.

---

## P4-04 operator checklist — Stripe tier prices + minute enforcement

The sellable catalog is exactly `src/billing/tiers.ts`: **core $799 / 1,200 min**, **growth $1,999 / 2,800 min**, **scale $2,499 / 4,000 min** (trial: $0 / 500 min / 50 min-day / 30 days, hard stop). Steps, in order:

1. In Stripe (test mode first), create three recurring monthly Prices — one per tier — and set on the host:
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_PRICE_CORE`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_SCALE`
   - optional metered overage prices: `STRIPE_OVERAGE_PRICE_CORE|GROWTH|SCALE`
2. Point the webhook at `https://<API_HOST>/api/stripe/webhook` with events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`.
3. For any pilot practice that should call without Stripe, add its id to `BILLING_SKIP_PRACTICE_IDS` **before** step 4.
4. Set `SUBSCRIPTION_ENFORCE=1`. From this point the call gate **fails closed**: a paid-tier practice with a missing price env, a subscription price that maps to a different tier, or a non-active subscription cannot dial (`BILLING_MISCONFIGURED` / `SUBSCRIPTION_CANCELED` in logs).
5. Verify on staging: sign up a fresh practice (gets trial: 500 min / 50 daily / 30 days) → `/billing` → choose Core → Stripe test Checkout → webhook sets `practice.billingTier='core'` → Admin → Practices shows the tier and minutes → burn/simulate past the limit → calling pauses (`overage_pending`) and the owner banner shows the confirm-overage CTA (offer expires after 24 h).

Legacy envs (`STRIPE_PRACTICE_STARTER|PROFESSIONAL|ENTERPRISE_PRICE_ID`, `STRIPE_PRACTICE_SUBSCRIPTION_PRICE_ID`) still work as aliases for core/growth/scale/core respectively; claim-count limits and `SUBSCRIPTION_PLAN_CONFIG` are retired — minutes are the meter.

## Public `/download` (desktop connector)

`/download` lists installers via the server proxy (`/api/desktop/releases`). It requires `GITHUB_RELEASES_TOKEN` (a GitHub token with **Contents: read** on `GetCollectRx/Collect-RX`) on the API host; optionally `DESKTOP_RELEASE_TAG` (default `v1.0.0-pilot`). Without the token the page stays up with an honest "downloads require server configuration" notice and CSV/support alternatives — no broken links. CSV-onboarded practices never need the desktop app.
