# PHI and outbound data (CollectRx)

**Project root:** `/Users/khalidegeh/Desktop/Dentist/collectrx-platform`  
Implementation details for the **Click** app live under your `Click-main` / git `Click` repo; this document is the program-level reference.

This document enumerates **where PHI lives** and what may leave the system to **third parties** (email, SMS, Stripe Billing, voice).  
Vapi/IVR: **only opaque tokens** (e.g. `patientToken`, internal IDs) go to those systems—no names, DOB, or clinical detail in third-party metadata. Patient/client payment collection is **out of product scope**.

## Data stores (at rest) — Collect-RX-main (Prisma)

| Store | Contents (summary) | Classification |
|-------|----------------------|----------------|
| Claims / insurance AR models, eligibility logs | Claim + patient identifiers for carrier recovery | PHI / sensitive operational |
| Practice subscription / Stripe customer ids | Practice billing identifiers | Not patient PHI; sensitive |
| Processed Stripe / webhook event ids | Event ids for idempotency | Not PHI |

## Outbound to third parties

### SendGrid (email)

**Allowed:** operational/practice emails with minimal necessary content.  
**Not allowed:** dumping claim PHI, member ids, DOB, or clinical detail into marketing or unbounded free text.

### Twilio (SMS)

**Allowed:** staff escalation / operational SMS as configured.  
Do not log full phone numbers or message bodies in production logs.

### Stripe (practice SaaS Billing only)

**Purpose:** practice subscription Checkout / Customer Portal.  
**Not allowed:** patient names, DOB, health data, or client payment collection via Connect / Payment Links.

### Stripe webhooks

- **Endpoint:** `POST /api/stripe/webhook` (raw body; signature required).
- **Scope:** platform Billing subscription events only.

## Logging

- Do not log full contact strings, full names, or message bodies at `info` in production.
- Prefer internal ids and status codes.

## Review

Re-review when adding a new integration or a new field to outbound calls.
