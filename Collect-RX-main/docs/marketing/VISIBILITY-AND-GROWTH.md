# CollectRx — Visibility & Growth Playbook

**Goal:** Make CollectRx **searchable, public, and unavoidable** for Canadian dental practices — including offices that do not yet know insurance AR follow-up is automatable.

**Status:** Site live at [collectrx.ca](https://www.collectrx.ca). Marketing agent stack built (`/admin/partnerships`). This doc is the operating plan to turn both on at scale.

---

## The two engines (run in parallel)

| Engine | What it does | Who it reaches |
|--------|----------------|----------------|
| **Inbound (SEO + content)** | Ranks for problems practices already Google | Problem-aware and problem-unaware searchers |
| **Outbound (marketing agents)** | Finds practices, emails, qualifies, books demos | Practices not searching yet |

Neither works alone. SEO builds trust before the first email. Agents create pipeline while SEO compounds.

---

## Phase 1 — Public & crawlable (Week 1)

### Already shipped

- Landing page at `/` (anonymous visitors)
- Meta tags, OG image, `robots.txt`, `sitemap.xml`
- CDCP resource page with FAQ schema (`/resources/cdcp-claims-canada/`)
- Product one-pager at `/product`
- Demo routes `/demo`, `/demo/process`

### Do this week

1. **Google Search Console** — Add property `https://www.collectrx.ca`, verify (see [Search Console DNS](#search-console-dns-verification) below), submit sitemap `https://www.collectrx.ca/sitemap.xml`
2. **Bing Webmaster Tools** — Same sitemap; Bing still drives dental-office desktop traffic in Canada
3. **Google Business Profile** — Create CollectRx as a **software company** (not a dental clinic) in your incorporation province
4. **IndexNow** (optional) — Ping Bing when new resource pages ship

### Technical checklist

- [ ] `PUBLIC_API_BASE_URL` / `VITE_API_ORIGIN` set so early-access form posts work from marketing pages
- [ ] SendGrid domain verified (SPF, DKIM, DMARC) for `billing@collectrx.ca` or equivalent
- [ ] `og-image.png` loads over HTTPS (already in `/public`)

---

## Phase 2 — Problem-unaware SEO (Weeks 2–6)

Practices do not search "CollectRx." They search **symptoms**:

| Search intent | Target page |
|---------------|-------------|
| Claims sitting unpaid for weeks | `/resources/dental-insurance-follow-up-canada/` |
| CDCP reconsideration / fee grid | `/resources/cdcp-claims-canada/` (live) |
| Sun Life / Manulife hold times | `/resources/canadian-dental-carriers-follow-up/` |
| Front desk on phone all day | `/` (ROI calculator section) |
| Dental AR aging report | `/product` |

### Content cadence

Ship **one resource page every 2 weeks** until you have 12+. Each page:

- Answers a real question (no fluff)
- Uses FAQ `application/ld+json` where applicable
- Ends with a soft CTA (ROI calc or early access — not a hard sell)
- Links to 2 other resources (internal linking)

### Programmatic expansion (Month 2+)

When harvest data shows geographic clusters, add city pages:

- `/resources/dental-insurance-follow-up-toronto/`
- `/resources/dental-insurance-follow-up-calgary/`

Template: same structure as national page + local carrier mix + one local stat (CDA membership, provincial fee guide reference). Do not mass-generate thin pages.

---

## Phase 3 — Marketing agents (activate outbound)

Full architecture: [MARKETING-AGENTS-PLAN.md](./MARKETING-AGENTS-PLAN.md). Deploy steps: [PARTNERSHIPS-DEPLOY.md](./PARTNERSHIPS-DEPLOY.md).

### 48-hour agent activation

```bash
# 1. Migrations
cd Collect-RX-main && npx prisma migrate deploy

# 2. Verify env (run after setting Railway variables)
node scripts/verify-marketing-ready.mjs

# 3. Dry run
# Log in as platform_admin → /admin/partnerships
# Add yourself as manual prospect → Email preview → Run cadence tick
```

### Required Railway variables

| Variable | Why |
|----------|-----|
| `SENDGRID_API_KEY` | Email cadence |
| `SENDGRID_FROM_EMAIL` | Verified sender |
| `MARKETING_LOOP_ENABLED=1` | Turns on hourly cadence |
| `GOOGLE_PLACES_API_KEY` | Prospect harvester |
| `MARKETING_ALERT_EMAIL` | Hot lead alerts |

### Recommended before scale

| Variable | Why |
|----------|-----|
| `MARKETING_DEMO_LINK` | CTA in emails → `https://www.collectrx.ca/#early-access` |
| `MARKETING_DEMO_WEBHOOK_SECRET` | Calendly → `demo_booked` stage |
| `VAPI_SALES_ASSISTANT_ID` | Outbound qualification calls |
| `DNCL_PHONE_LIST_PATH` | Legal gate before sales calls |
| `SLACK_MARKETING_WEBHOOK_URL` | Team visibility on hot leads |

### Agent operating rhythm

| Agent | Cadence | Volume guardrail |
|-------|---------|------------------|
| Prospect harvester | Manual or campaign harvest 2×/week | 20 new prospects/day max initially |
| Email cadence | Hourly tick | CASL: conspicuous publication only |
| Reply intelligence | Real-time (SendGrid inbound) | Auto-reply positive; always honor unsubscribe |
| Sales qualifier (Vapi) | After `engaged` + DNCL pass | Max 5 outbound sales calls/day at launch |
| Score learning | Weekly Monday 07:00 | Needs 8+ closed outcomes before retune |
| Referral engine | Day 14 / 30 after `closed_won` | One practice at a time |

### First campaign (suggested)

```
Name: Ontario GTA — insurance AR
Query: dental clinic
City: Toronto
Province: ON
Limit: 15 per harvest
```

Score threshold: only advance to email 1 if harvest score ≥ 55. Review `/admin/partnerships` kanban daily for the first 2 weeks.

---

## Phase 4 — "They don't know they need it" messaging

### Reframe the category

Do **not** lead with "AI voice agents." Lead with outcomes:

- **"Your claims are aging while your front desk is on hold."**
- **"Sun Life doesn't send a push notification when a claim stalls."**
- **"CDCP has a 60-day reconsideration clock — most practices find out at day 61."**

### Channel mix (problem-unaware audiences)

| Channel | Tactic | Owner |
|---------|--------|-------|
| **SEO resources** | Symptom-based articles | Content / eng |
| **LinkedIn** | Office manager + dental consultant posts; 2×/week | Founder |
| **Dental consultants / bookkeepers** | Referral partner program (agent #6) | Partnerships |
| **CDA / provincial study clubs** | "Insurance AR benchmark" talk — not a product pitch | Founder |
| **Facebook groups** | Answer "claim stuck" questions; link resource page only when helpful | Community |
| **Cold email agents** | 4-step CASL cadence | Automated + human review |

### Email angle progression (locked templates)

1. **Email 1** — Observation: claims sit 30–90 days; front desk time cost
2. **Email 2** — Carrier-specific pain (IVR, wrong queue for CDCP vs Sun Life private)
3. **Email 3** — Compliance-safe automation (PHI tokenization, business hours)
4. **Email 4** — Social proof line (only when `MARKETING_SOCIAL_PROOF_ENABLED=true`)

---

## Phase 5 — Measure what compounds

### SEO (monthly)

- Google Search Console: impressions, CTR, average position for target queries
- Indexed pages count (should grow with each resource ship)
- Referral traffic from resource pages → early-access form submissions

### Outbound (weekly)

- Pipeline: `new → contacted → engaged → qualified → demo_booked → closed_won`
- Harvest score distribution (learning job adjustments)
- Email open/click rates by step (SendGrid events)
- Hot lead count (`MARKETING_ALERT_EMAIL` / Slack)

### North-star

**Demos booked from practices that had never heard of insurance AR automation** — track `source` on prospects (`harvest | manual | referral | inbound_seo`).

Add `inbound_seo` when early-access form includes `?utm_source=resource` UTM params.

---

## Phase 6 — Split marketing from app (when ready)

Today one Railway service serves both. When marketing ships weekly and app ships daily:

1. `www.collectrx.ca` → marketing-only static deploy (`website/marketing` branch)
2. `app.collectrx.ca` → practice portal + API
3. Electron `dashboard-url.txt` → `app.collectrx.ca` only

See [WEBSITE-AND-APP-TRACKS.md](../../docs/product/WEBSITE-AND-APP-TRACKS.md).

---

## Compliance guardrails (non-negotiable)

- **CASL** before cold email scale: [CASL-OUTREACH.md](./CASL-OUTREACH.md)
- **DNCL** before outbound sales calls
- **No fabricated metrics** on site or in emails (honest copy only)
- **PHI** never in marketing materials or Vapi sales calls

---

## Immediate next actions (priority order)

1. Submit sitemap to Google Search Console and Bing
2. Set `GOOGLE_PLACES_API_KEY` + `SENDGRID_*` on Railway; run `verify-marketing-ready.mjs`
3. Dry-run marketing cadence with your own email
4. Publish resource hub + 2 new SEO pages (shipped in this repo)
5. Create first Ontario harvest campaign at low volume
6. Founder LinkedIn: one post per week using resource page excerpts
7. Book 3 dental consultant intro calls for referral path

---

## Search Console DNS verification

Google must see **two separate TXT records** on the **apex** host `@` / `collectrx.ca` (not `www`):

| Type | Host | Value |
|------|------|-------|
| TXT | `@` | `v=spf1 include:dc-aa8e722993._spfm.collectrx.ca ~all` (SendGrid — keep this) |
| TXT | `@` | `google-site-verification=OW5yYlAIY4fg5kLVvOfizVFLTnX7qZqlvpKcYz1Uiu4` |

**Common failure:** adding the Google token by *editing* the SPF record instead of *adding a second* TXT record. Search Console then reports only SPF.

**If verification still fails:**

1. In Search Console, copy the **exact** token shown today (a new attempt may generate a new token — update DNS to match).
2. Wait 15–60 minutes after saving DNS, then click **Verify** again.
3. Or use **URL prefix** property `https://www.collectrx.ca/` → verify via **HTML tag** (meta tag is in `index.html`; deploy to production first).

Check propagation:

```bash
dig TXT collectrx.ca +short
# Should list BOTH google-site-verification=... and v=spf1 ...
```

---

## Related docs

- [MARKETING-AGENTS-PLAN.md](./MARKETING-AGENTS-PLAN.md) — agent architecture
- [PARTNERSHIPS-DEPLOY.md](./PARTNERSHIPS-DEPLOY.md) — env + webhooks
- [CASL-OUTREACH.md](./CASL-OUTREACH.md) — email compliance
- [WEBSITE-AND-APP-TRACKS.md](../../docs/product/WEBSITE-AND-APP-TRACKS.md) — deploy tracks
