# PHI and outbound data (CollectRx)

**Project root:** `/Users/khalidegeh/Desktop/Dentist/collectrx-platform`  
Implementation details for the **Click** app live under your `Click-main` / git `Click` repo; this document is the program-level reference.

This document enumerates **where PHI lives** and what may leave the system to **third parties** (email, SMS, payment processors).  
Vapi/IVR: when integrated, **only opaque tokens** (e.g. `patientToken`, internal IDs) go to those systems—no names, DOB, or clinical detail in third-party bodies.

## Data stores (at rest) — Click app (Prisma)

| Store | Contents (summary) | Classification |
|-------|----------------------|----------------|
| `Patient`, `Balance`, `BalanceState`, `OutreachEvent`, `PaymentEvent` | Display names, contact fields, amounts, stages | PHI / sensitive operational |
| `PatientBalance`, `PatientBenefits`, `BenefitCoverage`, `PlanYear` | Names, contact, clinical/financial fields for AR and estimates | PHI |
| `StripeConnectAccount` | Practice Stripe account ids | Not patient PHI; sensitive |
| `WebhookEvent` | Stripe event ids | Not PHI |

## Outbound to third parties

### SendGrid (email)

**Allowed in message body:** first name, formatted dollar amount, non-identifying visit framing, optional payment URL, static boilerplate.  
**Not allowed:** last name, full address, health card, claim id, member id, DOB, clinical detail in free text.

### Twilio (SMS)

**Allowed:** first name, formatted amount, payment link (optional), static boilerplate.  
`to` is the patient phone; do not log full phone in production logs.

### Stripe (Connect / Payment Links)

**Allowlisted metadata:** `balance_id`, `practice_id`, `patient_token` only.  
**Not allowed:** name, email, phone, health data in metadata.

### Stripe webhooks

- **Endpoint:** `POST /api/stripe/webhook` (raw body; signature required).
- **Replay / idempotency:** see implementation in the Click server (`STRIPE_WEBHOOK_MAX_AGE_SECONDS`, `WebhookEvent`).

## Logging

- Do not log full contact strings, full names, or message bodies at `info` in production.
- Prefer internal ids and status codes.

## Review

Re-review when adding a new integration or a new field to outbound calls.
