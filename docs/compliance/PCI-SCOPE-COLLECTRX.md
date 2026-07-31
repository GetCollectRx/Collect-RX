# PCI scope (CollectRx) — P5-09

- **CHD in CollectRx:** none — card numbers for the **practice SaaS subscription** are entered on **Stripe-hosted Checkout / Customer Portal**, not in CollectRx forms.
- **Patient/client payments:** out of product scope (no Connect, no patient Payment Links).
- **SAD/CVC in CollectRx:** none.
- **Secrets:** `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` are in scope for protection (env, rotation); they do not by themselves make you SAQ A if you only use redirect/hosted fields — confirm with your **QSA or acquirer** for your specific Stripe Billing integration.

Deeper BAA/PCI context: [PCI-BAA-STRIPE.md](PCI-BAA-STRIPE.md).
