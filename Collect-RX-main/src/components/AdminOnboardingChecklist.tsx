import { useEffect, useState } from 'react'
import { Card, CardHeader } from './ui'

const STEPS = [
  {
    id: 'import',
    title: 'Import outstanding claims',
    body: 'Go to Import CSV and upload an export from your PMS — any system works. Claims land in Insurance → Queue right away, no agent required.',
  },
  {
    id: 'agent',
    title: 'Optional: connect a sync agent',
    body: 'For AbelDent practices that would rather not export manually: mint a connector token in Admin → Sync ops and install the CollectRx desktop agent to push aging/AR on a schedule. Every other PMS uses CSV import as the ongoing path, not a fallback.',
  },
  {
    id: 'verify',
    title: 'Verify insurance queue',
    body: 'Open Insurance → Queue: confirm outstanding claims imported correctly. Adjust Admin carrier blocks if needed.',
  },
  {
    id: 'integrations',
    title: 'Complete integrations',
    body: 'In Admin → Integrations, work through SendGrid, Twilio, Stripe Connect, and Vapi until your go-live checklist is green.',
  },
  {
    id: 'live',
    title: 'Go live',
    body: 'Enable carrier calls when integrations are green. Re-import CSV (or let the sync agent push) on whatever cadence fits your practice.',
  },
] as const

function storageKey(practiceId: string | null) {
  return `crx_onboarding_${practiceId || 'default'}`
}

/**
 * P9-03, new practice checklist (import → verify → go live). Progress stored in localStorage per practice.
 */
export function AdminOnboardingChecklist({ practiceId }: { practiceId: string | null }) {
  const [done, setDone] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(practiceId))
      if (raw) setDone(JSON.parse(raw) as Record<string, boolean>)
    } catch {
      setDone({})
    }
  }, [practiceId])

  function toggle(id: string) {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try {
        localStorage.setItem(storageKey(practiceId), JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const total = STEPS.length
  const n = STEPS.filter((s) => done[s.id]).length

  return (
    <Card>
      <CardHeader
        title="Onboarding checklist"
        subtitle="CSV-first path: import claims → verify queue → go live. A sync agent is optional, for AbelDent practices only. Checked state is stored in this browser only."
      />
      <div className="mb-3 text-2xs text-gray-500 dark:text-gray-400">
        {n} / {total} complete
      </div>
      <ol className="space-y-3">
        {STEPS.map((step, i) => (
          <li key={step.id} className="flex gap-3 text-sm">
            <input
              id={`crx-onboarding-${step.id}`}
              type="checkbox"
              checked={!!done[step.id]}
              onChange={() => toggle(step.id)}
              className="mt-0.5 shrink-0 rounded border-gray-300 text-crx-600 focus:ring-crx-500"
            />
            <label
              htmlFor={`crx-onboarding-${step.id}`}
              className="flex-1 cursor-pointer group"
            >
              <span className="font-medium text-gray-800 dark:text-gray-200">
                {i + 1}. {step.title}
              </span>
              <span className="block text-2xs text-gray-500 dark:text-gray-400 mt-0.5">{step.body}</span>
            </label>
          </li>
        ))}
      </ol>
    </Card>
  )
}
