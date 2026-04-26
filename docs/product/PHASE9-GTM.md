# Phase 9 — GTM & polish (reference)

## Public routes (no sign-in)

| Path | Page | Purpose |
|------|------|---------|
| `/legal/terms` | `Collect-RX-main/src/pages/LegalTerms.tsx` | Terms of use (template; legal review) |
| `/legal/privacy` | `Collect-RX-main/src/pages/LegalPrivacy.tsx` | Privacy policy (template; legal review) |
| `/product` | `Collect-RX-main/src/pages/ProductOnePager.tsx` | Sales/support one-pager |
| `/changelog` | `Collect-RX-main/src/pages/Changelog.tsx` | Customer-facing release notes |

Routes are registered in `Collect-RX-main/src/App.tsx` **before** the `AuthGate` catch-all so they work signed out.

## Cookie consent

- Component: `Collect-RX-main/src/components/CookieBanner.tsx`
- Storage key: `crx_cookie_consent_v1` (accepted / essential-only)

## In-app help (P9-01)

- Component: `Collect-RX-main/src/components/HelpTip.tsx` (toggle “?” control, not hover-only)
- Mounted on: `Dashboard.tsx`, `Balances.tsx`, `PreTreatmentEstimate.tsx`

## Admin onboarding

- Component: `Collect-RX-main/src/components/AdminOnboardingChecklist.tsx`
- Shown on: `Admin.tsx` (per-practice progress in `localStorage`: `crx_onboarding_${practiceId}`)

## Updating the customer changelog

1. Edit `Collect-RX-main/src/data/customerChangelog.ts` (add entries to the exported array, newest first).
2. Rebuild the web app. For email-friendly notes, copy the same bullets into your release email or HTML template.
