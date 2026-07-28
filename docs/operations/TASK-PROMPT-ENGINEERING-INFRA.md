# Paste-ready prompt — Engineering audit infra follow-up (copy everything below the line)

---

Work in this repo's `Collect-RX-main/` workspace. First read `docs/audits/ENGINEERING-AUDIT-2026-07-04.md` in full — it explains a product pivot (patient-payment Stripe Connect was removed; CollectRx is now practice→carrier claim recovery only) that changes what several of its own checklist items mean. Most of its items were blocked in that audit only because the sandbox had no Fly/DNS/dashboard credentials — this session may have more access; use it, but don't fabricate results for anything you still can't reach.

**Already resolved since that audit was written — verify, don't redo:**
- Item 8 (staging environment): `fly.staging.toml`, `fly.staging-redis.toml`, and `.github/workflows/collectrx-staging-deploy.yml` all exist now. Your job here is to confirm it's actually live and working, not just template files sitting unused — see Task D.
- Items 9 and 10 (Balance.source migration, docs/adr folder): the audit already closed these with no action needed. Skip them.

**Still genuinely open:**

## Hard rules (stop conditions)
- Do NOT touch billing/Stripe live-key switching in this pass — that's a separate, higher-risk task requiring Khalid's direct sign-off at the moment of the switch, not something to bundle in here.
- Do NOT deploy to the production `collect-rx` app. Staging only, and only for verification (Task D), not new feature work.
- If you don't have credentials for a step (Fly CLI auth, DNS registrar, cloud provider dashboards), say exactly that and move to the next task — don't guess or claim success.
- Do not print secret values; `fly secrets list` output is already redacted, use it as-is.

## Task A — Fly volume encryption + backup/restore RTO
1. `fly volumes list --app collect-rx-db` — confirm the `Encrypted` column reads `true` for the attached volume. Report the literal output.
2. `fly volumes snapshots list <vol-id>` (use the volume ID from step 1), then restore the most recent snapshot into a throwaway app (`fly volumes create --snapshot-id <snap-id> ...`), attach it, and run a read-only query to confirm expected row counts. Time the whole restore wall-clock — that's your measured RTO. Tear down the throwaway app/volume when done.
3. Confirm/adjust snapshot retention: `fly volumes update <vol-id> --snapshot-retention <days>` if it's not already set to a deliberate value (the audit suggests 30 days as a starting point — confirm with Khalid before changing an existing explicit value, just set a sane default if none exists).
4. Document the measured RTO and the retention setting in `docs/audits/ENGINEERING-AUDIT-2026-07-04.md` under item 6, with today's date.

## Task B — Secrets rotation
1. `fly secrets list --app collect-rx` and cross-reference against the list in `docs/operations/SECRETS-GO-LIVE.md`.
2. The audit found that `migrate-to-fly.sh` bulk-copied every Railway env var to Fly **unrotated** during the migration. For each secret (`DATABASE_URL`, `JWT_SECRET`, `SENDGRID_API_KEY`, `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN`, `VAPI_WEBHOOK_SECRET`, `ADMIN_API_KEY`) that hasn't been regenerated since the Railway→Fly migration, regenerate it at the provider first, then `fly secrets set KEY=newvalue --app collect-rx`, then confirm the app still boots (`fly logs --app collect-rx`).
3. Report which secrets were rotated and which were left (with reason — e.g., "already rotated on `<date>`" or "needs Khalid to regenerate at provider, I don't have that dashboard access").

## Task C — SPF / DMARC DNS fix
1. Confirm the current broken state still exists: SPF `include:dc-aa8e722993._spfm.collectrx.ca` should resolve to NXDOMAIN (query via DoH if you don't have shell `dig`), and `_dmarc.collectrx.ca` TXT should be the literal invalid string `_dmarc.collectrx.ca` rather than valid `v=DMARC1; ...` syntax.
2. If you have DNS registrar/provider access: fix the SPF include (point it at whatever SendGrid actually issued — check SendGrid dashboard Settings → Sender Authentication for the real include value, typically `include:sendgrid.net` for shared IPs), and publish a real DMARC record starting with `v=DMARC1; p=none; rua=mailto:<an address Khalid names>;` (monitor-only, not enforcing, until confirmed clean).
3. If you don't have DNS access, report the exact records that need to change and where (registrar name if discoverable, otherwise ask Khalid which registrar manages `collectrx.ca`).

## Task D — confirm staging is actually live
1. Trigger the staging deploy workflow if it hasn't run recently, or check its last run status: staging deploy is via GitHub Actions (`collectrx-staging-deploy.yml`), not local `fly deploy` (local deploy is known-broken by clock drift per `docs/operations/HAIKU-TASK-PROMPT.md`).
2. `curl https://collect-rx-staging.fly.dev/api/health` (or whatever host the staging app resolves to) — confirm it answers 200.
3. Report pass/fail. If the workflow exists but has never actually been run, say so plainly rather than assuming it works.

## Task E — small doc/code cleanup (only if time remains, lowest priority)
1. `Collect-RX-main/CLAUDE.md` still describes the pre-pivot architecture (says "Railway", "PIIVault" layer) while the root `CLAUDE.md` describes the current one (Fly, `docs/compliance/PHI-VAPI-BOUNDARY.md`, ephemeral Vapi variables). This doc drift is exactly the kind of thing the engineering audit warns causes false alarms in future audits. Update `Collect-RX-main/CLAUDE.md` to match current reality, or if the whole file is now redundant with the root one, flag that to Khalid rather than deleting it yourself.
2. `src/server/routes/adminRoutes.ts` (in `Collect-RX-main`) hardcodes `stripeConnect: { account: false, onboardingComplete: false, chargesEnabled: false }` unconditionally — dead code left from the removed Stripe Connect patient-payment feature. Verify via `git log`/`grep` that Connect really is fully gone (matches the audit's own description of the pivot), then delete the stub rather than leave it misleading whoever reads Admin next.

## Final report format
One paragraph per task (A–E): what you found, what you changed, what's still blocked and on what credential/access. Nothing else.
