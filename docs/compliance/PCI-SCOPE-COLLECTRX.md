# PCI scope (CollectRx) — P5-09

- **CHD in CollectRx:** none — card numbers are entered on **Stripe** (Payment Link / hosted checkout), not in app forms bound to this codebase.
- **SAD/CVC in CollectRx:** none.
- **Secrets:** `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` are in scope for protection (env, rotation); they do not by themselves make you SAQ A if you only use redirect/hosted fields — confirm with your **QSA or acquirer** for your specific Stripe integration.

Deeper BAA/PCI context: [PCI-BAA-STRIPE.md](PCI-BAA-STRIPE.md).
