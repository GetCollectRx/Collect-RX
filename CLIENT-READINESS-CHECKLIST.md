# CollectRx — client-readiness checklist

Compiled 2026-07-04 from the repo's own planning docs (`OUTSTANDING-FIXES-PRODUCT-READY.md`, `docs/operations/PHASE4-GO-LIVE.md`, `docs/compliance/PHASE5-COMPLIANCE.md`, `docs/product/MVP-SCOPE.md`) plus a fresh read of `git log`, `fly.toml`, and the Prisma migrations, so this reflects what is actually true today, not what the docs claimed in April.

## Already done (context, not action items)

- Multi-tenant queue engine + static `X-Api-Key` auth on all admin/data routes (PR #24), merged and confirmed live in production on Fly.
- DNS and TLS fully cut over to Fly (`collect-rx.fly.dev` and `www.collectrx.ca`); Railway fully decommissioned.
- CI runs typecheck, lint, tests, build, and Semgrep SAST on every PR.
- Stripe test-mode payment flow, idempotent webhook handling, tokenized public pay links, CSV import with idempotency, and an append-only audit log are implemented in code (Appendix C of `OUTSTANDING-FIXES-PRODUCT-READY.md` marks 19/19 Phase 3 items done).
- README's Dentrix-as-default-PMS wording fixed today.

The engineering backlog in the repo's own tracker is mostly marked complete. The real gate to being client-ready is the **operator and legal work that was never executed**, plus a few things that changed underneath the docs when hosting moved from Railway to Fly.

---

## Tier 1 — Blocking before a real client with real PHI goes live

1. **[Engineering] Reconfirm every third-party webhook/callback URL points at the new Fly host, not Railway.** SendGrid Event Webhook, Twilio inbound SMS URL, Stripe webhook endpoint, Vapi webhook — these were configured against the old Railway URL and have not been explicitly re-verified since the cutover. This is a direct, easy-to-miss consequence of the migration you just finished.
2. **[Engineering] Switch Stripe from test to live keys.** Complete Connect onboarding for the practice and confirm "charges enabled" in Admin (P4-04). Disclosing platform fees in the practice onboarding flow is a business/legal call, not covered here.
3. **[Engineering] Verify SPF/DKIM/DMARC** on the sending domain and wire the SendGrid bounce/complaint Event Webhook with the verification key (P4-01) — otherwise reminder emails risk landing in spam or bouncing silently.
4. **[Engineering spike / Business decision] PMS integration scope for this specific client.** Only a plan document exists (`PMS-INTEGRATION-PLAN.md`); there is no working AbelDent or Dentrix connector. The engineering piece — a time-boxed spike to prove a read path or file-drop connector — can be done independently. Whether CSV import is contractually acceptable for v1 vs. a live connector being required is Khalid's call, not an engineering one.
5. **[Legal/Business — Khalid handling separately] Get BAAs/DPAs actually signed** with every vendor touching PHI: hosting (Fly), SendGrid, Twilio, Stripe, Vapi, and your backup vendor (P5-05).
6. **[Legal/Business — Khalid handling separately] Run an actual HIPAA gap review** (P5-06), and if serving Canadian patients, the PIPEDA/provincial review (P5-07).
7. **[Legal/Business — Khalid handling separately] Counsel sign-off on collections message content** — frequency, hours, disclosures, unsubscribe (P5-08).
8. **[Legal/Business — Khalid handling separately] Schedule and complete a pen test** before handling real PHI at any real volume (P5-11).
9. **[Engineering] Confirm encryption at rest on the production Postgres instance on Fly** and document it for audit purposes (P5-02) — this is a different hosting provider than when this was last checked, so it needs re-confirming, not assuming.
10. **[Engineering] Rotate and audit all production secrets** to confirm none are stale from the Railway era — `ADMIN_API_KEY`, `JWT_SECRET`, and the SendGrid/Twilio/Stripe/Vapi keys and webhook secrets, per `SECRETS-GO-LIVE.md`.

## Tier 2 — Should fix before or shortly after go-live

- **Database backups with a tested restore** on the Fly Postgres instance, with RPO/RTO documented (P6-05). The Railway→Fly migration likely reset whatever backup schedule existed before.
- **Uptime monitoring and alerting** pointed at the new Fly host (P6-04) — old monitoring may be watching a URL that no longer serves traffic.
- **Error tracking (Sentry) DSN confirmed set** on the Fly deployment specifically, not assumed carried over from Railway env vars (P6-02).
- **Staging environment exists and matches prod shape on Fly** (P6-08) — the staging setup described in the docs predates the Fly migration and should be re-verified, not assumed.
- **Schema-level PMS default:** `Balance.source` in the very first migration (`Collect-RX-main/prisma/migrations/20260422120000_init/migration.sql`) still hardcodes `DEFAULT 'DENTRIX_SYNC'`. Nothing currently depends on this being accurate, but it should be fixed via a follow-up migration before onboarding a non-Dentrix practice if that column is ever surfaced or relied on.
- **Broader Dentrix-wording sweep:** other docs (`MVP-SCOPE.md`, `PMS-INTEGRATION-PLAN.md`, `ENVIRONMENT-MATRIX.md`, `DEMO_GUIDE.md`) still use "e.g. Dentrix" as the illustrative PMS. Already hedged, so low urgency — worth a pass only if these docs are ever shown to a client directly.
- **Missing ADR folder:** `fly.toml` and `OUTSTANDING-FIXES-PRODUCT-READY.md` both reference `docs/adr/0001-primary-application-stack.md` and `docs/adr/0002-background-jobs-bullmq-redis.md`, but no `docs/adr/` folder exists in the repo. Either these were never committed or were lost — worth tracking down or recreating, since they're cited as the record of the "canonical stack" decision.

## Tier 3 — Polish, can wait

- Load testing (P7-05/06) — a sample k6 script exists but has not been run against the new Fly host.
- Accessibility pass on critical flows (P7-07) — status unclear following UI changes since April.
- **[Legal — Khalid handling separately]** Legal Terms/Privacy/cookie banner are implemented in-app but are explicitly flagged in the repo as "template" copy — confirm counsel has reviewed the actual text before treating it as final for a real client contract.

---

## Prompt for a new session (engineering only)

Legal/business items (Tier 1 #5–8, and the legal-copy item in Tier 3) are being handled by Khalid separately and are deliberately excluded below. Copy the block into a fresh Claude Code session opened at the repo root (`/Users/khalidegeh/Desktop/Dentist/Collect-RX`).

```
I'm getting CollectRx (canonical app in Collect-RX-main/) ready to onboard a real paying dental
practice with real patient data. Hosting just moved from Railway to Fly.io (app "collect-rx",
region yyz; custom domain www.collectrx.ca). Read CLIENT-READINESS-CHECKLIST.md at the repo root
first for full context — it's a verified list of what's outstanding. I am handling the
legal/business items (BAAs, HIPAA/PIPEDA review, counsel sign-off, pen test, legal copy review)
myself, separately. Do not touch those. Your scope is engineering only.

Work through these in order and give me a running tally (done / verified / blocked) as you go,
not a single dump at the end:

1. Reconfirm every third-party webhook/callback URL points at the new Fly host, not the old
   Railway one: SendGrid Event Webhook, Twilio inbound SMS URL, Stripe webhook endpoint, Vapi
   webhook. For each, tell me exactly what to check in that provider's dashboard and what to
   paste back so you can verify it — don't guess at what's configured.
2. Walk me through switching Stripe from test to live keys and confirming "charges enabled" in
   Admin for the practice's Connect account.
3. Verify SPF/DKIM/DMARC on the sending domain and confirm the SendGrid bounce/complaint Event
   Webhook is wired with the correct verification key.
4. Confirm encryption at rest on the production Postgres instance on Fly (this is a different
   host than when this was last checked) and tell me how to document it for an audit trail.
5. Audit all production secrets for staleness from the Railway era — ADMIN_API_KEY, JWT_SECRET,
   and the SendGrid/Twilio/Stripe/Vapi keys and webhook secrets — per SECRETS-GO-LIVE.md, and
   rotate anything that looks carried over incorrectly.
6. Set up database backups with a tested restore on the Fly Postgres instance; document RPO/RTO.
7. Confirm uptime monitoring/alerting and the Sentry error-tracking DSN are both correctly pointed
   at the new Fly host, not a stale Railway config.
8. Confirm whether a staging environment exists on Fly and matches prod shape; if not, tell me
   what's needed to stand one up.
9. Write a follow-up Prisma migration to fix the hardcoded `DEFAULT 'DENTRIX_SYNC'` on
   `Balance.source` in the initial migration, replacing it with a neutral default consistent with
   the PMS-agnostic design elsewhere in the codebase.
10. Find or reconstruct the docs/adr/ folder referenced by fly.toml and
    OUTSTANDING-FIXES-PRODUCT-READY.md (ADR 0001, ADR 0002) — it doesn't exist in the repo. Check
    git history first for whether it was ever committed and got deleted before writing new ones
    from scratch.
11. As a time-boxed spike (not a full build), assess what a minimal AbelDent read-path or
    file-drop connector would take, so I have real numbers when I decide the PMS integration scope
    for this client. Don't build it — just scope it.
12. Run the existing k6 load test script against the new Fly host and report p95 latency and
    error rate. Do a quick accessibility pass on login, balances, and pay flows and report WCAG
    2.1 A issues found.

This is healthcare-adjacent data (PHIPA scope) — apply extra scrutiny to anything touching
secrets, auth, or PHI exposure. Flag anything that looks like it weakens a control rather than
just fixing it, and stop to ask me before changing anything security-relevant if you're not
certain it's safe.
```
