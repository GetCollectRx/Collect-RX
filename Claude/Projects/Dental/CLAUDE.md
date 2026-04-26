# CollectRx — AI Session Index

> Read this file first. It tells you exactly what's in this folder and where to look so you don't waste tokens searching.

---

## What is CollectRx?

AI-powered dental insurance accounts receivable (AR) automation platform for Canadian dental practices. Automates the manual process of calling insurance carriers to follow up on unpaid claims, plus pre-treatment eligibility estimates and patient balance collection.

**Pilot partner:** Dr. Hasan @ Tenth Line Family Dentistry, Ottawa, ON (Abeldent Local Plus PMS)  
**GitHub repo:** github.com/khalidegeh/Click (repo name: Collect-RX-main)  
**Live backend:** Railway (Node.js/Express + PostgreSQL)

---

## Folder Map

```
Dental/
├── CLAUDE.md                          ← YOU ARE HERE — read first, stop searching
├── docs/
│   ├── handoffs/                      ← Phase summaries: what was built, file trees, setup steps
│   │   ├── HANDOFF-PHASE-1-2.md       ← Electron shell + React UI (28 files, ~5,300 lines)
│   │   ├── HANDOFF-PHASE-3.md         ← Eligibility engine + rules (11 files, ~7,600 lines)
│   │   └── MERGE-INSTRUCTIONS.md      ← How to merge all phases into Collect-RX-main repo
│   └── business/
│       ├── CollectRx_Financial_Model.xlsx          ← Revenue projections, unit economics
│       ├── CollectRx_Payment_and_Financial_Plan.docx ← Payment plan / financial strategy
│       └── Email-DrHasan-SchemaDiscovery.docx      ← Email to pilot partner re: DB schema discovery
└── code/
    ├── collectrx-merge.zip            ← PRIMARY — all phases merged (47 files, ~19,845 lines)
    ├── collectrx-desktop.zip          ← Phase 1-2 only: Electron shell + React UI
    ├── collectrx-eligibility.zip      ← Phase 3 only: Insurance eligibility engine
    └── collectrx-payments.zip         ← Phase 4 only: Stripe Connect + reminders + write-offs
```

**Rule: always use `collectrx-merge.zip` as the source of truth for code.** The individual phase zips are superseded by the merge.

---

## Tech Stack (quick ref)

| Layer | Technology |
|-------|-----------|
| Voice AI | Vapi.ai — Squad with 4 agents (IVR_Navigator, Claims_Agent, Escalation_Closer, Resolution_Closer) |
| Telephony | Twilio |
| Backend | Node.js / Express on Railway |
| Database | PostgreSQL on Railway |
| Frontend | React + Vite + Tailwind (Electron shell for desktop) |
| Payments | Stripe Connect (practice as merchant of record) |
| PHI protection | PIIVault tokenization — PHI never crosses to Vapi, only UUID tokens |
| PMS connector | Abeldent Local Plus (Dr. Hasan's system) |
| Patient comms | Twilio SMS + SendGrid email |

---

## What's Built (Phases 1–4)

### Phase 1-2 — Electron Desktop Shell (`collectrx-desktop.zip`)
Complete Electron app wrapping the React/Vite frontend.
- 7-tab UI: Dashboard, Analytics, Balances, Patient AR, Estimate, Outbox, Admin
- Dashboard: KPI cards, AR aging chart, call queue, carrier donut, escalations panel
- Carrier priority panel with drag-and-drop reorder (@dnd-kit)
- IPC bridge with 15+ handlers, system tray, auto-updater, Windows Service management
- Design: Emerald green (#10B981), Inter font, Stripe-like card aesthetic
- Backend: `POST/GET /api/queue/priority`
- See: `docs/handoffs/HANDOFF-PHASE-1-2.md`

### Phase 3 — Eligibility Engine (`collectrx-eligibility.zip`)
Full insurance eligibility and pre-treatment estimate calculator.
- 12-step stateless estimate pipeline (`engine.ts`)
- 6 carrier rule configs (Sun Life, Canada Life, Manulife, Green Shield, RBC, TELUS AdjudiCare)
- 500+ CDT codes mapped to coverage tiers (`cdt-codes.ts`)
- Deductible tracking: individual + family, preventive waiver logic
- Annual max tracking: per-member + family aggregate
- COB coordination: 3 methods (standard, non-duplication, carve-out)
- Reconciliation engine: actual vs. estimate variance analysis
- Confidence scoring (0–100 scale, 7 transparent factors)
- 6 Express API endpoints + PostgreSQL schema (5 tables, 511 lines)
- 41 tests across 9 suites
- See: `docs/handoffs/HANDOFF-PHASE-3.md`

### Phase 4 — Patient Payments (`collectrx-payments.zip`)
Patient AR collection via Stripe Connect.
- Stripe Connect: practices as merchants, payment link generation
- Communication service: Twilio SMS + SendGrid email, 7 templates
- 3 automated reminder workflows (Standard, Gentle, Urgent)
- Write-off management with auto-approve thresholds
- Immutable patient ledger (audit trail)
- 29 Express API endpoints + PostgreSQL schema (10 tables)
- 32 tests across 7 suites

---

## Key Business Rules (safety-critical — never violate)

1. **CARRIER_BLOCK** — If a carrier detects automation, ALL calls to that carrier are immediately suspended. Most critical safety rule.
2. **PHI boundary** — PHI never crosses to Vapi. Only UUID tokens flow to voice agents.
3. **Call timing** — Mon–Fri, 8am–5pm ET only. No weekends.
4. **Max attempts** — 3 call attempts per claim, then human escalation.
5. **Queue entry** — Claims enter the queue at 30+ days unpaid.
6. **Escalation** — 90+ day claims go directly to human escalation, no AI calls.
7. **TELUS AdjudiCare** — Is a clearinghouse (TPA), not a single carrier. Must identify the specific TPA/plan before calling.

---

## Carrier Coverage Rules (approximate — verify post-pilot)

| Carrier | Preventive | Basic | Major | Deductible (indiv/family) | Annual Max |
|---------|-----------|-------|-------|--------------------------|------------|
| Sun Life | 100% | 80% | 50% | $50 / $150 | $1,500 |
| Canada Life | 100% | 80% | 50% | $75 / $225 | $1,200 |
| Manulife | 100% | 85% | 60% | $0 / $0 | $2,000 ($6K family) |
| Green Shield | 100% | 80% | 50% | $50 / $150 | $1,500 |
| RBC Insurance | 100% | 80% | 50% | $100 / $300 | $1,800 |
| TELUS AdjudiCare | 100% | 80% | 50% | $50 / $150 | $1,500 (varies by group) |

---

## API Endpoints (quick ref)

```
# Queue / AR
POST   /api/queue/priority              — Set carrier call priority order
GET    /api/queue/priority              — Get current priority order

# Eligibility (Phase 3)
POST   /api/eligibility/estimate        — Generate pre-treatment estimate
GET    /api/eligibility/estimate/:id    — Retrieve estimate
GET    /api/eligibility/status/:patientId — Quick coverage check
POST   /api/eligibility/reconcile       — Reconcile actual vs. estimated payments
GET    /api/eligibility/reconciliation/:id
GET    /api/eligibility/patient/:id/estimates

# Payments (Phase 4)
POST   /api/payments/connect/account    — Onboard practice to Stripe Connect
POST   /api/payments/link               — Generate patient payment link
POST   /api/payments/reminders/process  — Trigger reminder workflow
(+26 more in payments.ts)
```

---

## Where Things Are NOT in This Folder

The following are on Khalid's local machine — not here:

- **`~/Desktop/click-main`** — Local clone of the main GitHub repo (Collect-RX-main). This is the live working codebase.
- **`~/Desktop/collectrx-platform`** — Platform-level configs or deployment files (exact contents vary).
- **`~/Documents/claude/projects/`** — Other Claude project contexts.
- **GitHub repo** — `github.com/khalidegeh/Click` is the canonical remote source.

To work on the actual codebase, point Claude at the local repo at `~/Desktop/click-main` or connect the GitHub repo directly.

---

## Pre-Pilot Checklist (outstanding as of April 2026)

- [ ] Run `discover-schema.js` on Dr. Hasan's machine (Abeldent schema discovery)
- [ ] Rotate all credentials: Vapi API key, Railway PostgreSQL URL, webhook secret
- [ ] Set `COLLECTRX_API_URL` to Railway production URL in Electron app
- [ ] Run PostgreSQL migrations for eligibility + payments schemas
- [ ] Add app icon (`assets/icons/icon.ico`, `icon.png`)
- [ ] Code sign the Windows `.exe` installer
- [ ] Test Windows Service install/uninstall for Abeldent sync
- [ ] Test auto-updater with a staged release
- [ ] Merge all phases into `click-main` repo (see `MERGE-INSTRUCTIONS.md`)
- [ ] Verify 73 tests pass after merge (`npx vitest`)

---

## Merge Command (fast path)

```bash
cd ~/Desktop/click-main
git checkout -b phase-1-4/full-platform
unzip ~/Documents/claude/dental/code/collectrx-merge.zip
cp -r collectrx-merge/* .
git add src/ tests/ package.json vite.config.js index.html electron-builder.json tsconfig.backend.json
git commit -m "feat: add Electron shell + eligibility engine + patient payments (Phases 1-4)"
git push -u origin phase-1-4/full-platform
```

Full instructions: `docs/handoffs/MERGE-INSTRUCTIONS.md`
