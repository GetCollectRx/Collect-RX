# PCI scope, Stripe, and BAA (orientation)

**Not legal advice.** Use this with your own counsel / compliance.

## Card data

- **Patient payments** in CollectRx are intended to flow through **Stripe** (Connect / Payment Links). Card numbers and CVC are **not** stored in the CollectRx database.
- **PCI scope:** Favor **Stripe-hosted** payment surfaces; keep secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) in a vault or environment manager, never in git.

## BAA (HIPAA)

- A **BAA** is generally required with vendors that create, receive, maintain, or transmit **PHI on your behalf** (a “business associate”).
- **Stripe:** Confirm whether you need Stripe’s BAA and whether your usage (e.g. metadata, descriptors) **minimizes** PHI. CollectRx is designed to avoid sending names/DOB/health data to Stripe **in metadata** for payment links.

## Vapi (voice/telephony)

- If transcripts or recordings contain **PHI**, the voice vendor is typically in scope as a business associate. Document data flow, retention, and DPA/BAA in your environment matrix.

## Checklist (operator)

- [ ] BAA with hosting/DB (e.g. Railway) where PHI is stored.  
- [ ] Stripe: BAA or confirmation PHI is not processed per your config.  
- [ ] Vapi/telephony: BAA or equivalent if PHI in calls.  
- [ ] `npm audit` and dependency updates tracked ([NPM-AUDIT.md](../NPM-AUDIT.md)).
