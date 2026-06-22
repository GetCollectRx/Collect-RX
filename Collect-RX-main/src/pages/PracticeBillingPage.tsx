import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePractice } from '../context/PracticeContext'
import { resolveApiUrl } from '../lib/resolveApiUrl'
import { parseApiJson } from '../lib/parseApiJson'
import { apiFetchJson } from '../lib/apiFetch'

type UsageAlert = {
  level: 'info' | 'warning' | 'critical'
  code: string
  message: string
  progress?: number
}

type PlanPayload = {
  success: boolean
  plan: {
    practiceId: string
    tier: string
    tierName: string
    status: string
    callsPaused: boolean
    callsPausedReason: string | null
    cycle: {
      startedAt: string
      endsAt: string | null
      minutesConsumed: number
      minutesIncluded: number
      minutesRemaining: number
      usagePercent: number
      callsCompleted: number
      dailyMinutesConsumed: number
      dailyCapMinutes: number | null
    }
    trial: {
      active: boolean
      endsAt: string | null
      daysRemaining: number | null
    }
    overage: {
      ratePerMinute: number | null
      confirmed: boolean
    }
    lifetime: { recoveredCents: number }
    alerts: UsageAlert[]
    cycleEndsAt?: string | null
  }
  subscription: {
    enforce: boolean
    active: boolean
    status: string | null
    currentPeriodEnd: string | null
  }
  practiceName: string | null
  visibility: {
    usageVisibleToOfficeManager: boolean
    usageVisibleToBillingCoordinator: boolean
    usageAlertEmailsEnabled: boolean
  }
}

function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'N/A'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatOverageRate(ratePerMinute: number): string {
  return `$${ratePerMinute.toFixed(2)}/min`
}

function alertStyles(level: UsageAlert['level']): string {
  if (level === 'critical') {
    return 'text-red-800 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
  }
  if (level === 'warning') {
    return 'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
  }
  return 'text-blue-800 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
}

function UsageBar({ used, limit, label }: { used: number; limit: number | null; label: string }) {
  if (limit == null || limit <= 0) {
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>{label}</span>
          <span>Unlimited</span>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-200">{used} used this cycle</p>
      </div>
    )
  }
  const pct = Math.min(100, Math.round((used / limit) * 100))
  const barColor = pct >= 100 ? 'bg-red-500' : pct >= 95 ? 'bg-amber-500' : pct >= 80 ? 'bg-amber-400' : 'bg-crx-500'
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>{label}</span>
        <span>{used} / {limit}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function PracticeBillingPage() {
  const { practice, logout, refreshSession, isPracticeOwner, subscription } = usePractice()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [planData, setPlanData] = useState<PlanPayload | null>(null)
  const [planLoading, setPlanLoading] = useState(true)
  const [visibilityBusy, setVisibilityBusy] = useState(false)
  const [overageBusy, setOverageBusy] = useState(false)

  const subscribed = searchParams.get('subscribed') === '1'
  const canceled = searchParams.get('canceled') === '1'
  const gateOnly = subscription.enforce && !subscription.active

  const loadPlan = useCallback(async () => {
    setPlanLoading(true)
    setError(null)
    try {
      const data = await apiFetchJson<PlanPayload>(resolveApiUrl('/api/billing/plan'))
      setPlanData(data)
    } catch (e) {
      if ((e as Error).message.includes('403')) {
        setPlanData(null)
      } else {
        setError((e as Error).message)
      }
    } finally {
      setPlanLoading(false)
    }
  }, [])

  useEffect(() => {
    if (subscribed) void refreshSession()
  }, [subscribed, refreshSession])

  useEffect(() => {
    if (!gateOnly) void loadPlan()
    else setPlanLoading(false)
  }, [gateOnly, loadPlan])

  async function startCheckout() {
    setError(null)
    setBusy(true)
    try {
      const r = await fetch(resolveApiUrl('/api/billing/checkout'), { method: 'POST', credentials: 'include' })
      const data = await parseApiJson<{ url?: string; error?: string }>(r)
      if (!r.ok) throw new Error(data.error || 'Could not start checkout')
      if (data.url) { window.location.href = data.url; return }
      throw new Error('No checkout URL returned')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function openPortal() {
    setError(null)
    setBusy(true)
    try {
      const r = await fetch(resolveApiUrl('/api/billing/portal'), { method: 'POST', credentials: 'include' })
      const data = await parseApiJson<{ url?: string; error?: string }>(r)
      if (!r.ok) throw new Error(data.error || 'Could not open billing portal')
      if (data.url) { window.location.href = data.url; return }
      throw new Error('No portal URL returned')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmOverageCharges() {
    setError(null)
    setOverageBusy(true)
    try {
      await apiFetchJson(resolveApiUrl('/api/billing/usage/confirm-overage'), { method: 'POST' })
      await loadPlan()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setOverageBusy(false)
    }
  }

  async function patchVisibility(patch: Partial<PlanPayload['visibility']>) {
    setVisibilityBusy(true)
    try {
      await apiFetchJson(resolveApiUrl('/api/billing/plan/visibility'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      await loadPlan()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setVisibilityBusy(false)
    }
  }

  const plan = planData?.plan
  const cycleEnd = plan?.cycleEndsAt ?? planData?.subscription.currentPeriodEnd

  const shellClass = gateOnly
    ? 'min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-crx-50/50 dark:from-gray-950 dark:via-gray-950 dark:to-crx-950/20 px-4'
    : 'max-w-2xl mx-auto space-y-6'

  return (
    <div className={gateOnly ? shellClass : 'p-6'}>
      <main className={`w-full space-y-6 ${gateOnly ? 'max-w-md p-8 rounded-2xl border border-gray-200/90 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm shadow-card' : ''}`}>
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Plan &amp; billing</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {practice?.name ? (
              <>Usage and subscription for <span className="font-medium text-gray-700 dark:text-gray-200">{practice.name}</span>.</>
            ) : (
              <>Manage your CollectRx subscription and monthly usage.</>
            )}
          </p>
        </div>

        {subscribed && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 border border-emerald-200 dark:border-emerald-800">
            Payment received, updating your account…
          </p>
        )}
        {canceled && (
          <p className="text-sm text-amber-700 dark:text-amber-400 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 border border-amber-200 dark:border-amber-800">
            Checkout was canceled. You can try again when you are ready.
          </p>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>
        )}

        {!gateOnly && planLoading && (
          <p className="text-sm text-gray-500">Loading plan usage…</p>
        )}

        {!gateOnly && plan && (
          <>
            {plan.alerts.map((a) => (
              <p key={a.code} className={`text-sm rounded-lg px-3 py-2 border ${alertStyles(a.level)}`} role="status">
                {a.message}
              </p>
            ))}

            <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4 bg-white dark:bg-gray-900/50">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400">Current plan</p>
                  <p className="text-base font-semibold text-gray-900 dark:text-white">{plan.tierName}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">Billing cycle ends</p>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{fmtDate(cycleEnd)}</p>
                </div>
              </div>

              <UsageBar
                used={plan.cycle.minutesConsumed}
                limit={plan.cycle.minutesIncluded}
                label="Minutes used this cycle"
              />

              {plan.cycle.dailyCapMinutes != null && (
                <UsageBar
                  used={plan.cycle.dailyMinutesConsumed}
                  limit={plan.cycle.dailyCapMinutes}
                  label="Minutes used today"
                />
              )}

              {plan.trial.active && plan.trial.daysRemaining != null && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Trial ends {fmtDate(plan.trial.endsAt)} ({plan.trial.daysRemaining} day{plan.trial.daysRemaining === 1 ? '' : 's'} remaining)
                </p>
              )}

              {plan.callsPausedReason === 'overage_pending' && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/20 px-3 py-3 text-sm text-amber-950 dark:text-amber-100 space-y-2">
                  <p className="font-semibold">Monthly minutes exhausted</p>
                  <p className="text-amber-900/90 dark:text-amber-100/90">
                    Calling is paused. Confirm overage charges
                    {plan.overage.ratePerMinute != null ? ` (${formatOverageRate(plan.overage.ratePerMinute)})` : ''} to resume.
                  </p>
                  {isPracticeOwner && (
                    <button
                      type="button"
                      disabled={overageBusy}
                      onClick={() => void confirmOverageCharges()}
                      className="px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                    >
                      {overageBusy ? 'Please wait…' : 'Confirm overage charges'}
                    </button>
                  )}
                </div>
              )}

              {!plan.trial.active && plan.overage.ratePerMinute != null && plan.callsPausedReason !== 'overage_pending' && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Overage rate after included minutes: {formatOverageRate(plan.overage.ratePerMinute)}
                </p>
              )}

              <p className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-800 pt-3">
                Lifetime AR recovered: <span className="font-medium text-gray-700 dark:text-gray-200">{fmtMoney(plan.lifetime.recoveredCents)}</span>
              </p>
            </section>

            {isPracticeOwner && planData?.visibility && (
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3 bg-white dark:bg-gray-900/50">
                <p className="text-sm font-medium text-gray-900 dark:text-white">Team visibility &amp; alerts</p>
                <p className="text-xs text-gray-500">Choose who can view this page and receive usage alert emails.</p>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    disabled={visibilityBusy}
                    checked={planData.visibility.usageVisibleToOfficeManager}
                    onChange={(e) => void patchVisibility({ usageVisibleToOfficeManager: e.target.checked })}
                  />
                  Office manager can view plan usage
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    disabled={visibilityBusy}
                    checked={planData.visibility.usageVisibleToBillingCoordinator}
                    onChange={(e) => void patchVisibility({ usageVisibleToBillingCoordinator: e.target.checked })}
                  />
                  Billing coordinator can view plan usage
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input
                    type="checkbox"
                    disabled={visibilityBusy}
                    checked={planData.visibility.usageAlertEmailsEnabled}
                    onChange={(e) => void patchVisibility({ usageAlertEmailsEnabled: e.target.checked })}
                  />
                  Email usage alerts at 80%, 95%, and 100%
                </label>
              </section>
            )}
          </>
        )}

        {isPracticeOwner && (
          <div className="space-y-3">
            {gateOnly && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void startCheckout()}
                className="w-full py-2.5 text-sm font-medium rounded-lg bg-crx-500 hover:bg-crx-600 text-white disabled:opacity-50"
              >
                {busy ? 'Please wait…' : 'Subscribe with Stripe'}
              </button>
            )}
            {!gateOnly && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void openPortal()}
                className="w-full py-2.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {busy ? 'Please wait…' : 'Manage billing & invoices'}
              </button>
            )}
          </div>
        )}

        {gateOnly && (
          <button
            type="button"
            onClick={() => void logout()}
            className="text-2xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
          >
            Sign out
          </button>
        )}
      </main>
    </div>
  )
}
