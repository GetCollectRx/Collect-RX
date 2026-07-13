import { Link } from 'react-router-dom'
import { Card, CardHeader } from './ui'

export type SetupStep = {
  id: string
  title: string
  detail: string
  done: boolean
  href: string
}

export type SetupStatus = {
  steps: SetupStep[]
  complete: number
  total: number
  readyForCalls: boolean
}

export function OnboardingProgress({ status }: { status: SetupStatus | null }) {
  if (!status || status.complete >= status.total) return null

  const pct = Math.round((status.complete / status.total) * 100)

  return (
    <Card className="crx-onboarding-card">
      <CardHeader
        title="Setup progress"
        subtitle={`${status.complete} of ${status.total} complete — finish onboarding to start carrier follow-up`}
      />
      <div className="px-4 pb-4 space-y-3">
        <div className="crx-progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="crx-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <ol className="space-y-2">
          {status.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-3 text-sm">
              <span
                className={`crx-setup-check${step.done ? ' done' : ''}`}
                aria-hidden="true"
              >
                {step.done ? '✓' : '○'}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`font-medium${step.done ? ' text-gray-500 line-through' : ''}`}>{step.title}</p>
                {!step.done && (
                  <>
                    <p className="text-xs text-gray-500 mt-0.5">{step.detail}</p>
                    <Link to={step.href} className="text-xs font-semibold underline mt-1 inline-block" style={{ color: 'var(--crx-green)' }}>
                      Continue →
                    </Link>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
        {!status.readyForCalls && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Carrier calls stay paused until claims are imported and integrations are configured.
          </p>
        )}
      </div>
    </Card>
  )
}
