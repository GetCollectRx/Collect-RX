import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'
import { resolveApiUrl } from '../lib/resolveApiUrl'

type Props = {
  className?: string
  compact?: boolean
  alwaysShow?: boolean
}

type PlanSummary = {
  tierName: string
  callsPaused: boolean
  callsPausedReason: string | null
  cycle: {
    endsAt: string | null
    minutesConsumed: number
    minutesIncluded: number
    minutesRemaining: number
    usagePercent: number
  }
}

function fmtDate(value: string | null | undefined) {
  if (!value) return 'Not set'
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

/**
 * Minutes-based plan usage (src/billing/tiers.ts, UsagePeriod) — the same
 * source PlanUsageBanner uses. Claim-count limits are retired (monthlyClaimLimit
 * is permanently null for every tier); this card must not read that field.
 */
export function SubscriptionUsageCard({ className = '', compact = false, alwaysShow = false }: Props) {
  const { practiceId } = usePractice()
  const [plan, setPlan] = useState<PlanSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!practiceId) return
    let cancelled = false
    apiFetchJson<{ plan?: PlanSummary }>(resolveApiUrl('/api/billing/plan'))
      .then((data) => {
        if (!cancelled) {
          setPlan(data.plan ?? null)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [practiceId])

  const minutesIncluded = plan?.cycle.minutesIncluded ?? null
  const minutesConsumed = plan?.cycle.minutesConsumed ?? 0
  const minutesRemaining = plan?.cycle.minutesRemaining ?? null
  const pct = useMemo(() => {
    if (!plan) return 0
    return Math.min(100, Math.round(plan.cycle.usagePercent))
  }, [plan])

  if (!alwaysShow && !plan) return null

  const limitText = minutesIncluded === null ? 'Unlimited minutes' : `${minutesConsumed}/${minutesIncluded} min used`
  const tone = plan?.callsPaused ? 'red' : pct >= 80 ? 'amber' : 'green'
  const barColor = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-400' : 'bg-crx-500'

  return (
    <section className={`rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Subscriber plan
          </p>
          <h2 className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
            {plan?.tierName ?? 'No CollectRx plan detected'}
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {plan
              ? `Current billing cycle ends ${fmtDate(plan.cycle.endsAt)}`
              : 'Subscribe to activate carrier calling.'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-gray-900 dark:text-white">{limitText}</p>
          {minutesRemaining !== null && (
            <p className={`text-xs ${minutesRemaining === 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
              {minutesRemaining} minutes remaining this cycle
            </p>
          )}
        </div>
      </div>

      {minutesIncluded !== null && (
        <div className="mt-4">
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{pct}% of monthly plan minutes used</span>
            {plan?.callsPaused && (
              <span className="font-medium text-red-600 dark:text-red-400">
                Calling paused{plan.callsPausedReason ? ` (${plan.callsPausedReason})` : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400" role="status">
          Could not refresh plan usage: {error}
        </p>
      )}

      {!compact && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>Minutes are the meter — claim-count limits are retired.</span>
          <Link to="/billing" className="font-medium text-crx-600 hover:text-crx-700 dark:text-crx-400">
            Billing settings
          </Link>
        </div>
      )}
    </section>
  )
}
