import { useEffect, useState } from 'react'
import { Card, CardHeader } from './ui'
import { apiFetchJson } from '../lib/apiFetch'
import type { SetupStatus } from './OnboardingProgress'

/**
 * Longer-form guidance per backend setup-status step id (`src/server/routes/dashboardRoutes.ts`).
 * Falls back to the step's own `detail` text for any id not covered here.
 */
const STEP_BODY: Record<string, string> = {
  csv_import:
    'Go to Import CSV and upload an export from your PMS — any system works. Claims land in Insurance → Queue right away, no agent required.',
  pms_vendor:
    'For AbelDent practices that would rather not export manually: mint a connector token in Admin → Sync ops and install the CollectRx desktop agent to push aging/AR on a schedule. Every other PMS uses CSV import as the ongoing path, not a fallback.',
  claims_verified:
    'Open Insurance → Queue: confirm outstanding claims imported correctly. Adjust Admin carrier blocks if needed.',
  practice_identity:
    'Set your practice name, callback number, and NPI in Admin → Settings — they are spoken on every carrier call.',
  integrations:
    'In Admin → Integrations, work through SendGrid, Twilio, Stripe Billing (practice plan), and Vapi until your go-live checklist is green.',
  first_call:
    'Optional — confirms the full loop is working end-to-end. Enable carrier calls once every step above is green.',
}

/**
 * P9-03, new practice checklist (import → verify → go live).
 * Reads the same server-computed `SetupStatus` as `OnboardingProgress` (Dashboard) via
 * `GET /api/dashboard/setup-status`, so both components reflect real claim counts, identity
 * setup, and Vapi readiness — not a per-browser to-do list.
 */
export function AdminOnboardingChecklist({ practiceId }: { practiceId: string | null }) {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!practiceId) {
      setStatus(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    apiFetchJson<{ success: boolean; data: SetupStatus | null }>('/api/dashboard/setup-status')
      .then((res) => {
        if (!cancelled) setStatus(res.data ?? null)
      })
      .catch(() => {
        if (!cancelled) setStatus(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [practiceId])

  if (loading) {
    return (
      <Card>
        <CardHeader title="Onboarding checklist" subtitle="Loading setup status…" />
      </Card>
    )
  }

  if (!status) {
    return (
      <Card>
        <CardHeader title="Onboarding checklist" subtitle="Setup status is unavailable right now." />
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title="Onboarding checklist"
        subtitle="CSV-first path: import claims → verify queue → go live. A sync agent is optional, for AbelDent practices only. Reflects real system state — the same status shown on the Dashboard."
      />
      <div className="mb-3 text-2xs text-gray-500 dark:text-gray-400">
        {status.complete} / {status.total} complete
      </div>
      <ol className="space-y-3">
        {status.steps.map((step, i) => (
          <li key={step.id} className="flex gap-3 text-sm">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-2xs leading-none ${
                step.done
                  ? 'border-crx-600 bg-crx-600 text-white'
                  : 'border-gray-300 text-transparent dark:border-gray-600'
              }`}
            >
              ✓
            </span>
            <span className="flex-1">
              <span
                className={`font-medium text-gray-800 dark:text-gray-200${
                  step.done ? ' text-gray-400 line-through dark:text-gray-500' : ''
                }`}
              >
                {i + 1}. {step.title}
              </span>
              <span className="block text-2xs text-gray-500 dark:text-gray-400 mt-0.5">
                {STEP_BODY[step.id] ?? step.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  )
}
