/**
 * P9-05 — customer-facing release notes (edit this file or move to CMS later).
 */
export type ChangelogEntry = { version: string; date: string; items: string[] }

export const CUSTOMER_CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date: '2026-04-25',
    items: [
      'Background jobs: optional Redis + worker for rules and patient reminders (see ops runbooks).',
      'Health: queue depth at /api/health/queue when using a job queue.',
      'Legal & product pages: Terms, Privacy, product overview, and this changelog.',
      'Admin: go-live integration status and onboarding checklist.',
    ],
  },
]
