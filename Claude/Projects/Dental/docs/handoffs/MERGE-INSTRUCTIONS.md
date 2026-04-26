# CollectRx — Merge Instructions (Phases 1-4)

## Quick Merge (copy files into your repo)

```bash
# 1. Navigate to your repo
cd ~/path/to/Collect-RX-main

# 2. Create a new branch
git checkout -b phase-1-4/full-platform

# 3. Extract the merge zip (it contains the full source tree)
#    Copy all files from collectrx-merge/ into your repo root:
unzip collectrx-merge.zip
cp -r collectrx-merge/* .

# 4. Review what's new
git status

# 5. Stage all new files
git add src/ tests/ package.json vite.config.js index.html \
       electron-builder.json tsconfig.backend.json \
       HANDOFF-PHASE-1-2.md HANDOFF-PHASE-3.md HANDOFF-PHASE-4.md

# 6. Commit all phases together
git commit -m "feat: add Electron shell + eligibility engine + patient payments (Phases 1-4)

Phase 1-2: Electron wrapper with React/Vite/Tailwind UI
- Dashboard with recharts data visualization
- 7 tabbed views (Dashboard, Analytics, Balances, Patient AR, Estimate, Outbox, Admin)
- Carrier priority panel with drag-drop reorder
- IPC bridge with 15+ handlers, system tray, auto-updater
- Windows Service management for Abeldent sync
- POST /api/queue/priority backend route

Phase 3: Insurance eligibility engine
- 6 carrier rule configs (Sun Life, Canada Life, Manulife, Green Shield, RBC, TELUS)
- 500+ CDT codes mapped to coverage tiers
- Deductible tracking (individual/family, preventive waiver)
- Annual max tracking (per-member + family aggregate)
- COB coordination (standard, non-duplication, carve-out)
- Pre-treatment estimate calculator (12-step pipeline)
- Reconciliation engine (actual vs. estimate variance analysis)
- 6 Express API endpoints + PostgreSQL migration (5 tables)
- 41 tests across 9 suites

Phase 4: Patient payment collection
- Stripe Connect integration (practice as merchant of record)
- Payment link generation via Checkout Sessions
- Twilio SMS + SendGrid email communications
- 7 built-in message templates
- 3 automated reminder workflows (Standard, Gentle, Urgent)
- Write-off management with auto-approve thresholds
- Immutable patient ledger (audit trail)
- 29 Express API endpoints + PostgreSQL migration (10 tables)
- 32 tests across 7 suites

47 files, ~19,845 lines of production code

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

# 7. Push to remote
git push -u origin phase-1-4/full-platform

# 8. Create PR
gh pr create --title "feat: Full CollectRx platform (Phases 1-4)" \
  --body "## Summary
- Phase 1-2: Complete Electron desktop shell with professional React UI
- Phase 3: Full eligibility engine with 6 carrier rules, estimates, and reconciliation
- Phase 4: Patient payment collection via Stripe Connect with reminders and write-offs
- 47 files, ~19,845 lines of production code

## What's included
- Electron core (main.js, preload.js, system tray, IPC)
- React UI (7 tabs, carrier priority panel, data viz)
- Eligibility engine (types, rules, CDT codes, deductible, annual max, COB)
- Reconciliation (variance analysis, patient statements)
- Stripe Connect (payment links, refunds, webhooks)
- Communications (Twilio SMS, SendGrid email, 7 templates)
- Reminder workflows (3 sequences, multi-step automation)
- Write-off management (auto-approve, batch, reversal)
- Patient ledger (immutable audit trail)
- Express routes (queue priority + eligibility + payments)
- PostgreSQL migrations (15 tables total)
- 73 tests (41 eligibility + 32 payments)

## Test plan
- [ ] Run \`npm install\` and \`npm run dev\` — verify Electron launches
- [ ] Verify dashboard renders with mock data
- [ ] Test carrier priority drag-reorder
- [ ] Run \`npm test\` — 73 tests pass
- [ ] Run \`npm run migrate\` on Railway PostgreSQL
- [ ] Test POST /api/eligibility/estimate with sample data
- [ ] Test POST /api/payments/connect/account
- [ ] Test POST /api/payments/link
- [ ] Test POST /api/payments/reminders/process"
```

## File Structure

```
Collect-RX-main/
├── package.json             ← Updated with Phase 3+4 deps
├── vite.config.js
├── index.html
├── electron-builder.json
├── tsconfig.backend.json
├── src/
│   ├── electron/            ← Phase 1-2: Electron main process
│   │   ├── main.js
│   │   ├── preload.js
│   │   └── services/
│   │       ├── autoUpdater.js
│   │       ├── syncManager.js
│   │       └── windowsService.js
│   ├── renderer/            ← Phase 1-2: React UI
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── styles/globals.css
│   │   ├── hooks/useApi.js
│   │   ├── utils/formatters.js
│   │   └── components/
│   │       ├── carrier-priority/
│   │       ├── navigation/
│   │       ├── shared/
│   │       └── tabs/ (7 tabs)
│   ├── backend/routes/      ← Phase 1-2: Queue priority API
│   │   ├── index.js
│   │   └── priority.js
│   ├── services/
│   │   ├── eligibility/     ← Phase 3: Rules engine
│   │   │   ├── types.ts
│   │   │   ├── engine.ts
│   │   │   ├── reconciliation.ts
│   │   │   └── rules/
│   │   │       ├── carriers.ts
│   │   │       ├── cdt-codes.ts
│   │   │       ├── deductible.ts
│   │   │       ├── annual-max.ts
│   │   │       └── cob.ts
│   │   ├── payments/        ← Phase 4: Stripe Connect
│   │   │   ├── types.ts
│   │   │   └── stripe-connect.ts
│   │   ├── communications/  ← Phase 4: Twilio + SendGrid
│   │   │   └── communication-service.ts
│   │   ├── reminders/       ← Phase 4: Reminder workflows
│   │   │   └── reminder-engine.ts
│   │   └── writeoffs/       ← Phase 4: Write-off management
│   │       └── writeoff-service.ts
│   ├── routes/              ← Phase 3+4: API endpoints
│   │   ├── eligibility.ts
│   │   └── payments.ts
│   └── migrations/          ← Phase 3+4: Database
│       ├── eligibility-schema.sql
│       └── payments-schema.sql
├── tests/
│   ├── eligibility.test.ts  ← 41 tests
│   └── payments.test.ts     ← 32 tests
└── assets/icons/
```
