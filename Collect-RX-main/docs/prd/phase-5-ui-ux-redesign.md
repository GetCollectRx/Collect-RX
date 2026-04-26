# PRD — Phase 5: UI/UX Redesign & Design System

**Status:** ⏳ Pending  
**Owner:** Khalid  
**Target:** Before pilot go-live or concurrent with Phase 4  
**Reference:** Linear, Stripe, Notion aesthetic — premium medical SaaS  

---

## Problem Statement

The current CollectRx interface is described internally as unacceptable for the target market. Dental practice owners evaluate software on first impression — if the product doesn't feel like a $500/month SaaS, it won't convert at that price point. A full UI redesign is required before Dr. Hasan sees the live product.

---

## Goals

- Replace the existing interface with a premium, modern SaaS aesthetic
- Establish a consistent design system (tokens, components, typography) for all future development
- Deliver a dashboard that makes claims status immediately legible at a glance
- Ensure dark mode readiness from the start
- Make the UI feel like a $500/month product that dental practice owners trust

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Dr. Hasan's first-impression rating | ≥ 8/10 |
| Time to understand dashboard state | < 10 seconds for new user |
| Lighthouse accessibility score | ≥ 90 |
| Component library coverage | All 8+ primary views |
| Dark mode parity with light mode | 100% |

---

## Functional Requirements

### Design System
- Primary color: CollectRx Green `#0F6E56` (emerald)
- Typography: Inter or equivalent; clear hierarchy (H1–H4, body, caption)
- Spacing and radius tokens consistent across all components
- Dark mode tokens defined from day one
- Tailwind config as the single source of truth for design tokens
- Component library: button, badge, card, table, modal, sidebar, nav, form inputs, stat tile

### Dashboard (Daily Command Center)
- Hero stat tiles: claims resolved today, total AR outstanding, calls placed, revenue recovered
- Aging bucket breakdown: 30 / 45 / 60 / 90 day visual
- Active call feed: live status of in-progress Vapi calls
- Recent outcomes list: last 10 resolved claims with carrier, amount, and outcome
- Quick action bar: trigger call batch, escalate flagged claims

### Balances View
- Insurance AR table: sortable by carrier, aging bucket, amount
- Carrier block indicator: red badge when any carrier is in block state
- Per-claim action: view details, force escalate, suppress

### Patient AR View
- Patient balance table with reminder status (day 7 / 21 / 45 sent)
- Payment link status: opened, clicked, paid
- Manual trigger: send reminder now

### Estimate View
- Input form: patient lookup, procedure (CDT code), carrier
- Output card: estimated coverage breakdown, patient portion, confidence indicator
- COB display: primary and secondary carrier side by side

### Analytics View
- Time saved metric: hours equivalent of calls placed by AI vs. human
- ROI metric: dollars recovered vs. subscription cost
- Resolution rate trend: weekly chart
- Carrier performance table: resolution rate by carrier

### Monthly Owner Report
- Auto-generated PDF summary: calls placed, claims resolved, revenue recovered, time saved
- Delivered via email on the 1st of each month

### Admin View
- Practice settings: name, NPI, billing contact
- Carrier configuration: toggle carriers, set call windows
- User management: add/remove staff access

---

## Technical Constraints

- Stack: React, Vite, Tailwind CSS, Recharts (data visualization)
- Storybook for component documentation
- No new third-party UI libraries — build from Tailwind primitives
- All components must pass WCAG AA accessibility
- Mobile-responsive (tablet minimum)

---

## Out of Scope

- Native mobile app
- White-label theming for other practices
- Custom report builder

---

## Acceptance Criteria

- [ ] Design tokens defined in Tailwind config and applied consistently
- [ ] All 8 primary views rebuilt with new design system
- [ ] Dark mode works across all views
- [ ] Storybook documents all components
- [ ] Dashboard renders correctly with live data from Railway backend
- [ ] Dr. Hasan approves the interface before pilot go-live
- [ ] Lighthouse accessibility score ≥ 90
