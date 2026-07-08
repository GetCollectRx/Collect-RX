import { useEffect, useState } from 'react'
import { Card, CardHeader } from './ui'

const STEPS = [
  {
    id: 'agent',
    title: 'Install desktop agent',
    body: 'Set PMS to AbelDent under Practice Settings. Mint a connector token in Admin → Sync ops, install the CollectRx desktop app on the practice PC, and paste the token into %ProgramData%\\CollectRx\\agent-config.json (created by the installer).',
  },
  {
    id: 'sync',
    title: 'Confirm automatic sync',
    body: 'In Sync ops, the connector should show Online with a recent import run. Claims appear in Insurance → Queue without CSV uploads. CSV upload remains available as an emergency fallback only.',
  },
  {
    id: 'verify',
    title: 'Verify insurance queue',
    body: 'Open Insurance → Queue: confirm outstanding claims imported from your PMS. Adjust Admin carrier blocks if needed.',
  },
  {
    id: 'integrations',
    title: 'Complete integrations',
    body: 'In Admin → Integrations, work through SendGrid, Twilio, Stripe Connect, and Vapi until your go-live checklist is green.',
  },
  {
    id: 'live',
    title: 'Go live',
    body: 'Enable carrier calls when integrations are green. Monitor Sync ops connector status for the first week — you should not need daily CSV exports.',
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
        subtitle="Agent-first path: install desktop connector → verify sync → go live. Checked state is stored in this browser only."
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
