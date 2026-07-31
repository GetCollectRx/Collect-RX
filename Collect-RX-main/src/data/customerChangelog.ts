/**
 * P9-05 — customer-facing release notes (edit this file or move to CMS later).
 */
export type ChangelogEntry = { version: string; date: string; items: string[] }

export const CUSTOMER_CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.1.0',
    date: '2026-07-13',
    items: [
      'Signup and onboarding now lead with CSV import — works with any practice management system, no desktop install required.',
      'A local sync agent is available as an optional add-on for AbelDent practices; it is no longer presented as a required first step.',
      'Billing: your plan’s usage limits now correctly reflect what you’re subscribed to after upgrading via Stripe.',
      'Plan & billing page no longer shows two different usage numbers in the same place.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-04-25',
    items: [
      'Background jobs: optional Redis + worker for insurance rules and queue (see ops runbooks).',
      'Health: queue depth at /api/health/queue when using a job queue.',
      'Legal & product pages: Terms, Privacy, product overview, and this changelog.',
      'Admin: go-live integration status and onboarding checklist.',
    ],
  },
]
