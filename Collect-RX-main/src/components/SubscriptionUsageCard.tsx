import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePractice, type SubscriptionGate } from '../context/PracticeContext'
import { apiFetchJson } from '../lib/apiFetch'

type Props = {
  className?: string
  compact?: boolean
  alwaysShow?: boolean
}

function fmtDate(value: string | null | undefined) {
  if (!value) return 'Not set'
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

export function SubscriptionUsageCard({ className = '', compact = false, alwaysShow = false }: Props) {
  const { practiceId, subscription } = usePractice()
  const [snapshot, setSnapshot] = useState<SubscriptionGate>(subscription)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSnapshot(subscription)
  }, [subscription])

  useEffect(() => {
    if (!practiceId) return
    let cancelled = false
    apiFetchJson<{ subscription: SubscriptionGate }>('/api/billing/usage')
      .then((data) => {
        if (!cancelled) {
          setSnapshot({ ...subscription, ...(data.subscription ?? {}) })
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message)
      })
    return () => {
      cancelled = true
    }
  }, [practiceId, subscription])

  const { plan, usage } = snapshot
  const hasBillingSignal = snapshot.priceConfigured || Boolean(plan) || Boolean(usage)
  const limit = usage?.monthlyClaimLimit ?? plan?.monthlyClaimLimit ?? null
  const used = usage?.usedClaims ?? 0
  const remaining = usage?.remainingClaims ?? null
  const pct = useMemo(() => {
    if (!limit) return 0
    return Math.min(100, Math.round((used / limit) * 100))
  }, [limit, used])

  if (!alwaysShow && !hasBillingSignal) return null

  const limitText = limit === null ? 'Unlimited claims' : `${used}/${limit} claims addressed`
  const tone = usage?.limitReached ? 'red' : pct >= 80 ? 'amber' : 'green'
  const barColor = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-400' : 'bg-crx-500'

  return (
    <section className={`rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Subscriber plan
          </p>
          <h2 className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
            {plan?.displayName ?? 'No CollectRx plan detected'}
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {usage
              ? `Current claim period: ${fmtDate(usage.periodStart)} to ${fmtDate(usage.periodEnd)}`
              : snapshot.active
                ? 'Claim usage starts when a carrier call is initiated.'
                : 'Subscribe to activate claim addressing.'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-gray-900 dark:text-white">{limitText}</p>
          {remaining !== null && (
            <p className={`text-xs ${remaining === 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
              {remaining} remaining this period
            </p>
          )}
        </div>
      </div>

      {limit !== null && (
        <div className="mt-4">
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{pct}% of monthly plan capacity used</span>
            {usage?.limitReached && (
              <span className="font-medium text-red-600 dark:text-red-400">
                New claims pause until {fmtDate(usage.periodEnd)}
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
          <span>
            Repeated attempts for the same claim count once in a billing period.
          </span>
          <Link to="/billing" className="font-medium text-crx-600 hover:text-crx-700 dark:text-crx-400">
            Billing settings
          </Link>
        </div>
      )}
    </section>
  )
}
