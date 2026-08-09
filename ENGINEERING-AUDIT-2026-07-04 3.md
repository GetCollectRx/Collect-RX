# CollectRx — engineering execution report (2026-07-04)

Companion to `CLIENT-READINESS-CHECKLIST.md`. This ran the 12-item engineering prompt at the bottom of that file, unattended, against the repo at `Collect-RX-main/`. Legal/business items were out of scope and untouched.

**Read this first section before the item-by-item tally below — it changes what several items mean.**

## Headline finding: the checklist's premise is partially stale

`CLIENT-READINESS-CHECKLIST.md` was compiled from `OUTSTANDING-FIXES-PRODUCT-READY.md`, `PHASE4-GO-LIVE.md`, and the **first** Prisma migration. It was not checked against the **current** `schema.prisma` or the current route implementations. Between those docs being written and today, migration `20260622021926_fix_schema_drift_post_patient_layer_removal` dropped the `Balance`, `BalanceState`, `OutreachEvent`, `Patient`, `PatientBalance`, `PaymentEvent`, and `StripeConnectAccount` tables outright, and `src/server/routes/stripeApiRoutes.ts` now says, verbatim:

> "Stripe Connect (patient payment collection) has been removed — CollectRx is a Practice → Insurance carrier recovery product." / "Stripe Connect (patient payment collection) is permanently removed."

The Connect router now returns HTTP 410 for every call. This is a deliberate, documented pivot (not accidental drift), away from *patient-facing balance reminders + Stripe pay links* toward *practice → insurance-carrier claim recovery*. Concretely, as of today:

- There is **no** patient SMS/email reminder pipeline in the code (`sendEmailWithRetry`, `sendSMSWithRetry`, `recordReminderSent`, `/api/twilio/sms` — none exist). SendGrid's webhook is wired for **prospect/marketing engagement only** (sales outreach to prospective practices), not patient balance reminders.
- There is **no** patient-facing pay link flow (no `Pay` page, no `paymentLink` route).
- Stripe now touches only **platform billing** (CollectRx charging the practice a subscription via Stripe Billing) — a much narrower live-key switch than "Connect onboarding."
- The UI has no `Balances`/`Pay` pages; the closest analogs are `InsuranceClaims.tsx` / `InsuranceClaimDetail.tsx` / `WorkQueue.tsx`.

**Implication:** treat Tier 1 item #2 in the original checklist ("complete Connect onboarding, confirm charges enabled") as **moot for patient payments** and re-scope to "switch `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` to live for the practice subscription-billing flow only" (see item 2 below). The Twilio/SendGrid items in #1 also need re-reading in that light.

---

## Item-by-item tally

### 1. Webhook/callback URLs → Fly vs Railway — **partially done, one real bug found, rest blocked on dashboard access**

- Server-side webhook receivers (`/api/webhooks/sendgrid`, `/api/vapi/webhook`, `/api/webhooks/stripe`) are all environment-driven and host-agnostic — they don't care what URL called them, only that the secret matches. No Railway hardcoding found there.
- **Found and fixed:** `src/lib/resolveApiUrl.ts` had a stale comment claiming the SPA "defaults to the Railway app URL" when `collectrx.ca` is the host. The actual constant was already correct (`https://www.collectrx.ca`) — only the comment was wrong, which is exactly the kind of doc-drift that causes false alarms like this one. Fixed the comment.
- **Found, not fixed — needs your decision:** `Collect-RX-main/desktop/services/abeldent-sync.js` is a real, working Electron desktop connector that reads AbelDent's on-prem SQL Server via Windows Integrated Auth and POSTs to `RAILWAY_API_URL`/`RAILWAY_API_TOKEN` at endpoints `/api/insurance/claims/import`, `/api/patients/balances`, and `/api/work-queue/sync`. **None of those three endpoints exist in the current backend** (grep confirms zero matches) — they were removed in the same schema-drift migration. If any practice has this Electron app installed and pointed at the old Railway URL, its sync has been silently failing since the Railway decommission, and even if repointed to Fly, it will 404 against the removed endpoints. See item 11 for the reframed fix.
- **Blocked — dashboard access I don't have from this sandbox (no credentials, egress proxy blocks direct API calls to fly.io/twilio/sendgrid/stripe/vapi):**
  - **Twilio:** open Console → Phone Numbers → your number → Messaging → "A message comes in." As found, `/api/twilio/sms` doesn't exist in the current code at all (stale comment only, no route, no handler file). If this webhook is still configured in Twilio pointing anywhere, it's calling a dead endpoint — decide whether to remove the webhook or whether inbound SMS is coming back.
  - **SendGrid:** Settings → Mail Settings → Event Webhook. Confirm the URL is `https://collect-rx.fly.dev/api/webhooks/sendgrid` (or your custom domain) and paste back the configured URL + whether `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY` is set as a Fly secret.
  - **Stripe:** Dashboard → Developers → Webhooks. Confirm endpoint is `https://collect-rx.fly.dev/api/webhooks/stripe`, live mode.
  - **Vapi:** dashboard → your assistant's server URL / custom credential, matches `VAPI_WEBHOOK_SECRET` on Fly.

### 2. Stripe test → live keys — **re-scoped; walkthrough only, cannot execute**

Since Connect is permanently removed, this is now just a platform-billing key switch:

1. Stripe Dashboard (live mode toggle top-right) → Developers → API keys → copy `sk_live_...`.
2. `fly secrets set STRIPE_SECRET_KEY=sk_live_... --app collect-rx`
3. Developers → Webhooks → add endpoint `https://collect-rx.fly.dev/api/webhooks/stripe` (live mode) → copy signing secret → `fly secrets set STRIPE_WEBHOOK_SECRET=whsec_... --app collect-rx`
4. `Admin → Integrations` in the app reads `STRIPE_SECRET_KEY` and reports `testMode: sk.startsWith('sk_test_')` — after the switch it should read `false`.
5. Ignore any Connect-onboarding / "charges enabled" language in `PHASE4-GO-LIVE.md` — that's stale; `adminRoutes.ts` line 48-52 hardcodes `stripeConnect: { account: false, onboardingComplete: false, chargesEnabled: false }` unconditionally now (dead code left over from the removed feature, not a real status check). Worth deleting that stub in a follow-up cleanup so it doesn't mislead whoever reads Admin next.

Could not execute — no Stripe dashboard access from this sandbox.

### 3. SPF/DKIM/DMARC — **checked directly via public DNS; found two real problems**

I don't have SendGrid dashboard access, but SPF/DMARC are public DNS records, so I queried them directly (Google & Cloudflare DoH, cross-checked):

- **SPF is broken.** `collectrx.ca` TXT: `v=spf1 include:dc-aa8e722993._spfm.collectrx.ca ~all`. The include target `dc-aa8e722993._spfm.collectrx.ca` returns **NXDOMAIN**. An SPF include that resolves to nothing typically produces a `permerror` on receiving mail servers, which many providers treat as an SPF fail. This needs fixing regardless of SendGrid dashboard status.
- **DMARC is not actually published.** `_dmarc.collectrx.ca` TXT exists but its *value* is literally the string `_dmarc.collectrx.ca` — not valid DMARC syntax (no `v=DMARC1;`). Functionally, this domain has no working DMARC policy today.
- Could not locate a SendGrid DKIM CNAME under the common selector names (`s1._domainkey`, `s2._domainkey`) — could be a different selector; only the SendGrid dashboard (Settings → Sender Authentication) will show the exact selector names it issued.

**Action for you:** fix the SPF include (either point it at whatever actually issued that subdomain, or replace with the correct SendGrid include, typically `include:sendgrid.net` if using shared IPs), and publish a real DMARC record (start with `v=DMARC1; p=none; rua=mailto:<address>;` to monitor before enforcing). Then confirm the Event Webhook verification key in SendGrid → Webhooks per item 1.

### 4. Postgres encryption at rest — **cannot connect directly; here's the exact check**

Confirmed via `migrate-to-fly.sh` (in your Dentist folder) that the DB is **classic/unmanaged Fly Postgres** (`fly postgres create --name collect-rx-db --region yyz ...`), not Fly's newer Managed Postgres product — the distinction matters because MPG bundles encryption automatically, while classic Fly Postgres relies on **Fly Volume encryption**, which Fly's docs confirm is **on by default** (LUKS-based) unless a volume was explicitly created with `--no-encryption`. The migration script didn't pass that flag, so it should be encrypted, but "should be" isn't a documented control — run:

```
fly volumes list --app collect-rx-db
```

and confirm the `Encrypted` column reads `true` for the attached volume. Paste that back and I'll draft the one-paragraph audit-documentation language citing it.

### 5. Secrets audit/rotation — **runbook only, cannot execute (no Fly auth in this sandbox)**

```
fly secrets list --app collect-rx
```
Compare against `Collect-RX-main/docs/operations/SECRETS-GO-LIVE.md`'s list (`DATABASE_URL`, `JWT_SECRET`, `SENDGRID_API_KEY`, `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN`, `VAPI_WEBHOOK_SECRET`, `ADMIN_API_KEY`). For anything you're not certain was regenerated (rather than copied verbatim by `migrate-to-fly.sh` from Railway, which is exactly what Step 7 of that script does — it copies Railway's values as-is), rotate at the provider first, then `fly secrets set KEY=newvalue --app collect-rx`, then confirm the app still boots (`fly logs --app collect-rx`).

**Note:** `migrate-to-fly.sh`'s Step 7 explicitly bulk-copies every non-Railway-internal variable from Railway to Fly unchanged. That means, by design, nothing was rotated during the migration — everything currently on Fly is whatever was on Railway. If any of those values were ever exposed (screenshots, tickets, a departed contractor), they are still live today and should be rotated regardless of the Railway/Fly question.

### 6. DB backups + restore test — **runbook only**

Classic Fly Postgres gets **daily block-level volume snapshots**, 5-day retention by default (configurable 1–60 days) — these are crash-consistent (Postgres replays WAL on restore same as recovering from a power loss) but Fly explicitly documents them as not a substitute for your own backup plan. Recommended:
1. Confirm/extend snapshot retention: `fly volumes list --app collect-rx-db` → note the volume ID → check/set retention via `fly volumes update <vol-id> --snapshot-retention 30` (adjust to your RPO).
2. Add an independent logical backup (`pg_dump`) on a schedule outside Fly's snapshot system — e.g., a scheduled GitHub Action or a `fly machine run` cron hitting `collect-rx-db.flycast` — so you have a portable, provider-independent copy.
3. Test a restore: `fly volumes snapshots list <vol-id>`, then `fly volumes create --snapshot-id <snap-id> ...` into a throwaway app, attach, and verify `psql` queries return expected rows. Document the wall-clock time — that's your measured RTO.

### 7. Uptime monitoring + Sentry — **env-driven, no code issue found; verify values**

Both are entirely env-var gated (`SENTRY_DSN` server-side in `src/server/observability/sentryNode.ts`, `VITE_SENTRY_DSN` client-side in `src/sentryClient.ts`) — no Railway hardcoding. Run `fly secrets list --app collect-rx | grep -i sentry` (values are redacted by `fly secrets list`, but presence/absence and last-set date are visible) to confirm it's set, and open your Sentry project to confirm events are actually arriving from the Fly deployment (a stale project could be silently receiving zero events post-migration and you'd never notice). For uptime monitoring, whatever external service you use (Pingdom/UptimeRobot/etc.) — confirm the monitored URL is `collect-rx.fly.dev` or `www.collectrx.ca`, not a `*.railway.app` URL.

### 8. Staging environment — **confirmed: none exists on Fly today**

No second `fly.toml`, no staging app reference, anywhere in the repo. `docs/DATABASE.md`'s "Staging / production" section is generic ("use a hosted Postgres") and doesn't name a Fly staging app. If you want one: `fly apps create collect-rx-staging`, a second Postgres (`fly postgres create --name collect-rx-staging-db`), copy the fly.toml with `app = 'collect-rx-staging'`, and seed it with synthetic data per `ENVIRONMENT-MATRIX.md` — not production data, given PHIPA scope.

### 9. `Balance.source` DEFAULT 'DENTRIX_SYNC' migration — **moot, closing without changes**

The `Balance` table (and the `lastDentrixSyncAt` column on it) no longer exists — it was dropped in full on 2026-06-22, three weeks before this checklist was written. There is nothing to migrate. No PMS-name defaults exist anywhere in the current `schema.prisma` that I could find (checked all 60 current model definitions). No action needed; the original Tier 2 item was based on the outdated first-migration file rather than current schema state.

### 10. `docs/adr/` folder — **was never actually missing; checklist was wrong**

`docs/adr/0001-primary-application-stack.md` and `docs/adr/0002-background-jobs-bullmq-redis.md` both exist, committed 2026-04-25 in `0a4398c` ("Platform monorepo"), and are still there today. Likely explanation for the false alarm: the repo is a monorepo where `docs/` lives at the repo root and `Collect-RX-main/` is a subfolder — someone (or a prior audit) probably looked for `docs/adr` *inside* `Collect-RX-main/` (where it indeed doesn't exist) rather than at the repo root, where `fly.toml`'s comment correctly points via a relative path. No action needed.

### 11. AbelDent connector spike scoping — **re-scoped: a connector already exists, it's just orphaned**

The original ask assumed nothing existed but a plan doc. That's wrong — `desktop/services/abeldent-sync.js` is a complete, real implementation: an Electron `utilityProcess` that connects to on-prem AbelDent via `mssql`/`msnodesqlv8` with Windows Integrated Auth, queries claims and patient-ledger balances (via a configurable `schema-map.json` for site-specific column names), and pushes them to the backend on a 15-minute interval. The actual gap isn't "build a connector" — it's:

1. **The three endpoints it posts to don't exist anymore** (`/api/insurance/claims/import`, `/api/patients/balances`, `/api/work-queue/sync`) — orphaned by the same product pivot as everything else here.
2. **There's already a *different*, current PMS ingestion path**: `POST /api/admin/sync/import/:pmsVendor` (multipart file upload, tracked in the `PmsImportRun` table, mounted at `/api/admin/sync` in `src/server/index.ts`). This looks like exactly the "Phase 2: file drop, same CSV contract" step in `PMS-INTEGRATION-PLAN.md` — except it's already built and shipped, which the plan doc (last touched before the pivot) doesn't reflect.

**Real scoping question for you, with much better numbers than "build a connector from scratch":** the live SQL Server read path already exists and already produces the right shape of data (claims + patient ledger rows) — the missing piece is a thin adapter layer that takes `abeldent-sync.js`'s query output and calls the *current* `/api/admin/sync/import/abeldent` endpoint (or a small new authenticated JSON variant of it) instead of the three dead endpoints. Rough sizing: this is a re-plumbing job (change ~2 function calls' worth of endpoint/payload shape), not a new integration — likely 0.5–2 days, not the multi-week "Phase 3 vendor spike" the plan doc implies, *provided* the on-prem schema-map discovery (`discover-schema.cjs`, `schema-map.example.json`) is still accurate for a live client's AbelDent instance, which you'd want to test against that specific practice's DB before committing to a timeline.

### 12. k6 load test + accessibility pass — **k6 not runnable from this sandbox; accessibility pass done on what exists**

- **Load test:** this sandbox's outbound network is fully proxy-blocked for raw sockets/curl (confirmed: every `curl` to any host, including `google.com`, returns `403 from proxy after CONNECT`), and `k6` isn't installed. I *can* reach the live app through a single-request fetch tool (confirmed `GET https://collect-rx.fly.dev/api/health` returns `200 {"status":"ok",...}` right now), but that's one request, not the concurrent-ramp load pattern `perf/k6-read-heavy.js` needs. Run it yourself: `BASE_URL=https://collect-rx.fly.dev k6 run Collect-RX-main/perf/k6-read-heavy.js` and share the p95/error-rate output — I can interpret it against the script's own thresholds (`p95<800ms`, `error rate<1%`).
- **Accessibility:** the original ask named "login, balances, and pay" flows — balances/pay pages don't exist anymore (see headline finding), so I reviewed `LoginPage.tsx` (the flow that does exist) by reading the code directly, since I don't have live browser access to run axe-core/Lighthouse from here. Found: the two secondary sign-in forms ("Auditor / billing ops / platform admin" and "Platform developer") have `<input>` fields with **no associated `<label>`**, relying on `placeholder` text only ("ops@collectrx.ca", "Password") — a WCAG 2.1 A failure (SC 1.3.1/4.1.2/3.3.2 pattern, commonly cited as failure F68). The primary practice-login form does this correctly (`htmlFor`/`id` pairs on both fields). Fix: add visually-hideable `<label>` elements to the two secondary forms, matching the primary form's pattern. This is a real, low-risk, quick fix — happy to make it if you want it done now rather than queued.

---

## Safe changes made in this pass

- `Collect-RX-main/src/lib/resolveApiUrl.ts` — corrected a stale code comment claiming a Railway fallback URL that no longer matches the actual (already-correct) constant. No behavior change.
- Did **not** delete `Collect-RX-main/fly 2.toml` (a dead duplicate of `fly.toml` from an earlier "fix duplicated fly.toml" commit, unreferenced anywhere) — it's in your protected workspace folder and deletion needs your explicit go-ahead. Recommend: `rm "Collect-RX-main/fly 2.toml"`.

## Recommended follow-up cleanup (not urgent, flagging per "treat omission as risk")

- `adminRoutes.ts`'s hardcoded `stripeConnect: { account: false, ... }` stub (item 2) should be deleted, not just ignored — it will confuse the next person who reads Admin and assumes it reflects real state.
- `docs/DATABASE.md`, `PHASE4-GO-LIVE.md`, `PHASE4-INTEGRATIONS.md`, `SECRETS-GO-LIVE.md`, and `PMS-INTEGRATION-PLAN.md` all still describe Railway as the live host and/or the pre-pivot patient-balance product. Given how much of this audit was "checklist said X, code says Y," these are worth a documentation pass so the next audit (human or agent) doesn't have to re-derive all of this from git archaeology again.
